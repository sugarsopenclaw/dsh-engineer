from __future__ import annotations

from pathlib import Path

from shenbian_api.core.config import REPOSITORY_ROOT


def resolve_sqlite_path(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = REPOSITORY_ROOT / path
    return path
