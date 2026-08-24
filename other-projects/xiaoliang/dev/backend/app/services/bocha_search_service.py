from __future__ import annotations

import random
import re
import time
from urllib.parse import urlsplit

import httpx

from app.core.config import Settings
from app.models.web import WebGroundedData, WebSource

_DOMAIN_RE = re.compile(r"^[a-z0-9.-]{1,253}$", re.IGNORECASE)
_RETRYABLE_STATUS_CODES = {429, *range(500, 600)}
_RETRY_BASE_SECONDS = 0.8


class BochaSearchUnavailable(Exception):
    """Raised when the Bocha route cannot answer, so the caller falls back to Qwen."""


def _clean(value: object, *, max_chars: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip()[:max_chars]


def _normalize_published_at(value: object) -> str:
    text = _clean(value, max_chars=40)
    if not text:
        return ""
    # Bocha returns ISO-8601 with a time component; the date alone is what a citation needs.
    return text[:10] if len(text) >= 10 and text[4] == "-" and text[7] == "-" else text


def _normalize_domains(domains: list[str] | None) -> tuple[str, ...]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in domains or []:
        domain = raw.strip().lower().rstrip(".")
        if domain.startswith("*."):
            domain = domain[2:]
        if not domain or not _DOMAIN_RE.fullmatch(domain) or ".." in domain:
            continue
        if domain not in seen:
            normalized.append(domain)
            seen.add(domain)
    return tuple(normalized)


def _host_matches_domains(host: str, domains: tuple[str, ...]) -> bool:
    normalized_host = host.lower().rstrip(".")
    return any(
        normalized_host == domain or normalized_host.endswith(f".{domain}")
        for domain in domains
    )


class BochaSearchService:
    """Structured SERP hits from Bocha, with no model in the loop.

    This is the "find the page" half of web lookup. It deliberately produces no narrative
    answer: the desktop main agent opens useful hits with web_fetch and reads the real text,
    which keeps search ranking separate from source interpretation.
    """

    def __init__(self, settings: Settings, *, timeout_seconds: int | None = None) -> None:
        self.api_key = (settings.bocha_api_key or "").strip()
        self.base_url = (settings.bocha_base_url or "https://api.bochaai.com/v1").strip().rstrip("/")
        self.default_count = max(1, min(50, int(settings.bocha_search_count or 10)))
        configured_timeout = timeout_seconds if timeout_seconds is not None else settings.bocha_timeout_seconds
        self.timeout_seconds = max(1, int(configured_timeout or 30))

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def search(
        self,
        *,
        query: str,
        limit: int | None = None,
        region: str | None = None,
        freshness: str = "noLimit",
        allowed_domains: list[str] | None = None,
        blocked_domains: list[str] | None = None,
    ) -> WebGroundedData:
        normalized_query = query.strip()
        if not normalized_query:
            raise BochaSearchUnavailable("查询内容为空。")
        if not self.is_configured:
            raise BochaSearchUnavailable("未配置 BOCHA_API_KEY。")

        normalized_region = region.strip()[:100] if region else ""
        # Bocha's API has no region field, so the constraint travels inside the query text.
        outbound_query = (
            f"{normalized_region} {normalized_query}" if normalized_region else normalized_query
        )
        normalized_allowed = _normalize_domains(allowed_domains)
        normalized_blocked = _normalize_domains(blocked_domains)
        if normalized_allowed and len(normalized_allowed) <= 3:
            site_clause = " OR ".join(f"site:{domain}" for domain in normalized_allowed)
            outbound_query = f"{outbound_query} ({site_clause})"
        count = max(1, min(50, int(limit) if limit else self.default_count))
        started = time.perf_counter()
        response: httpx.Response | None = None
        last_transport_error: httpx.HTTPError | None = None
        with httpx.Client(timeout=float(self.timeout_seconds)) as client:
            for attempt in range(2):
                try:
                    response = client.post(
                        f"{self.base_url}/web-search",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "query": outbound_query,
                            "count": count,
                            "freshness": freshness,
                            # Search is a structured-hit channel. Bocha's generated/expanded
                            # summary is disabled and ignored even if an upstream proxy adds it.
                            "summary": False,
                        },
                    )
                    last_transport_error = None
                except httpx.TransportError as exc:
                    response = None
                    last_transport_error = exc
                    if attempt == 0:
                        self._sleep_before_retry()
                        continue
                    break

                if response.status_code in _RETRYABLE_STATUS_CODES and attempt == 0:
                    self._sleep_before_retry()
                    continue
                break

        if response is None:
            assert last_transport_error is not None
            raise BochaSearchUnavailable(f"博查检索调用失败: {last_transport_error}") from last_transport_error

        if response.status_code != 200:
            raise BochaSearchUnavailable(
                f"博查检索返回 status={response.status_code}, body={response.text[:300]}"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise BochaSearchUnavailable("博查检索响应不是合法 JSON。") from exc
        if not isinstance(payload, dict):
            raise BochaSearchUnavailable("博查检索响应结构异常。")
        code = payload.get("code")
        if code is not None:
            try:
                normalized_code = int(code)
            except (TypeError, ValueError) as exc:
                raise BochaSearchUnavailable(
                    f"博查检索响应 code 字段异常: {str(code)[:80]}"
                ) from exc
        else:
            normalized_code = 200
        if normalized_code not in (200, 0):
            message = _clean(payload.get("msg") or payload.get("message"), max_chars=300)
            raise BochaSearchUnavailable(f"博查检索返回 code={code} {message}".strip())

        sources = self._extract_sources(
            payload,
            count,
            allowed_domains=normalized_allowed,
            blocked_domains=normalized_blocked,
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        warnings: list[str] = []
        if not sources:
            warnings.append("博查检索未命中任何网页。")
        warnings.append(
            "本结果只包含检索命中项，不含网页正文；引用条文、数值或表格必须打开原文核对。"
        )
        if normalized_region:
            warnings.append(f"适用区域：{normalized_region}。")

        return WebGroundedData(
            query_or_url=normalized_query,
            model="bocha-web-search",
            answer="",
            sources=sources,
            elapsed_ms=elapsed_ms,
            warning=" ".join(warnings) or None,
            provider="bocha",
            status="ok" if sources else "empty",
        )

    @staticmethod
    def _sleep_before_retry() -> None:
        time.sleep(_RETRY_BASE_SECONDS + random.uniform(0, 0.2))

    def _extract_sources(
        self,
        payload: dict,
        limit: int,
        *,
        allowed_domains: tuple[str, ...] = (),
        blocked_domains: tuple[str, ...] = (),
    ) -> list[WebSource]:
        data = payload.get("data")
        container = data if isinstance(data, dict) else payload
        web_pages = container.get("webPages") if isinstance(container, dict) else None
        rows = web_pages.get("value") if isinstance(web_pages, dict) else None
        if not isinstance(rows, list):
            return []

        sources: list[WebSource] = []
        seen: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            url = _clean(row.get("url"), max_chars=2000)
            try:
                parts = urlsplit(url)
                host = parts.hostname
            except (TypeError, ValueError):
                continue
            if parts.scheme not in {"http", "https"} or not parts.netloc or not host:
                continue
            if allowed_domains and not _host_matches_domains(host, allowed_domains):
                continue
            if blocked_domains and _host_matches_domains(host, blocked_domains):
                continue
            if url in seen:
                continue
            seen.add(url)
            snippet = _clean(row.get("snippet"), max_chars=500)
            sources.append(
                WebSource(
                    title=_clean(row.get("name"), max_chars=160) or None,
                    url=url,
                    snippet=snippet or None,
                    site_name=_clean(row.get("siteName"), max_chars=120) or None,
                    published_at=_normalize_published_at(row.get("datePublished")) or None,
                )
            )
            if len(sources) >= limit:
                break
        return sources
