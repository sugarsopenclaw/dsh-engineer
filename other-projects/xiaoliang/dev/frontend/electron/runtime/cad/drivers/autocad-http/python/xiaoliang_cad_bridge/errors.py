"""稳定错误契约与 COM busy 识别。

Adapted from pi-engineering engineering/cad-bridge at
9bddd7f1f75f7dd427b6cabe5fb1cbd04ad398ff (MIT).
"""

from __future__ import annotations

import re
import math
from collections.abc import Mapping


RPC_E_CALL_REJECTED = -2147418111


class BridgeError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        retryable: bool = False,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        self.details = dict(details or {})


def signed_hresult(value: object) -> int | None:
    if not isinstance(value, int):
        return None
    return value - 2**32 if value > 2**31 - 1 else value


def error_hresult(error: BaseException) -> int | None:
    direct = signed_hresult(getattr(error, "hresult", None))
    if direct is not None:
        return direct
    if error.args:
        return signed_hresult(error.args[0])
    return None


def raise_if_call_rejected(error: Exception) -> None:
    if error_hresult(error) == RPC_E_CALL_REJECTED:
        raise error


def safe_error_message(error: BaseException) -> str:
    message = safe_public_message(str(error))
    return f"{type(error).__name__}: {' '.join(message.split())}"[:1000]


def safe_public_message(value: str) -> str:
    message = re.sub(r"[A-Za-z]:\\[^,;)]*", "[path]", value)
    message = re.sub(r"(?:authorization|token|api[_-]?key)\s*[:=]\s*\S+", "[secret]", message, flags=re.I)
    return " ".join(message.split())[:1000]


def safe_error_details(value: Mapping[str, object]) -> dict[str, object]:
    budget = {"remaining": 100}

    def sanitize(item: object, depth: int) -> object:
        if budget["remaining"] <= 0 or depth > 4:
            return None
        budget["remaining"] -= 1
        if item is None or isinstance(item, bool):
            return item
        if isinstance(item, int):
            return item
        if isinstance(item, float):
            return item if math.isfinite(item) else None
        if isinstance(item, str):
            return safe_public_message(item)
        if isinstance(item, Mapping):
            output: dict[str, object] = {}
            for key, child in list(item.items())[:32]:
                if isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", key):
                    output[key] = sanitize(child, depth + 1)
            return output
        if isinstance(item, (list, tuple)):
            return [sanitize(child, depth + 1) for child in item[:64]]
        return None

    return sanitize(value, 0)  # type: ignore[return-value]
