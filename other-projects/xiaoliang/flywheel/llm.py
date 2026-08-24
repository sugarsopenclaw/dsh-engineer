"""Sub2API chat client. Cloudflare blocks the default Python UA (error 1010)."""

from __future__ import annotations

import http.client
import json
import os
import random
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from flywheel.config import env_file, load_env_file_into_environ

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


TRANSIENT_MARKERS = (
    "timed out",
    "timeout",
    "closed connection",
    "remote end closed",
    "connection reset",
    "incompleteread",
    "temporarily unavailable",
    "connection aborted",
    "broken pipe",
    "reset by peer",
    "gateway time-out",
    "bad gateway",
    "unexpected_eof",
    "eof occurred in violation of protocol",
    "ssl",
)

MAX_RETRY_DELAY_SECONDS = 30.0


class LlmError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, body: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


def is_transient_llm_error(exc: BaseException) -> bool:
    if isinstance(exc, LlmError) and exc.status in {429, 502, 503, 524}:
        return True
    text = str(exc).lower()
    return any(marker in text for marker in TRANSIENT_MARKERS)


def _retry_delay_seconds(exc: LlmError, attempt: int) -> float:
    """Return capped exponential backoff with equal jitter for a retry."""
    base = 4.0 if exc.status in {429, 502, 503, 524} else 1.5
    ceiling = min(MAX_RETRY_DELAY_SECONDS, base * (2**attempt))
    return (ceiling / 2.0) + random.uniform(0.0, ceiling / 2.0)


def llm_settings() -> dict[str, str]:
    load_env_file_into_environ(env_file())
    base = (os.environ.get("SUB2API_URL") or "").strip().rstrip("/")
    key = (os.environ.get("GROK_SUB2API_SECRET_KEY") or "").strip()
    t2t = (os.environ.get("GROK_T2T_MODEL") or "grok-4.5-latest").strip()
    i2t = (os.environ.get("GROK_I2T_MODEL") or t2t).strip()
    if not base or not key:
        raise LlmError("SUB2API_URL / GROK_SUB2API_SECRET_KEY 未配置（dev/admin/.env）")
    return {"base": base, "key": key, "t2t": t2t, "i2t": i2t}


def _post(url: str, key: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("User-Agent", BROWSER_UA)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise LlmError(f"LLM HTTP {exc.code}", status=exc.code, body=raw[:4000]) from exc
    except TimeoutError as exc:
        raise LlmError("LLM request timed out") from exc
    except (
        urllib.error.URLError,
        http.client.IncompleteRead,
        http.client.RemoteDisconnected,
        ConnectionResetError,
        BrokenPipeError,
        OSError,
    ) as exc:
        raise LlmError(f"LLM request failed: {exc}") from exc


def chat_json(
    *,
    system: str,
    user_text: str,
    image_paths: list[Path] | None = None,
    model: str | None = None,
    max_tokens: int = 4096,
    timeout: int = 90,
    retries: int = 2,
) -> dict[str, Any]:
    """One-shot JSON completion. Returns parsed object plus usage/raw."""
    settings = llm_settings()
    paths = image_paths or []
    use_vision = bool(paths)
    chosen = model or (settings["i2t"] if use_vision else settings["t2t"])
    content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
    for path in paths:
        content.append(_image_part(path))
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": content if use_vision else user_text},
    ]
    candidates = _model_fallbacks(chosen)
    last_error: LlmError | None = None
    body: dict[str, Any] | None = None
    started = time.perf_counter()
    for candidate in candidates:
        payload = {
            "model": candidate,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }
        for attempt in range(retries + 1):
            try:
                body = _post(f"{settings['base']}/chat/completions", settings["key"], payload, timeout)
                chosen = candidate
                last_error = None
                break
            except LlmError as exc:
                last_error = exc
                if exc.status == 400 and "response_format" in payload:
                    payload.pop("response_format", None)
                    continue
                if is_transient_llm_error(exc):
                    if candidate.endswith("-latest") and exc.status == 503:
                        break
                    if attempt < retries:
                        time.sleep(_retry_delay_seconds(exc, attempt))
                        continue
                break
        if body is not None:
            break
    if body is None:
        assert last_error is not None
        raise last_error

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    choice = (body.get("choices") or [{}])[0]
    text = ((choice.get("message") or {}).get("content") or "").strip()
    parsed = _parse_json_object(text)
    usage = body.get("usage") or {}
    return {
        "parsed": parsed,
        "raw_text": text,
        "model": body.get("model") or chosen,
        "usage": usage,
        "duration_ms": elapsed_ms,
        "upstream": body,
    }


def _model_fallbacks(model: str) -> list[str]:
    """Prefer the env id; if it is *-latest and the alias 503s, try the base id."""
    text = (model or "").strip()
    names = [text] if text else []
    if text.endswith("-latest"):
        base = text[: -len("-latest")].rstrip("-")
        if base and base not in names:
            names.append(base)
    return names


def _image_part(path: Path, max_bytes: int = 4 * 1024 * 1024) -> dict[str, Any]:
    data = path.read_bytes()
    if len(data) > max_bytes:
        raise LlmError(f"image too large: {path.name} ({len(data)} bytes)")
    import base64

    suffix = path.suffix.lower()
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(suffix, "image/png")
    b64 = base64.b64encode(data).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}


def _parse_json_object(text: str) -> dict[str, Any]:
    if not text:
        raise LlmError("empty LLM content")
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        value = json.loads(text[start : end + 1])
        if isinstance(value, dict):
            return value
    raise LlmError("LLM did not return a JSON object")
