"""User-folder layout helpers (Windows-safe names, no path escape)."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

WIN_FORBIDDEN_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_MAX_SEGMENT = 80


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def user_dir_name(email: str) -> str:
    text = (email or "").strip()
    if not text:
        return "unknown-user"
    # Windows allows @ in names; only strip reserved characters.
    cleaned = WIN_FORBIDDEN_RE.sub("_", text).rstrip(" .")
    return cleaned or "unknown-user"


def safe_segment(value: str, fallback: str = "item") -> str:
    text = WIN_FORBIDDEN_RE.sub("_", value or fallback).strip(" ._")
    text = re.sub(r"_+", "_", text)
    if not text:
        text = fallback
    return text[:_MAX_SEGMENT]


def folder_name(record_id: str, title: str | None) -> str:
    slug = safe_segment(title or "", fallback="item")
    prefix = (record_id or "id")[:8]
    return f"{prefix}__{slug}"


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def win_long_path(path: Path) -> Path:
    """Prefix \\\\?\\ on Windows so deep project trees can be written."""
    resolved = path if path.is_absolute() else path.resolve()
    text = str(resolved)
    if os.name != "nt":
        return resolved
    if text.startswith("\\\\?\\"):
        return Path(text)
    if text.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + text[2:])
    return Path("\\\\?\\" + text)


def safe_join(root: Path, relative: str) -> Path:
    rel = (relative or "").replace("\\", "/").lstrip("/")
    if not rel or rel in {".", ".."} or ".." in PurePosixParts(rel):
        raise ValueError(f"invalid relative path: {relative!r}")
    dest = (root / rel).resolve()
    root_res = root.resolve()
    if dest != root_res and root_res not in dest.parents:
        raise ValueError(f"path escapes destination root: {relative!r}")
    return dest


def PurePosixParts(relative: str) -> tuple[str, ...]:
    return tuple(part for part in relative.replace("\\", "/").split("/") if part)


def build_tree(
    relative_paths: list[str],
    *,
    project_name: str | None,
    root_name: str | None,
) -> dict[str, Any]:
    directories: set[str] = set()
    for raw in relative_paths:
        parts = PurePosixParts(raw)
        for i in range(len(parts) - 1):
            directories.add("/".join(parts[: i + 1]))
    return {
        "project_name": project_name,
        "root_name": root_name,
        "directories": sorted(directories),
        "file_count": len(relative_paths),
        "empty_dirs_unobserved": True,
        "note": "生产归档只存文件，空目录无法从 OSS/DB 还原",
    }
