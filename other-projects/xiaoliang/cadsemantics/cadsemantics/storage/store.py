from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

from cadkernel.contracts import stable_json_dumps, stable_json_loads
from cadkernel.indexes import SnapshotStore, assert_sqlite_capabilities
from cadpatterns.storage import PatternStore

from cadsemantics.contracts import RepresentationMode, SemanticRepresentation, SemanticStatus
from cadsemantics.coverage import semantic_coverage_report
from cadsemantics.graph import (
    SEMANTIC_GRAPH_SCHEMA_VERSION,
    ProjectSemanticGraph,
    SemanticGraphBundle,
)


SEMANTIC_STORE_SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class SemanticLocation:
    path: str
    drawing_semantic_graph_id: str
    project_semantic_graph_id: str
    pattern_graph_id: str
    snapshot_id: str
    size_bytes: int
    file_sha256: tuple[tuple[str, str], ...]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA page_size=16384;
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;

        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE representations (
            resolution_id TEXT PRIMARY KEY,
            representation_key TEXT NOT NULL,
            semantic_class TEXT,
            status TEXT NOT NULL,
            representation_mode TEXT NOT NULL,
            context_id TEXT NOT NULL,
            domain_pack_id TEXT NOT NULL,
            source_pattern_keys_json TEXT NOT NULL,
            geometry_signature TEXT,
            bounds_json TEXT
        ) WITHOUT ROWID;

        CREATE INDEX representations_class_status
            ON representations(semantic_class, status, resolution_id);
        CREATE INDEX representations_signature
            ON representations(geometry_signature, resolution_id);

        CREATE TABLE semantic_spatial (
            row_index INTEGER PRIMARY KEY,
            resolution_id TEXT NOT NULL UNIQUE
        );

        CREATE VIRTUAL TABLE semantic_rtree USING rtree(
            row_index,
            min_x, max_x,
            min_y, max_y
        );
        """
    )


def _write_sqlite(path: Path, bundle: SemanticGraphBundle) -> None:
    connection = sqlite3.connect(path)
    try:
        assert_sqlite_capabilities(connection)
        _create_schema(connection)
        coverage = semantic_coverage_report(bundle.drawing_graph, bundle.project_graph)
        metadata = {
            "schema_version": str(SEMANTIC_STORE_SCHEMA_VERSION),
            "semantic_graph_schema_version": str(SEMANTIC_GRAPH_SCHEMA_VERSION),
            "drawing_semantic_graph_id": bundle.drawing_graph.drawing_semantic_graph_id,
            "project_semantic_graph_id": bundle.project_graph.project_semantic_graph_id,
            "snapshot_id": bundle.drawing_graph.snapshot_id,
            "pattern_graph_id": bundle.drawing_graph.pattern_graph_id,
            "bundle_json": bundle.to_json(),
            "coverage_json": stable_json_dumps(coverage),
        }
        connection.executemany(
            "INSERT INTO metadata(key,value) VALUES (?,?)",
            sorted(metadata.items()),
        )
        connection.executemany(
            "INSERT INTO representations VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                (
                    item.resolution_id,
                    item.representation_key,
                    item.semantic_class,
                    item.status.value,
                    item.representation_mode.value,
                    item.context_id,
                    item.domain_pack_id,
                    stable_json_dumps(item.source_pattern_keys),
                    item.geometry_signature,
                    None if item.bounds is None else stable_json_dumps(item.bounds),
                )
                for item in bundle.drawing_graph.representations
            ),
        )
        spatial_row = 0
        for item in bundle.drawing_graph.representations:
            if item.bounds is None:
                continue
            min_x, min_y, max_x, max_y = item.bounds
            connection.execute("INSERT INTO semantic_spatial VALUES (?,?)", (spatial_row, item.resolution_id))
            connection.execute("INSERT INTO semantic_rtree VALUES (?,?,?,?,?)", (spatial_row, min_x, max_x, min_y, max_y))
            spatial_row += 1
        connection.commit()
    finally:
        connection.close()


def _target_path(root: Path, graph_id: str) -> Path:
    component = graph_id.replace(":", "-", 1)
    if root.name in {graph_id, component}:
        return root
    return root / "semantics-v1" / component


class SemanticStore:
    @staticmethod
    def create(
        root: str | Path,
        bundle: SemanticGraphBundle,
        *,
        snapshot_path: str | Path,
        pattern_path: str | Path,
    ) -> SemanticLocation:
        snapshot_root = Path(snapshot_path)
        pattern_root = Path(pattern_path)
        snapshot_errors = SnapshotStore.verify(snapshot_root)
        pattern_errors = PatternStore.verify(pattern_root, snapshot_path=snapshot_root)
        if snapshot_errors:
            raise ValueError("Source snapshot integrity failure: " + ", ".join(snapshot_errors))
        if pattern_errors:
            raise ValueError("Source PatternGraph integrity failure: " + ", ".join(pattern_errors))
        pattern_location = PatternStore.describe(pattern_root)
        if bundle.drawing_graph.snapshot_id != pattern_location.snapshot_id:
            raise ValueError("Semantic graph and PatternStore snapshot ids disagree")
        if bundle.drawing_graph.pattern_graph_id != pattern_location.pattern_graph_id:
            raise ValueError("Semantic graph and PatternStore graph ids disagree")
        target = _target_path(Path(root), bundle.drawing_graph.drawing_semantic_graph_id)
        target_resolved = target.resolve()
        for source, label in ((snapshot_root.resolve(), "snapshot"), (pattern_root.resolve(), "pattern")):
            if (
                target_resolved == source
                or target_resolved.is_relative_to(source)
                or source.is_relative_to(target_resolved)
            ):
                raise ValueError(f"SemanticStore must be outside the immutable source {label} directory")
        if target.exists():
            errors = SemanticStore.verify(target, snapshot_path=snapshot_root, pattern_path=pattern_root)
            if errors:
                raise ValueError("Existing SemanticStore integrity failure: " + ", ".join(errors))
            existing = SemanticStore.describe(target)
            if existing.drawing_semantic_graph_id != bundle.drawing_graph.drawing_semantic_graph_id:
                raise ValueError("Existing SemanticStore directory contains another graph id")
            if existing.project_semantic_graph_id != bundle.project_graph.project_semantic_graph_id:
                raise ValueError("Existing SemanticStore directory contains another project graph id")
            return existing
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=f"{target.name}.staging-", dir=target.parent))
        try:
            _write_sqlite(staging / "semantics.sqlite3", bundle)
            files = tuple(
                (
                    file_path.relative_to(staging).as_posix(),
                    _sha256_file(file_path),
                    file_path.stat().st_size,
                )
                for file_path in sorted(item for item in staging.rglob("*") if item.is_file())
            )
            manifest = {
                "schema_version": SEMANTIC_STORE_SCHEMA_VERSION,
                "semantic_graph_schema_version": SEMANTIC_GRAPH_SCHEMA_VERSION,
                "drawing_semantic_graph_id": bundle.drawing_graph.drawing_semantic_graph_id,
                "project_semantic_graph_id": bundle.project_graph.project_semantic_graph_id,
                "snapshot_id": bundle.drawing_graph.snapshot_id,
                "pattern_graph_id": bundle.drawing_graph.pattern_graph_id,
                "snapshot_manifest_sha256": _sha256_file(snapshot_root / "manifest.json"),
                "pattern_manifest_sha256": _sha256_file(pattern_root / "manifest.json"),
                "files": files,
            }
            (staging / "manifest.json").write_text(
                stable_json_dumps(manifest, pretty=True) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            os.replace(staging, target)
        except BaseException:
            if staging.exists():
                shutil.rmtree(staging)
            raise
        post_snapshot = SnapshotStore.verify(snapshot_root)
        post_pattern = PatternStore.verify(pattern_root, snapshot_path=snapshot_root)
        if post_snapshot or post_pattern:
            raise RuntimeError("Semantic persistence changed immutable upstream integrity")
        return SemanticStore.describe(target)

    @staticmethod
    def describe(path: str | Path) -> SemanticLocation:
        root = Path(path)
        manifest = stable_json_loads((root / "manifest.json").read_text(encoding="utf-8"))
        if int(manifest["schema_version"]) != SEMANTIC_STORE_SCHEMA_VERSION:
            raise ValueError("Unsupported SemanticStore schema")
        files = tuple((str(item[0]), str(item[1])) for item in manifest["files"])
        return SemanticLocation(
            str(root.resolve()),
            str(manifest["drawing_semantic_graph_id"]),
            str(manifest["project_semantic_graph_id"]),
            str(manifest["pattern_graph_id"]),
            str(manifest["snapshot_id"]),
            sum(item.stat().st_size for item in root.rglob("*") if item.is_file()),
            files,
        )

    @staticmethod
    def verify(
        path: str | Path,
        *,
        snapshot_path: str | Path | None = None,
        pattern_path: str | Path | None = None,
    ) -> tuple[str, ...]:
        root = Path(path)
        try:
            manifest = stable_json_loads((root / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError) as error:
            return (f"manifest:{error}",)
        errors = []
        try:
            schema_version = int(manifest.get("schema_version", -1))
        except (TypeError, ValueError):
            schema_version = -1
        if schema_version != SEMANTIC_STORE_SCHEMA_VERSION:
            errors.append("schema_version")
        for relative, expected_hash, expected_size in manifest.get("files", ()):
            file_path = root / str(relative)
            if not file_path.is_file():
                errors.append(f"missing:{relative}")
                continue
            if file_path.stat().st_size != int(expected_size):
                errors.append(f"size:{relative}")
            if _sha256_file(file_path) != str(expected_hash):
                errors.append(f"sha256:{relative}")
        expected_files = {"manifest.json", *(str(item[0]) for item in manifest.get("files", ()))}
        actual_files = {item.relative_to(root).as_posix() for item in root.rglob("*") if item.is_file()}
        errors.extend(f"unexpected:{item}" for item in sorted(actual_files - expected_files))
        if snapshot_path is not None:
            snapshot_root = Path(snapshot_path)
            errors.extend(f"snapshot:{item}" for item in SnapshotStore.verify(snapshot_root))
            if (snapshot_root / "manifest.json").is_file() and _sha256_file(snapshot_root / "manifest.json") != str(manifest.get("snapshot_manifest_sha256", "")):
                errors.append("snapshot_manifest_sha256")
        if pattern_path is not None:
            pattern_root = Path(pattern_path)
            errors.extend(f"pattern:{item}" for item in PatternStore.verify(pattern_root, snapshot_path=snapshot_path))
            if (pattern_root / "manifest.json").is_file() and _sha256_file(pattern_root / "manifest.json") != str(manifest.get("pattern_manifest_sha256", "")):
                errors.append("pattern_manifest_sha256")
        database = root / "semantics.sqlite3"
        if database.is_file():
            try:
                connection = sqlite3.connect(database)
                try:
                    metadata = dict(connection.execute("SELECT key,value FROM metadata"))
                finally:
                    connection.close()
                if metadata.get("drawing_semantic_graph_id") != str(manifest.get("drawing_semantic_graph_id", "")):
                    errors.append("database_drawing_semantic_graph_id")
                if metadata.get("pattern_graph_id") != str(manifest.get("pattern_graph_id", "")):
                    errors.append("database_pattern_graph_id")
            except sqlite3.DatabaseError:
                errors.append("database")
        return tuple(errors)

    @staticmethod
    def load(path: str | Path, *, verify: bool = True) -> SemanticGraphBundle:
        root = Path(path)
        if verify:
            errors = SemanticStore.verify(root)
            if errors:
                raise ValueError("SemanticStore integrity failure: " + ", ".join(errors))
        connection = sqlite3.connect(root / "semantics.sqlite3")
        try:
            metadata = dict(connection.execute("SELECT key,value FROM metadata"))
        finally:
            connection.close()
        bundle = SemanticGraphBundle.from_json(metadata["bundle_json"])
        manifest = stable_json_loads((root / "manifest.json").read_text(encoding="utf-8"))
        if bundle.drawing_graph.drawing_semantic_graph_id != str(manifest["drawing_semantic_graph_id"]):
            raise ValueError("DrawingSemanticGraph manifest and database identifiers disagree")
        rebuilt_drawing = bundle.drawing_graph.create(
            snapshot_id=bundle.drawing_graph.snapshot_id,
            pattern_graph_id=bundle.drawing_graph.pattern_graph_id,
            ontology_version=bundle.drawing_graph.ontology_version,
            semantic_tolerance_profile_id=bundle.drawing_graph.semantic_tolerance_profile_id,
            contexts=bundle.drawing_graph.contexts,
            routing_decisions=bundle.drawing_graph.routing_decisions,
            representations=bundle.drawing_graph.representations,
            relations=bundle.drawing_graph.relations,
            systems=bundle.drawing_graph.systems,
            identity_assertions=bundle.drawing_graph.identity_assertions,
            failures=bundle.drawing_graph.failures,
            source_pattern_keys=bundle.drawing_graph.source_pattern_keys,
        )
        if rebuilt_drawing.drawing_semantic_graph_id != bundle.drawing_graph.drawing_semantic_graph_id:
            raise ValueError("DrawingSemanticGraph content identifier does not match payload")
        project = bundle.project_graph
        rebuilt_project = ProjectSemanticGraph.create(
            project_id=project.project_id,
            drawing_graph_ids=project.drawing_graph_ids,
            source_snapshot_ids=project.source_snapshot_ids,
            project_objects=project.project_objects,
            object_types=project.object_types,
            systems=project.systems,
            relations=project.relations,
            identity_clusters=project.identity_clusters,
            identity_assertions=project.identity_assertions,
            failures=project.failures,
        )
        if rebuilt_project.project_semantic_graph_id != project.project_semantic_graph_id:
            raise ValueError("ProjectSemanticGraph content identifier does not match payload")
        return bundle

    @staticmethod
    def query(
        path: str | Path,
        *,
        class_id: str | None = None,
        status: SemanticStatus | None = None,
        representation_mode: RepresentationMode | None = None,
        bounds: tuple[float, float, float, float] | None = None,
    ) -> tuple[SemanticRepresentation, ...]:
        values = SemanticStore.load(path).drawing_graph.representations
        if bounds is not None:
            min_x, min_y, max_x, max_y = (float(value) for value in bounds)
            if max_x < min_x or max_y < min_y:
                raise ValueError("Semantic query bounds are not ordered")
        return tuple(
            item
            for item in values
            if (class_id is None or item.semantic_class == class_id)
            and (status is None or item.status is status)
            and (representation_mode is None or item.representation_mode is representation_mode)
            and (
                bounds is None
                or item.bounds is not None
                and item.bounds[0] <= bounds[2]
                and item.bounds[2] >= bounds[0]
                and item.bounds[1] <= bounds[3]
                and item.bounds[3] >= bounds[1]
            )
        )
