from __future__ import annotations

import time
from collections.abc import Iterable
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.core.config import Settings
from app.core.errors import AppError
from app.models.web import WebGroundedData, WebSource


_FRESHNESS_LABELS: dict[str, str] = {
    "oneDay": "最近一天",
    "oneWeek": "最近一周",
    "oneMonth": "最近一个月",
    "oneYear": "最近一年",
}
_INCOMPLETE_EXTRACTOR_STATUSES = {
    "cancelled",
    "failed",
    "incomplete",
    "partial",
    "timed_out",
    "timeout",
}


def _normalize_text(content: object) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        fragments: list[str] = []
        for item in content:
            text = _normalize_text(item)
            if text:
                fragments.append(text)
        return "\n".join(fragments).strip()
    if isinstance(content, dict):
        for key in ("text", "content", "output"):
            text = _normalize_text(content.get(key))
            if text:
                return text
    return ""


@dataclass(frozen=True)
class _ExtractorCall:
    goal: str
    urls: tuple[str, ...]
    output: str
    status: str
    content_type: str | None
    truncated: bool | None


class WebSearchService:
    """Qwen Responses fallback search and URL extraction.

    Search results are accepted only from ``web_search_call.action.sources``.
    URL fetch content is accepted only from a matching, non-empty
    ``web_extractor_call.output``.
    Model prose (including ``output_text``) is deliberately ignored by both paths.
    """

    def __init__(self, settings: Settings) -> None:
        self.api_key = (settings.dashscope_api_key or "").strip()
        self.base_url = (settings.dashscope_base_url or "").strip()
        self.search_model = (settings.qwen_web_search_model or "qwen3.8-max").strip()
        self.fetch_model = (settings.qwen_web_fetch_model or "qwen3.8-max").strip()
        self.default_source_limit = max(1, min(10, int(settings.qwen_web_source_limit or 8)))
        self.search_timeout_seconds = max(10, int(settings.qwen_web_search_timeout_seconds or 90))
        self.fetch_timeout_seconds = max(10, int(settings.qwen_web_fetch_timeout_seconds or 180))

    def search(
        self,
        *,
        query: str,
        limit: int | None = None,
        region: str | None = None,
        freshness: str | None = None,
        allowed_domains: list[str] | None = None,
        blocked_domains: list[str] | None = None,
    ) -> WebGroundedData:
        normalized_query = query.strip()
        if not normalized_query:
            return WebGroundedData(
                query_or_url="",
                model=self.search_model,
                elapsed_ms=0,
                warning="查询内容为空。",
                provider="qwen",
                status="empty",
            )

        self._ensure_api_key()
        source_limit = self._normalize_limit(limit)
        normalized_region = self._normalize_region(region)
        normalized_allowed = self._normalize_domains(allowed_domains)
        normalized_blocked = self._normalize_domains(blocked_domains)

        constraints: list[str] = [f"适用区域：{normalized_region}"]
        freshness_label = _FRESHNESS_LABELS.get(freshness or "")
        if freshness_label:
            constraints.append(f"优先时间范围：{freshness_label}")
        if normalized_allowed:
            constraints.append(f"只检索这些域名：{', '.join(normalized_allowed)}")
        if normalized_blocked:
            constraints.append(f"排除这些域名：{', '.join(normalized_blocked)}")
        task = (
            "必须调用 web_search 工具执行一次真实联网搜索。只执行检索，不要依靠模型常识补充"
            "来源；服务端只会读取工具返回的结构化 sources，模型生成的正文会被忽略。\n"
            f"查询：{normalized_query}\n"
            f"{chr(10).join(constraints)}"
        )
        payload = {
            "model": self.search_model,
            "input": task,
            "tools": [{"type": "web_search"}],
            "enable_thinking": True,
        }

        started = time.perf_counter()
        raw_payload = self._post_json(
            self._responses_url(),
            payload,
            timeout_seconds=self.search_timeout_seconds,
            failure_label="联网搜索",
            error_code="web_search_failed",
        )
        raw_sources = self._extract_web_search_sources(raw_payload, 50)
        sources = self._filter_sources_by_domains(
            raw_sources,
            allowed_domains=normalized_allowed,
            blocked_domains=normalized_blocked,
        )[:source_limit]
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        status = "ok" if sources else "empty"
        if sources:
            warning = "本结果只包含 Qwen web_search 的结构化命中，不含模型综述或网页正文。"
        elif raw_sources:
            warning = "Qwen web_search 返回的结构化命中按域名规则过滤后没有剩余；模型生成正文已忽略。"
        else:
            warning = "Qwen web_search 未返回结构化 sources；模型生成正文已忽略。"
        return WebGroundedData(
            query_or_url=normalized_query,
            model=self.search_model,
            answer="",
            content="",
            sources=sources,
            elapsed_ms=elapsed_ms,
            warning=warning,
            provider="qwen",
            status=status,
        )

    def fetch(
        self,
        *,
        url: str,
        prompt: str,
        region: str | None = None,
    ) -> WebGroundedData:
        normalized_url = self._validate_http_url(url)
        normalized_prompt = prompt.strip()
        if not normalized_prompt:
            raise AppError(400, "prompt 不能为空。", error_code="web_fetch_invalid_prompt")

        self._ensure_api_key()
        normalized_region = self._normalize_region(region)
        task = (
            "必须使用 web_extractor 访问下面这个确切 URL。不要改用搜索结果或模型常识代替网页"
            "内容。抓取失败时不要编写替代答案。\n"
            f"URL：{normalized_url}\n"
            f"读取目标：{normalized_prompt}\n"
            f"适用区域：{normalized_region}"
        )
        payload = {
            "model": self.fetch_model,
            "input": task,
            "tools": [{"type": "web_search"}, {"type": "web_extractor"}],
            # Qwen3.8 Max requires thinking mode for web_extractor.
            "enable_thinking": True,
        }

        started = time.perf_counter()
        raw_payload = self._post_json(
            self._responses_url(),
            payload,
            timeout_seconds=self.fetch_timeout_seconds,
            failure_label="网页读取",
            error_code="web_fetch_failed",
        )
        extractor_calls = self._extract_web_extractor_calls(raw_payload)
        matching_any_calls = [
            call
            for call in extractor_calls
            if self._extractor_call_matches_url(call, normalized_url)
        ]
        matching_calls = [
            call
            for call in matching_any_calls
            if call.output
        ]
        if matching_calls:
            selected = matching_calls[0]
        elif matching_any_calls:
            selected = matching_any_calls[0]
        else:
            selected = None

        content = selected.output if selected and selected.output else ""
        final_url = self._select_extractor_url(selected, normalized_url) if selected else None
        candidate_urls: list[str] = []
        for call in extractor_calls:
            for candidate_url in self._extractor_call_urls(call):
                if candidate_url not in candidate_urls:
                    candidate_urls.append(candidate_url)
        sources = [WebSource(url=candidate_url) for candidate_url in candidate_urls[:10]]
        if not content:
            status = "empty"
            warning = (
                "Qwen web_extractor 没有返回与请求 URL 匹配的 call；其他页面 output 已忽略，"
                "仅作为候选来源返回。"
                if not matching_any_calls and extractor_calls
                else "Qwen web_extractor 未为请求 URL 返回非空 output；output_text 已忽略。"
            )
        else:
            incomplete_status = bool(
                selected and selected.status.casefold() in _INCOMPLETE_EXTRACTOR_STATUSES
            )
            is_truncated = bool(selected and selected.truncated)
            if matching_calls and not incomplete_status and not is_truncated:
                status = "ok"
                warning = None
            else:
                status = "partial"
                reasons: list[str] = []
                if incomplete_status:
                    reasons.append(f"extractor status={selected.status}")
                if is_truncated:
                    reasons.append("extractor 标记内容已截断")
                warning = f"网页抓取结果仅作部分内容处理：{'；'.join(reasons)}。"

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return WebGroundedData(
            query_or_url=normalized_url,
            model=self.fetch_model,
            answer=content,
            content=content,
            sources=sources,
            elapsed_ms=elapsed_ms,
            warning=warning,
            provider="qwen",
            status=status,
            final_url=final_url,
            content_type=selected.content_type if selected else None,
            truncated=selected.truncated if selected else None,
        )

    def _post_json(
        self,
        url: str,
        payload: dict,
        *,
        timeout_seconds: int,
        failure_label: str,
        error_code: str,
    ) -> dict:
        try:
            with httpx.Client(timeout=float(timeout_seconds)) as client:
                response = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise AppError(502, f"{failure_label}模型调用失败: {exc}", error_code=error_code) from exc

        if response.status_code != 200:
            raise AppError(
                502,
                (
                    f"{failure_label}模型调用失败: status={response.status_code}, "
                    f"{self._format_dashscope_error(response)}"
                ),
                error_code=error_code,
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise AppError(502, f"{failure_label}模型响应不是合法 JSON。", error_code=error_code) from exc
        if not isinstance(data, dict):
            raise AppError(502, f"{failure_label}模型响应结构异常。", error_code=error_code)
        payload_error = self._format_dashscope_payload_error(data)
        if payload_error:
            raise AppError(502, f"{failure_label}模型调用失败: {payload_error}", error_code=error_code)
        return data

    def _extract_web_search_sources(self, payload: dict, limit: int) -> list[WebSource]:
        """Read only the official Responses ``web_search_call.action.sources`` path."""

        output = payload.get("output")
        if not isinstance(output, list):
            return []
        rows: list[object] = []
        for item in output:
            if not isinstance(item, dict) or item.get("type") != "web_search_call":
                continue
            action = item.get("action")
            sources = action.get("sources") if isinstance(action, dict) else None
            if isinstance(sources, list):
                rows.extend(sources)
        return self._sources_from_iterable(rows, limit)

    def _extract_web_extractor_calls(self, payload: dict) -> list[_ExtractorCall]:
        """Read official ``web_extractor_call.urls/goal/output`` output items."""

        output = payload.get("output")
        if not isinstance(output, list):
            return []
        calls: list[_ExtractorCall] = []
        for item in output:
            if not isinstance(item, dict) or item.get("type") != "web_extractor_call":
                continue
            goal = _normalize_text(item.get("goal"))
            extracted_output = _normalize_text(item.get("output"))
            item_status = _normalize_text(item.get("status"))
            content_type = _normalize_text(
                item.get("content_type") or item.get("contentType") or item.get("mime_type")
            )
            truncated = item.get("truncated")
            calls.append(
                _ExtractorCall(
                    goal=goal,
                    urls=self._extract_extractor_urls(item.get("urls")),
                    output=extracted_output,
                    status=item_status,
                    content_type=content_type or None,
                    truncated=truncated if isinstance(truncated, bool) else None,
                )
            )
        return calls

    def _extract_extractor_urls(self, value: object) -> tuple[str, ...]:
        urls: list[str] = []
        seen: set[str] = set()

        def append(candidate: object) -> None:
            if isinstance(candidate, str):
                url = candidate.strip() if self._is_http_url(candidate) else ""
            elif isinstance(candidate, dict):
                url = self._source_url(candidate)
            elif isinstance(candidate, (list, tuple)):
                for item in candidate:
                    append(item)
                return
            else:
                return
            if url and url not in seen:
                urls.append(url)
                seen.add(url)

        append(value)
        return tuple(urls)

    def _extractor_call_urls(self, call: _ExtractorCall) -> tuple[str, ...]:
        candidates = list(call.urls)
        # Documentation examples use goal as the URL, while live responses may use a
        # natural-language goal and report actual pages in urls. Support both shapes.
        if self._is_http_url(call.goal) and call.goal not in candidates:
            candidates.append(call.goal)
        return tuple(candidates)

    def _extractor_call_matches_url(self, call: _ExtractorCall, requested_url: str) -> bool:
        return any(
            self._urls_equivalent(requested_url, candidate)
            for candidate in self._extractor_call_urls(call)
        )

    def _select_extractor_url(
        self,
        call: _ExtractorCall,
        requested_url: str,
    ) -> str | None:
        candidates = self._extractor_call_urls(call)
        for candidate in candidates:
            if self._urls_equivalent(requested_url, candidate):
                return candidate
        return candidates[0] if candidates else None

    def _sources_from_iterable(self, rows: Iterable[object], limit: int) -> list[WebSource]:
        sources: list[WebSource] = []
        sources_by_url: dict[str, WebSource] = {}
        for row in rows:
            if isinstance(row, str):
                row = {"url": row}
            if not isinstance(row, dict):
                continue
            url = self._source_url(row)
            if not url:
                continue
            title = self._source_text(row, ("title", "name"), max_chars=160)
            snippet = self._source_text(row, ("snippet", "text"), max_chars=500)
            site_name = self._source_text(row, ("site_name", "siteName", "hostname"), max_chars=120)
            published_at = self._source_text(
                row,
                ("published_at", "datePublished", "publish_time", "date"),
                max_chars=40,
            )
            existing = sources_by_url.get(url)
            if existing is not None:
                if not existing.title and title:
                    existing.title = title
                if not existing.snippet and snippet:
                    existing.snippet = snippet
                if not existing.site_name and site_name:
                    existing.site_name = site_name
                if not existing.published_at and published_at:
                    existing.published_at = published_at
                continue
            if len(sources) >= limit:
                continue
            source = WebSource(
                title=title or None,
                url=url,
                snippet=snippet or None,
                site_name=site_name or None,
                published_at=published_at or None,
            )
            sources.append(source)
            sources_by_url[url] = source
        return sources

    def _source_url(self, row: dict) -> str:
        for key in ("url", "uri", "link"):
            value = row.get(key)
            if isinstance(value, str) and self._is_http_url(value):
                return value.strip()
        return ""

    @staticmethod
    def _source_text(row: dict, keys: tuple[str, ...], *, max_chars: int) -> str:
        for key in keys:
            text = _normalize_text(row.get(key))
            if text:
                return text[:max_chars]
        return ""

    def _format_dashscope_error(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return f"body={response.text[:500]}"
        if not isinstance(payload, dict):
            return f"body={response.text[:500]}"
        return self._format_dashscope_payload_error(payload) or f"body={response.text[:500]}"

    @staticmethod
    def _format_dashscope_payload_error(payload: dict) -> str | None:
        error_payload = payload.get("error")
        if isinstance(error_payload, dict):
            source = error_payload
        elif error_payload:
            source = {"error": error_payload}
        else:
            source = payload
        if source is payload and not any(
            key in source for key in ("code", "error_code", "message")
        ):
            return None
        code = _normalize_text(source.get("code") or source.get("error_code"))
        message = _normalize_text(source.get("message") or source.get("error"))
        request_id = _normalize_text(
            source.get("request_id")
            or source.get("requestId")
            or source.get("id")
            or payload.get("request_id")
            or payload.get("requestId")
            or payload.get("id")
        )
        parts: list[str] = []
        if code:
            parts.append(f"code={code}")
        if message:
            parts.append(f"message={message}")
        if request_id:
            parts.append(f"request_id={request_id}")
        return ", ".join(parts) or None

    def _ensure_api_key(self) -> None:
        if not self.api_key:
            raise AppError(500, "缺少配置: DASHSCOPE_API_KEY", error_code="web_search_config_missing")

    def _normalize_limit(self, limit: int | None) -> int:
        raw = self.default_source_limit if limit is None else int(limit)
        return max(1, min(10, raw))

    @staticmethod
    def _normalize_region(region: str | None) -> str:
        normalized = " ".join((region or "").split()).strip()
        return normalized[:100] or "未指定"

    @staticmethod
    def _normalize_domains(domains: list[str] | None) -> tuple[str, ...]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in domains or []:
            domain = raw.strip().lower().rstrip(".")
            if domain.startswith("*."):
                domain = domain[2:]
            if domain and domain not in seen:
                normalized.append(domain)
                seen.add(domain)
        return tuple(normalized)

    @staticmethod
    def _filter_sources_by_domains(
        sources: list[WebSource],
        *,
        allowed_domains: tuple[str, ...],
        blocked_domains: tuple[str, ...],
    ) -> list[WebSource]:
        if not allowed_domains and not blocked_domains:
            return sources
        filtered: list[WebSource] = []
        for source in sources:
            try:
                host = (urlsplit(source.url).hostname or "").lower().rstrip(".")
            except (TypeError, ValueError):
                continue
            matches_allowed = any(
                host == domain or host.endswith(f".{domain}") for domain in allowed_domains
            )
            matches_blocked = any(
                host == domain or host.endswith(f".{domain}") for domain in blocked_domains
            )
            if allowed_domains and not matches_allowed:
                continue
            if blocked_domains and matches_blocked:
                continue
            filtered.append(source)
        return filtered

    def _validate_http_url(self, value: str) -> str:
        normalized = value.strip()
        if not self._is_http_url(normalized):
            raise AppError(400, "URL 必须是 http/https 地址。", error_code="web_fetch_invalid_url")
        return normalized

    @staticmethod
    def _is_http_url(value: str) -> bool:
        try:
            parts = urlsplit(value.strip())
            # Accessing ``port`` is what makes urllib reject malformed values such as :abc.
            _ = parts.port
            return (
                parts.scheme in {"http", "https"}
                and bool(parts.netloc and parts.hostname)
                and parts.username is None
                and parts.password is None
            )
        except (TypeError, ValueError):
            return False

    @classmethod
    def _url_key(cls, value: str) -> tuple[str, str, int | None, str, str] | None:
        if not cls._is_http_url(value):
            return None
        parts = urlsplit(value.strip())
        scheme = parts.scheme.lower()
        host = (parts.hostname or "").lower().rstrip(".")
        try:
            port = parts.port
        except ValueError:
            return None
        if port is None or (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
            port = None
        path = parts.path or "/"
        if path != "/":
            path = path.rstrip("/")
        return (scheme, host, port, path, parts.query)

    @classmethod
    def _urls_equivalent(cls, requested: str, extracted_goal: str) -> bool:
        """Whether the extractor report describes the requested page.

        The extractor follows the site's own redirects and records the final URL, so an
        http→https upgrade or a ``www``/apex canonicalisation still counts as the page
        that was requested. The reverse (https requested, http content) never matches,
        and path/query/port must stay identical so redirected-off-page output is rejected.
        """
        req = cls._url_key(requested)
        goal = cls._url_key(extracted_goal)
        if req is None or goal is None:
            return False
        req_scheme, req_host, req_port, req_path, req_query = req
        goal_scheme, goal_host, goal_port, goal_path, goal_query = goal
        if req_scheme != goal_scheme and goal_scheme != "https":
            return False
        if (req_path, req_query, req_port) != (goal_path, goal_query, goal_port):
            return False
        if req_host == goal_host:
            return True
        return req_host.removeprefix("www.") == goal_host.removeprefix("www.")

    def _responses_url(self) -> str:
        base_url = self.base_url.rstrip("/") or (
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        return f"{base_url}/responses"
