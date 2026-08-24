from __future__ import annotations

import os

import uvicorn

from app.core.config import get_settings


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on", "dev", "debug"}


def main() -> None:
    settings = get_settings()
    host = os.getenv("UVICORN_HOST", "0.0.0.0")
    port = int(os.getenv("UVICORN_PORT", "8000"))
    reload_enabled = _parse_bool(os.getenv("UVICORN_RELOAD"), settings.debug)

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload_enabled,
    )


if __name__ == "__main__":
    main()