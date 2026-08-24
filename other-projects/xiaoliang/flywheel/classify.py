"""Decide which archived files to skip downloading.

The catalog always records every path. Only the OSS GET is skipped for
installer / runtime blobs that users accidentally synced as project files.
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath

RUNTIME_EXTENSIONS = {
    ".exe",
    ".msi",
    ".dll",
    ".pak",
    ".cab",
    ".arx",
    ".fas",
    ".sys",
    ".drv",
}

ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z"}

# 天正安装包、晓量安装器。不匹配普通工程 zip（如「34#地块项目.zip」）。
INSTALLER_NAME_RE = re.compile(
    r"天正|T20\s*V|T20V|晓量-?Setup|xiaoliang-setup",
    re.IGNORECASE,
)

XIAOLIANG_RUNTIME_RE = re.compile(
    r"(?:^|/)(?:晓量xiaoliang|晓量|xiaoliang)/(?:resources/uv(?:/|$)|resources/[^/]+\.pak$)",
    re.IGNORECASE,
)


def _posix(relative_path: str) -> str:
    return (relative_path or "").replace("\\", "/").lstrip("/")


def _extension(relative_path: str, extension: str = "") -> str:
    ext = (extension or "").strip().lower()
    if ext and not ext.startswith("."):
        ext = f".{ext}"
    if ext:
        return ext
    suffix = PurePosixPath(_posix(relative_path)).suffix.lower()
    return suffix


def skip_download(
    relative_path: str,
    *,
    project_name: str = "",
    root_name: str = "",
    extension: str = "",
) -> str | None:
    """Return a skip reason, or None if the object should be downloaded."""
    path = _posix(relative_path)
    ext = _extension(path, extension)
    haystack = " ".join(part for part in (path, project_name, root_name) if part)

    if ext in RUNTIME_EXTENSIONS:
        return f"runtime_extension:{ext}"

    if XIAOLIANG_RUNTIME_RE.search(path):
        return "xiaoliang_runtime_path"

    if ext in ARCHIVE_EXTENSIONS and INSTALLER_NAME_RE.search(haystack):
        return "installer_archive"

    return None
