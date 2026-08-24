from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Any, Iterable, Mapping

from cadkernel.contracts import stable_id, stable_json_dumps, stable_json_loads
from cadkernel.indexes import SnapshotStore
from cadpatterns.storage import PatternStore
from cadsemantics.storage import SemanticStore

from cadtasks.contracts import ID_LENGTH


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest(path: Path) -> Mapping[str, Any]:
    value = stable_json_loads((path / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(value, Mapping):
        raise TypeError(f"Manifest root must be an object: {path}")
    return value


@dataclass(frozen=True, slots=True)
class ProjectSource:
    snapshot_path: str
    pattern_path: str
    semantic_path: str
    snapshot_id: str
    pattern_graph_id: str
    drawing_semantic_graph_id: str
    project_semantic_graph_id: str
    snapshot_manifest_sha256: str
    pattern_manifest_sha256: str
    semantic_manifest_sha256: str

    @classmethod
    def bind(
        cls,
        snapshot_path: str | Path,
        pattern_path: str | Path,
        semantic_path: str | Path,
    ) -> "ProjectSource":
        snapshot = Path(snapshot_path).resolve()
        pattern = Path(pattern_path).resolve()
        semantic = Path(semantic_path).resolve()
        snapshot_errors = SnapshotStore.verify(snapshot)
        pattern_errors = PatternStore.verify(pattern, snapshot_path=snapshot)
        semantic_errors = SemanticStore.verify(
            semantic,
            snapshot_path=snapshot,
            pattern_path=pattern,
        )
        failures = (
            *(f"snapshot:{item}" for item in snapshot_errors),
            *(f"pattern:{item}" for item in pattern_errors),
            *(f"semantic:{item}" for item in semantic_errors),
        )
        if failures:
            raise ValueError("Project source integrity failure: " + ", ".join(failures))

        snapshot_manifest = _manifest(snapshot)
        pattern_manifest = _manifest(pattern)
        semantic_manifest = _manifest(semantic)
        snapshot_id = str(snapshot_manifest["snapshot_id"])
        pattern_snapshot_id = str(pattern_manifest["snapshot_id"])
        semantic_snapshot_id = str(semantic_manifest["snapshot_id"])
        pattern_graph_id = str(pattern_manifest["pattern_graph_id"])
        semantic_pattern_id = str(semantic_manifest["pattern_graph_id"])
        if len({snapshot_id, pattern_snapshot_id, semantic_snapshot_id}) != 1:
            raise ValueError("Project source snapshot identifiers disagree")
        if pattern_graph_id != semantic_pattern_id:
            raise ValueError("Project source pattern identifiers disagree")
        return cls(
            str(snapshot),
            str(pattern),
            str(semantic),
            snapshot_id,
            pattern_graph_id,
            str(semantic_manifest["drawing_semantic_graph_id"]),
            str(semantic_manifest["project_semantic_graph_id"]),
            _sha256_file(snapshot / "manifest.json"),
            _sha256_file(pattern / "manifest.json"),
            _sha256_file(semantic / "manifest.json"),
        )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ProjectSource":
        source = cls.bind(
            str(value["snapshot_path"]),
            str(value["pattern_path"]),
            str(value["semantic_path"]),
        )
        for name in (
            "snapshot_id",
            "pattern_graph_id",
            "drawing_semantic_graph_id",
            "project_semantic_graph_id",
            "snapshot_manifest_sha256",
            "pattern_manifest_sha256",
            "semantic_manifest_sha256",
        ):
            declared = value.get(name)
            if declared is not None and str(declared) != getattr(source, name):
                raise ValueError(f"Project source {name} does not match verified content")
        return source

    @property
    def identity(self) -> tuple[str, ...]:
        return (
            self.snapshot_id,
            self.pattern_graph_id,
            self.drawing_semantic_graph_id,
            self.project_semantic_graph_id,
            self.snapshot_manifest_sha256,
            self.pattern_manifest_sha256,
            self.semantic_manifest_sha256,
        )

    @property
    def manifest_sha256(self) -> tuple[str, str, str]:
        return (
            self.snapshot_manifest_sha256,
            self.pattern_manifest_sha256,
            self.semantic_manifest_sha256,
        )

    def verify(self) -> tuple[str, ...]:
        try:
            current = ProjectSource.bind(
                self.snapshot_path,
                self.pattern_path,
                self.semantic_path,
            )
        except (OSError, TypeError, ValueError) as error:
            return (str(error),)
        return () if current == self else ("verified_source_changed",)


def project_snapshot_set_id(sources: Iterable[ProjectSource]) -> str:
    identities = tuple(source.identity for source in sources)
    digest = stable_id(
        "project-snapshot-set",
        identities,
        length=ID_LENGTH,
    )
    return "project-snapshot-set:" + digest


@dataclass(frozen=True, slots=True)
class ProjectBinding:
    project_id: str
    sources: tuple[ProjectSource, ...]
    project_snapshot_set_id: str

    def __post_init__(self) -> None:
        if not self.project_id:
            raise ValueError("ProjectBinding requires project_id")
        if not self.sources:
            raise ValueError("ProjectBinding requires at least one source")
        if len({source.identity for source in self.sources}) != len(self.sources):
            raise ValueError("ProjectBinding sources must be deduplicated")
        expected = project_snapshot_set_id(self.sources)
        if self.project_snapshot_set_id != expected:
            raise ValueError("ProjectBinding snapshot-set id does not match its sources")

    @classmethod
    def bind(
        cls,
        *,
        project_id: str,
        sources: Iterable[
            ProjectSource
            | Mapping[str, Any]
            | tuple[str | Path, str | Path, str | Path]
        ],
    ) -> "ProjectBinding":
        resolved: list[ProjectSource] = []
        seen: set[tuple[str, ...]] = set()
        for item in sources:
            if isinstance(item, ProjectSource):
                source = ProjectSource.bind(
                    item.snapshot_path,
                    item.pattern_path,
                    item.semantic_path,
                )
                if source != item:
                    raise ValueError("ProjectSource no longer matches verified content")
            elif isinstance(item, Mapping):
                source = ProjectSource.from_mapping(item)
            else:
                snapshot_path, pattern_path, semantic_path = item
                source = ProjectSource.bind(snapshot_path, pattern_path, semantic_path)
            if source.identity in seen:
                continue
            seen.add(source.identity)
            resolved.append(source)
        sources_tuple = tuple(resolved)
        return cls(
            str(project_id),
            sources_tuple,
            project_snapshot_set_id(sources_tuple),
        )

    def verify(self) -> tuple[str, ...]:
        errors = tuple(
            f"source[{index}]:{error}"
            for index, source in enumerate(self.sources)
            for error in source.verify()
        )
        if errors:
            return errors
        expected = project_snapshot_set_id(self.sources)
        return () if expected == self.project_snapshot_set_id else ("project_snapshot_set_id",)

    @property
    def manifest_sha256(self) -> tuple[str, ...]:
        return tuple(
            digest
            for source in self.sources
            for digest in source.manifest_sha256
        )

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ProjectBinding":
        raw_sources = value.get("sources")
        if not isinstance(raw_sources, (list, tuple)):
            raise TypeError("ProjectBinding sources must be an array")
        binding = cls.bind(
            project_id=str(value["project_id"]),
            sources=tuple(
                ProjectSource.from_mapping(item)
                for item in raw_sources
                if isinstance(item, Mapping)
            ),
        )
        declared = value.get("project_snapshot_set_id")
        if declared is not None and str(declared) != binding.project_snapshot_set_id:
            raise ValueError("Declared project snapshot-set id does not match sources")
        return binding

    @classmethod
    def from_json(cls, payload: str) -> "ProjectBinding":
        value = stable_json_loads(payload)
        if not isinstance(value, Mapping):
            raise TypeError("ProjectBinding JSON root must be an object")
        return cls.from_mapping(value)

    @classmethod
    def load(cls, path: str | Path) -> "ProjectBinding":
        return cls.from_json(Path(path).read_text(encoding="utf-8"))


def bind(
    project_id: str,
    sources: Iterable[
        ProjectSource
        | Mapping[str, Any]
        | tuple[str | Path, str | Path, str | Path]
    ],
) -> ProjectBinding:
    return ProjectBinding.bind(project_id=project_id, sources=sources)

