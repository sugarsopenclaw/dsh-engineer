from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path, PurePosixPath
import re


FACTS_SCHEMA_VERSION = 1
FACTS_RELATIVE_ROOT = PurePosixPath(".xiaoliang/cad/facts")
_DRAWING_KEY_PATTERN = re.compile(r"^[^/\\\x00]{1,256}$")
_SAFE_STEM_CHARACTER = re.compile(r"[^0-9A-Za-z._\-\u4e00-\u9fff]+")


def normalize_project_relative_path(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    path = PurePosixPath(normalized)
    if (
        not normalized
        or len(normalized) > 4_096
        or "\x00" in normalized
        or normalized.startswith("/")
        or re.match(r"^[A-Za-z]:", normalized)
        or any(part in {"", ".", ".."} for part in normalized.split("/"))
    ):
        raise ValueError("CAD source path must be a safe project-relative path")
    return path.as_posix()


def _safe_drawing_stem(name: str) -> str:
    stem = PurePosixPath(name.replace("\\", "/")).stem.strip() or "drawing"
    normalized = _SAFE_STEM_CHARACTER.sub("-", stem).strip(".-")
    return (normalized[:120] or "drawing")


def drawing_artifact_key(name: str, project_relative_path: str) -> str:
    normalized_path = normalize_project_relative_path(project_relative_path)
    digest = hashlib.sha256(normalized_path.encode("utf-8")).hexdigest()[:12]
    return f"{_safe_drawing_stem(name)}--{digest}"


def validate_drawing_key(value: str) -> str:
    if (
        not _DRAWING_KEY_PATTERN.fullmatch(value)
        or value in {".", ".."}
        or value.startswith(".")
    ):
        raise ValueError("drawing key is not a safe path component")
    return value


def _inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _ensure_directory_inside(root: Path, directory: Path) -> None:
    probe = directory
    while not probe.exists():
        if probe.is_symlink():
            raise ValueError(f"facts directory escaped the project root: {directory}")
        if probe == root:
            break
        probe = probe.parent
    resolved_ancestor = probe.resolve(strict=True)
    if not _inside(root, resolved_ancestor):
        raise ValueError(f"facts directory escaped the project root: {directory}")
    directory.mkdir(parents=True, exist_ok=True)
    if not _inside(root, directory.resolve(strict=True)):
        raise ValueError(f"facts directory escaped the project root: {directory}")


@dataclass(frozen=True, slots=True)
class FactsLayout:
    project_root: Path

    @classmethod
    def from_project_root(cls, value: str | Path) -> "FactsLayout":
        root = Path(value).expanduser().resolve(strict=True)
        if not root.is_dir():
            raise NotADirectoryError(root)
        return cls(root)

    @property
    def facts_root(self) -> Path:
        return self.project_root.joinpath(*FACTS_RELATIVE_ROOT.parts)

    @property
    def project_json(self) -> Path:
        return self.facts_root / "project.json"

    @property
    def project_index(self) -> Path:
        return self.facts_root / "INDEX.md"

    @property
    def binding_json(self) -> Path:
        return self.facts_root / "binding.json"

    @property
    def drawings_root(self) -> Path:
        return self.facts_root / "drawings"

    @property
    def menu_root(self) -> Path:
        return self.facts_root / "menu"

    @property
    def tasks_root(self) -> Path:
        return self.facts_root / "tasks"

    @property
    def store_root(self) -> Path:
        return self.facts_root / ".store"

    @property
    def snapshots_root(self) -> Path:
        return self.store_root / "snapshots"

    @property
    def patterns_root(self) -> Path:
        return self.store_root / "patterns-v1"

    @property
    def semantics_root(self) -> Path:
        return self.store_root / "semantics-v1"

    @property
    def task_store_root(self) -> Path:
        return self.store_root / "tasks-v1"

    @property
    def cache_root(self) -> Path:
        return self.facts_root / ".cache"

    @property
    def dxf_cache_root(self) -> Path:
        return self.cache_root / "dxf"

    @property
    def request_cache_root(self) -> Path:
        return self.cache_root / "requests"

    @property
    def state_lock_path(self) -> Path:
        return self.store_root / "state.lock"

    @property
    def binding_lock_path(self) -> Path:
        return self.store_root / "binding.lock"

    def drawing_root(self, drawing_key: str) -> Path:
        return self.drawings_root / validate_drawing_key(drawing_key)

    def l1_markdown(self, drawing_key: str) -> Path:
        return self.drawing_root(drawing_key) / "L1.md"

    def coverage_json(self, drawing_key: str) -> Path:
        return self.drawing_root(drawing_key) / "coverage.json"

    def semantic_view_root(self, drawing_key: str) -> Path:
        return self.drawing_root(drawing_key) / "semantic"

    def dxf_cache_path(self, drawing_key: str) -> Path:
        return self.dxf_cache_root / f"{validate_drawing_key(drawing_key)}.dxf"

    def ensure(self) -> None:
        for directory in (
            self.drawings_root,
            self.menu_root,
            self.tasks_root,
            self.snapshots_root,
            self.patterns_root,
            self.semantics_root,
            self.task_store_root,
            self.dxf_cache_root,
            self.request_cache_root,
        ):
            _ensure_directory_inside(self.project_root, directory)

    def resolve_project_path(
        self,
        value: str,
        *,
        suffixes: frozenset[str] | None = None,
    ) -> tuple[str, Path]:
        relative = normalize_project_relative_path(value)
        candidate = self.project_root.joinpath(*PurePosixPath(relative).parts).resolve(
            strict=True
        )
        if not _inside(self.project_root, candidate):
            raise ValueError("project path escaped through a link")
        if not candidate.is_file():
            raise FileNotFoundError(candidate)
        if suffixes is not None and candidate.suffix.casefold() not in suffixes:
            raise ValueError(f"unsupported file extension: {candidate.suffix}")
        return relative, candidate

    def resolve_input_path(
        self,
        value: str | Path,
        *,
        suffixes: frozenset[str] | None = None,
        require_file: bool = True,
    ) -> Path:
        raw = Path(value)
        candidate = (
            raw.resolve(strict=True)
            if raw.is_absolute()
            else (self.project_root / raw).resolve(strict=True)
        )
        if not _inside(self.project_root, candidate):
            raise ValueError("input path must stay inside the project root")
        if require_file and not candidate.is_file():
            raise FileNotFoundError(candidate)
        if not require_file and not candidate.is_dir():
            raise NotADirectoryError(candidate)
        if suffixes is not None and candidate.suffix.casefold() not in suffixes:
            raise ValueError(f"unsupported file extension: {candidate.suffix}")
        return candidate

    def relative(self, path: str | Path) -> str:
        candidate = Path(path).resolve(strict=False)
        if not _inside(self.project_root, candidate):
            raise ValueError("facts path escaped the project root")
        return candidate.relative_to(self.project_root).as_posix()
