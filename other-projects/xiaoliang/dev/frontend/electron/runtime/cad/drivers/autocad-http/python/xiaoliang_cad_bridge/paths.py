"""项目根绑定与 artifact 路径约束。"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

from xiaoliang_cad_bridge.errors import BridgeError


CAD_ARTIFACT_ROOT = Path(".xiaoliang") / "cad"
SAFE_STEM = re.compile(r"[^0-9A-Za-z._\-\u4e00-\u9fff]+")
ARTIFACT_RUN_ID = re.compile(
    r"^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def resolved_project_root(value: str | os.PathLike[str]) -> Path:
    root = Path(value).expanduser().resolve()
    if not root.is_dir():
        raise BridgeError("INVALID_PROJECT_ROOT", "Trusted project root must be an existing directory")
    return root


def ensure_within_project(
    project_root: Path,
    value: str | os.PathLike[str],
    *,
    must_exist: bool = False,
) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = project_root / candidate
    try:
        resolved = candidate.resolve(strict=must_exist)
        resolved.relative_to(project_root)
    except (OSError, ValueError):
        raise BridgeError("PATH_OUTSIDE_PROJECT", "Path must stay inside the trusted project root") from None
    return resolved


def project_relative(project_root: Path, value: str | os.PathLike[str]) -> str:
    try:
        return Path(value).resolve().relative_to(project_root).as_posix()
    except (OSError, ValueError):
        raise BridgeError("PATH_OUTSIDE_PROJECT", "Path must stay inside the trusted project root") from None


def normalized_drawing_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/").removeprefix("./")
    parts = normalized.split("/")
    if (
        not normalized
        or "\x00" in normalized
        or normalized.startswith("/")
        or re.match(r"^[A-Za-z]:", normalized)
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise BridgeError("INVALID_ARGUMENT", "Drawing path must be project-relative")
    return normalized


def safe_drawing_stem(name: str) -> str:
    stem = Path(name).stem.strip() or "drawing"
    normalized = SAFE_STEM.sub("-", stem).strip(".-")
    return normalized[:120] or "drawing"


def drawing_artifact_key(drawing_name: str, drawing_relative_path: str) -> str:
    normalized = normalized_drawing_relative_path(drawing_relative_path)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    return f"{safe_drawing_stem(drawing_name)}--{digest}"


def drawing_artifact_directory(project_root: Path, drawing_name: str, drawing_relative_path: str) -> Path:
    return ensure_within_project(
        project_root,
        CAD_ARTIFACT_ROOT / "drawings" / drawing_artifact_key(drawing_name, drawing_relative_path),
    )


def staging_artifact_directory(project_root: Path, run_id: str, kind: str) -> Path:
    if not ARTIFACT_RUN_ID.fullmatch(run_id):
        raise BridgeError("INVALID_ARGUMENT", "artifact_run_id is invalid")
    if kind not in {"entities", "visual"}:
        raise BridgeError("INVALID_ARGUMENT", "artifact kind is invalid")
    return ensure_within_project(project_root, CAD_ARTIFACT_ROOT / ".staging" / run_id / kind)


def preview_capture_directory(
    project_root: Path,
    drawing_name: str,
    drawing_relative_path: str,
    frame_id: str,
) -> Path:
    if not re.fullmatch(r"frame-(?:[0-9]{2}|custom)", frame_id):
        raise BridgeError("INVALID_ARGUMENT", "frame_id is invalid")
    return ensure_within_project(
        project_root,
        CAD_ARTIFACT_ROOT
        / "previews"
        / drawing_artifact_key(drawing_name, drawing_relative_path)
        / "captures"
        / frame_id,
    )


def preview_detail_directory(
    project_root: Path,
    drawing_name: str,
    drawing_relative_path: str,
) -> Path:
    return ensure_within_project(
        project_root,
        CAD_ARTIFACT_ROOT
        / "previews"
        / drawing_artifact_key(drawing_name, drawing_relative_path)
        / "details",
    )
