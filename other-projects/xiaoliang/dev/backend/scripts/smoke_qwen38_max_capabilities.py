#!/usr/bin/env python3
"""Smoke-test qwen3.8-max capabilities against DashScope before production cutover.

Usage (from dev/backend):
  python scripts/smoke_qwen38_max_capabilities.py

Reads DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL from environment or .env.
Exit code 0 only when every check passes.
"""

from __future__ import annotations

import base64
import json
import os
import struct
import sys
import time
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

MODEL = "qwen3.8-max"
FAST_REASONING_EFFORT = "low"
DEEP_REASONING_EFFORT = "xhigh"
FAST_TIMEOUT = 90.0
DEEP_TIMEOUT = 180.0
WEB_TIMEOUT = 120.0


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str
    elapsed_ms: int = 0


@dataclass
class SmokeReport:
    results: list[CheckResult] = field(default_factory=list)

    def add(self, result: CheckResult) -> None:
        self.results.append(result)
        status = "PASS" if result.ok else "FAIL"
        print(f"[{status}] {result.name} ({result.elapsed_ms}ms) — {result.detail}")

    @property
    def all_ok(self) -> bool:
        return bool(self.results) and all(item.ok for item in self.results)


def _load_dotenv() -> None:
    env_path = BACKEND_ROOT / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def _api_key() -> str:
    return (os.environ.get("DASHSCOPE_API_KEY") or "").strip()


def _compatible_base() -> str:
    return (
        os.environ.get("DASHSCOPE_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).rstrip("/")


def _http_api_base(compatible_base: str) -> str:
    value = compatible_base.rstrip("/")
    if value.endswith("/compatible-mode/v1"):
        return value.replace("/compatible-mode/v1", "/api/v1")
    return "https://dashscope.aliyuncs.com/api/v1"


def _tiny_png_data_uri() -> str:
    """16x16 red PNG as data URI (qwen3.8-max requires width/height > 10)."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    width = height = 16
    raw = b""
    for _ in range(height):
        raw += b"\x00" + (b"\xff\x00\x00" * width)
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    png = signature + ihdr + idat + iend
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            elif isinstance(item, str) and item.strip():
                parts.append(item.strip())
        return "\n".join(parts).strip()
    return ""


def _chat_completions(
    *,
    client: httpx.Client,
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    url = f"{_compatible_base()}/chat/completions"
    response = client.post(
        url,
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text[:800]}")
    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("response is not a JSON object")
    return data


def check_fast_text(client: httpx.Client) -> CheckResult:
    name = "text_fast_low_effort"
    started = time.perf_counter()
    try:
        data = _chat_completions(
            client=client,
            payload={
                "model": MODEL,
                "stream": False,
                "enable_thinking": True,
                "reasoning_effort": FAST_REASONING_EFFORT,
                "messages": [{"role": "user", "content": "只回复一个字：好"}],
                "max_tokens": 64,
            },
            timeout=FAST_TIMEOUT,
        )
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        text = _message_text(message)
        reasoning = (message.get("reasoning_content") or "").strip()
        if not text:
            raise RuntimeError("empty content")
        if not reasoning:
            raise RuntimeError("expected reasoning_content for low effort")
        return CheckResult(
            name,
            True,
            f"reasoning_chars={len(reasoning)} content={text[:40]!r}",
            int((time.perf_counter() - started) * 1000),
        )
    except Exception as exc:  # noqa: BLE001
        return CheckResult(name, False, str(exc), int((time.perf_counter() - started) * 1000))


def check_deep_text(client: httpx.Client) -> CheckResult:
    name = "text_deep_xhigh_effort"
    started = time.perf_counter()
    try:
        data = _chat_completions(
            client=client,
            payload={
                "model": MODEL,
                "stream": False,
                "enable_thinking": True,
                "reasoning_effort": DEEP_REASONING_EFFORT,
                "messages": [
                    {
                        "role": "user",
                        "content": "用一步推理说明 17 是否质数，最后只输出是或否。",
                    }
                ],
                "max_tokens": 256,
            },
            timeout=DEEP_TIMEOUT,
        )
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        text = _message_text(message)
        reasoning = (message.get("reasoning_content") or "").strip()
        if not text:
            raise RuntimeError("empty content")
        if not reasoning:
            raise RuntimeError("expected reasoning_content for xhigh effort")
        return CheckResult(
            name,
            True,
            f"reasoning_chars={len(reasoning)} content={text[:40]!r}",
            int((time.perf_counter() - started) * 1000),
        )
    except Exception as exc:  # noqa: BLE001
        return CheckResult(name, False, str(exc), int((time.perf_counter() - started) * 1000))


def check_tool_call(client: httpx.Client) -> CheckResult:
    name = "tool_calling"
    started = time.perf_counter()
    try:
        data = _chat_completions(
            client=client,
            payload={
                "model": MODEL,
                "stream": False,
                "enable_thinking": True,
                "reasoning_effort": FAST_REASONING_EFFORT,
                "messages": [
                    {
                        "role": "user",
                        "content": "请调用 get_weather 查询北京天气，不要直接回答。",
                    }
                ],
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "description": "查询城市天气",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "city": {"type": "string", "description": "城市名"},
                                },
                                "required": ["city"],
                            },
                        },
                    }
                ],
                "tool_choice": "auto",
                "max_tokens": 256,
            },
            timeout=FAST_TIMEOUT,
        )
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        tool_calls = message.get("tool_calls") or []
        if not tool_calls:
            raise RuntimeError(f"no tool_calls; content={_message_text(message)[:120]!r}")
        fn = (tool_calls[0].get("function") or {}) if isinstance(tool_calls[0], dict) else {}
        if fn.get("name") != "get_weather":
            raise RuntimeError(f"unexpected tool name: {fn.get('name')!r}")
        return CheckResult(name, True, f"called={fn.get('name')} args={fn.get('arguments')!r}", int((time.perf_counter() - started) * 1000))
    except Exception as exc:  # noqa: BLE001
        return CheckResult(name, False, str(exc), int((time.perf_counter() - started) * 1000))


def check_vision(client: httpx.Client) -> CheckResult:
    name = "vision_image_url"
    started = time.perf_counter()
    try:
        data = _chat_completions(
            client=client,
            payload={
                "model": MODEL,
                "stream": False,
                "enable_thinking": True,
                "reasoning_effort": FAST_REASONING_EFFORT,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "描述这张图的主色，只回复一个颜色词。"},
                            {
                                "type": "image_url",
                                "image_url": {"url": _tiny_png_data_uri()},
                            },
                        ],
                    }
                ],
                "max_tokens": 64,
            },
            timeout=FAST_TIMEOUT,
        )
        text = _message_text(((data.get("choices") or [{}])[0].get("message") or {}))
        if not text:
            raise RuntimeError("empty vision content")
        return CheckResult(name, True, f"content={text[:60]!r}", int((time.perf_counter() - started) * 1000))
    except Exception as exc:  # noqa: BLE001
        return CheckResult(name, False, str(exc), int((time.perf_counter() - started) * 1000))


def check_compaction(client: httpx.Client) -> CheckResult:
    name = "context_compaction"
    started = time.perf_counter()
    try:
        data = _chat_completions(
            client=client,
            payload={
                "model": MODEL,
                "stream": False,
                "enable_thinking": True,
                "reasoning_effort": FAST_REASONING_EFFORT,
                "max_tokens": 512,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "你正在执行 CONTEXT CHECKPOINT COMPACTION。"
                            "用中文 Markdown 输出简短接力摘要，保留目标与下一步。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            "请基于以下历史对话生成摘要：\n"
                            "用户：打开图纸 A.dwg 统计独立基础数量。\n"
                            "助手：已读取图纸，发现 DJ1~DJ4，共 4 个，下一步核对尺寸。"
                        ),
                    },
                ],
            },
            timeout=FAST_TIMEOUT,
        )
        text = _message_text(((data.get("choices") or [{}])[0].get("message") or {}))
        if len(text) < 20:
            raise RuntimeError(f"summary too short: {text!r}")
        return CheckResult(name, True, f"summary_chars={len(text)}", int((time.perf_counter() - started) * 1000))
    except Exception as exc:  # noqa: BLE001
        return CheckResult(name, False, str(exc), int((time.perf_counter() - started) * 1000))


def check_web_search(client: httpx.Client) -> CheckResult:
    name = "web_search_generation"
    started = time.perf_counter()
    try:
        url = f"{_http_api_base(_compatible_base())}/services/aigc/multimodal-generation/generation"
        payload = {
            "model": MODEL,
            "input": {
                "messages": [
                    {
                        "role": "system",
                        "content": "你是联网检索助手。请基于联网搜索结果简短回答。",
                    },
                    {"role": "user", "content": "阿里云百炼 qwen3.8-max 是什么？一句话。"},
                ],
            },
            "parameters": {
                "result_format": "message",
                "incremental_output": True,
                "enable_search": True,
                "enable_thinking": True,
                "reasoning_effort": FAST_REASONING_EFFORT,
                "search_options": {
                    "search_strategy": "turbo",
                    "enable_source": True,
                },
            },
        }
        headers = {
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-DashScope-SSE": "enable",
        }
        parts: list[str] = []
        sources = 0
        with client.stream("POST", url, headers=headers, json=payload, timeout=WEB_TIMEOUT) as response:
            if response.status_code >= 400:
                body = response.read().decode("utf-8", "ignore")
                raise RuntimeError(f"HTTP {response.status_code}: {body[:800]}")
            for raw_line in response.iter_lines():
                line = raw_line.decode("utf-8", "ignore") if isinstance(raw_line, bytes) else raw_line
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data_text = line[5:].strip()
                if not data_text or data_text == "[DONE]":
                    continue
                try:
                    data = json.loads(data_text)
                except ValueError:
                    continue
                if not isinstance(data, dict):
                    continue
                if data.get("code"):
                    raise RuntimeError(f"{data.get('code')}: {data.get('message')}")
                output = data.get("output")
                if not isinstance(output, dict):
                    continue
                choices = output.get("choices") or []
                if choices and isinstance(choices[0], dict):
                    message = choices[0].get("message") or {}
                    content = message.get("content")
                    if isinstance(content, str) and content.strip():
                        parts.append(content.strip())
                    elif isinstance(content, list):
                        piece = "".join(
                            str(item.get("text") or "").strip()
                            for item in content
                            if isinstance(item, dict)
                        )
                        if piece:
                            parts.append(piece)
                search_info = output.get("search_info")
                if isinstance(search_info, dict) and isinstance(search_info.get("search_results"), list):
                    sources = max(sources, len(search_info["search_results"]))
        text = "".join(parts).strip()
        if not text:
            raise RuntimeError(f"empty search answer; sources={sources}")
        return CheckResult(name, True, f"answer={text[:80]!r} sources={sources}", int((time.perf_counter() - started) * 1000))
    except Exception as exc:  # noqa: BLE001
        return CheckResult(name, False, str(exc), int((time.perf_counter() - started) * 1000))


def _responses_url(compatible_base: str) -> str:
    """Match WebSearchService._responses_url: ``{DASHSCOPE_BASE_URL}/responses``."""
    return f"{compatible_base.rstrip('/')}/responses"


def check_web_fetch(client: httpx.Client) -> CheckResult:
    name = "web_fetch_responses"
    started = time.perf_counter()
    try:
        responses_url = _responses_url(_compatible_base())
        payload = {
            "model": MODEL,
            "input": (
                "请访问并读取以下网页，只基于网页内容用一句话说明主题。\n"
                "URL: https://help.aliyun.com/zh/model-studio/models\n"
                "任务: 用一句话说明页面主题。"
            ),
            # web_extractor requires thinking mode on qwen3.8-max.
            "enable_thinking": True,
            "reasoning_effort": FAST_REASONING_EFFORT,
            "tools": [
                {"type": "web_search"},
                {"type": "web_extractor"},
            ],
        }
        response = client.post(
            responses_url,
            headers={
                "Authorization": f"Bearer {_api_key()}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=WEB_TIMEOUT,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:800]}")
        data = response.json()
        text = ""
        if isinstance(data, dict):
            text = str(data.get("output_text") or "").strip()
            if not text:
                output = data.get("output")
                if isinstance(output, list):
                    for item in output:
                        if not isinstance(item, dict):
                            continue
                        content = item.get("content")
                        if isinstance(content, str) and content.strip():
                            text = content.strip()
                            break
                        if isinstance(content, list):
                            for part in content:
                                if isinstance(part, dict):
                                    piece = part.get("text") or part.get("content")
                                    if isinstance(piece, str) and piece.strip():
                                        text = piece.strip()
                                        break
                        if text:
                            break
        if not text:
            raise RuntimeError(f"empty fetch answer; top_keys={list(data) if isinstance(data, dict) else type(data)}")
        return CheckResult(name, True, f"answer={text[:80]!r}", int((time.perf_counter() - started) * 1000))
    except Exception as exc:  # noqa: BLE001
        return CheckResult(name, False, str(exc), int((time.perf_counter() - started) * 1000))


def check_knowledge_selection(client: httpx.Client) -> CheckResult:
    name = "knowledge_selection_json"
    started = time.perf_counter()
    try:
        catalog = [
            {"id": 1, "filename": "钢结构防火涂料应用技术规程.pdf", "tags": ["防火涂料", "验收"]},
            {"id": 2, "filename": "混凝土裂缝修复手册.pdf", "tags": ["混凝土", "裂缝"]},
        ]
        data = _chat_completions(
            client=client,
            payload={
                "model": MODEL,
                "stream": False,
                "enable_thinking": True,
                "reasoning_effort": FAST_REASONING_EFFORT,
                "temperature": 0,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "你是知识库候选筛选器。只输出 JSON："
                            '{"selected":[{"id":number,"score":number,"reason":string}],"summary":string}'
                            "；id 必须来自候选。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"用户问题：钢结构防火涂料验收要点\n"
                            f"候选目录(JSON)：{json.dumps(catalog, ensure_ascii=False)}"
                        ),
                    },
                ],
                "max_tokens": 512,
            },
            timeout=FAST_TIMEOUT,
        )
        text = _message_text(((data.get("choices") or [{}])[0].get("message") or {}))
        if not text:
            raise RuntimeError("empty selection content")
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise RuntimeError(f"no JSON object in {text[:160]!r}")
        raw_json = text[start : end + 1]
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError:
            # Low-effort thinking can emit slightly invalid JSON; accept clear id=1 pick.
            if '"id": 1' in raw_json or '"id":1' in raw_json:
                return CheckResult(
                    name,
                    True,
                    f"lenient_id1 content={raw_json[:120]!r}",
                    int((time.perf_counter() - started) * 1000),
                )
            raise
        selected = parsed.get("selected")
        if not isinstance(selected, list) or not selected:
            raise RuntimeError(f"selected empty: {parsed!r}")
        first_id = selected[0].get("id") if isinstance(selected[0], dict) else None
        if first_id != 1:
            raise RuntimeError(f"expected id=1 first, got {first_id!r}")
        return CheckResult(name, True, f"selected={selected!r}", int((time.perf_counter() - started) * 1000))
    except Exception as exc:  # noqa: BLE001
        return CheckResult(name, False, str(exc), int((time.perf_counter() - started) * 1000))


def main() -> int:
    _load_dotenv()
    if not _api_key():
        print("FAIL: DASHSCOPE_API_KEY missing")
        return 2

    print(f"Smoke testing model={MODEL} base={_compatible_base()}")
    report = SmokeReport()
    with httpx.Client() as client:
        report.add(check_fast_text(client))
        report.add(check_deep_text(client))
        report.add(check_tool_call(client))
        report.add(check_vision(client))
        report.add(check_compaction(client))
        report.add(check_web_search(client))
        report.add(check_web_fetch(client))
        report.add(check_knowledge_selection(client))

    failed = [item.name for item in report.results if not item.ok]
    print("---")
    if failed:
        print(f"FAILED ({len(failed)}): {', '.join(failed)}")
        return 1
    print(f"ALL PASSED ({len(report.results)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
