from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from cadkernel._ids import sha256_file
from cadkernel._serialization import stable_json_dumps, stable_json_loads
from cadkernel.contracts import ToleranceProfile
from cadkernel.ir import (
    AnnotationRecord,
    AnnotationStore,
    AnnotationTargetRef,
    CoordinateFrame,
    DrawingSnapshot,
    EntityDefinitionTable,
    EntityOccurrenceTable,
    GeometryKind,
    GeometryStore,
    TextStore,
)
from cadkernel.indexes.models import DerivedArtifactPayload


SCHEMA_VERSION = 4
GEOMETRY_ARRAY_FIELDS = (
    "kinds",
    "coordinate_offsets",
    "coordinates",
    "grid_coordinates",
    "closed",
    "parameters",
    "bulge_offsets",
    "bulges",
    "topology_eligible",
    "annotation_derived",
    "approximation_errors",
    "bounds",
)


@dataclass(frozen=True, slots=True)
class SnapshotLocation:
    path: str
    snapshot_id: str
    size_bytes: int
    file_sha256: tuple[tuple[str, str], ...]


def assert_sqlite_capabilities(connection: sqlite3.Connection) -> tuple[str, ...]:
    options = tuple(str(row[0]) for row in connection.execute("PRAGMA compile_options"))
    enabled = set(options)
    missing = [name for name in ("ENABLE_RTREE", "ENABLE_FTS5") if name not in enabled]
    if missing:
        raise RuntimeError(
            "SQLite snapshot support requires compile options: " + ", ".join(missing)
        )
    return options


def _create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA page_size=16384;
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        PRAGMA cache_size=-131072;
        PRAGMA auto_vacuum=NONE;

        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE definitions (
            row_index INTEGER PRIMARY KEY,
            definition_id TEXT NOT NULL,
            layout_id TEXT NOT NULL,
            block_definition_path TEXT NOT NULL,
            source_handle TEXT NOT NULL,
            dxf_type TEXT NOT NULL,
            layer TEXT NOT NULL
        );

        CREATE TABLE occurrences (
            row_index INTEGER PRIMARY KEY,
            occurrence_id TEXT NOT NULL,
            definition_row INTEGER NOT NULL,
            layout_name TEXT NOT NULL,
            instance_path TEXT NOT NULL,
            transform_class TEXT NOT NULL,
            transform_count INTEGER NOT NULL,
            transform_chain BLOB NOT NULL
        );

        CREATE UNIQUE INDEX definitions_id ON definitions(definition_id);
        CREATE UNIQUE INDEX occurrences_id ON occurrences(occurrence_id);

        CREATE TABLE geometry_entities (
            row_index INTEGER PRIMARY KEY,
            occurrence_row INTEGER NOT NULL,
            source_type TEXT NOT NULL
        );

        CREATE INDEX geometry_occurrence_row ON geometry_entities(occurrence_row);

        CREATE VIRTUAL TABLE entity_rtree USING rtree(
            rtree_id,
            min_x, max_x,
            min_y, max_y
        );

        CREATE TABLE texts (
            row_index INTEGER PRIMARY KEY,
            occurrence_id TEXT NOT NULL,
            raw_text TEXT NOT NULL,
            normalized_text TEXT NOT NULL,
            plain_text TEXT NOT NULL,
            block_attribute_tag TEXT NOT NULL,
            block_attribute_value TEXT NOT NULL,
            layer_name TEXT NOT NULL,
            block_name TEXT NOT NULL,
            layout_name TEXT NOT NULL,
            drawing_title TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            z REAL NOT NULL
        );

        CREATE VIRTUAL TABLE text_fts USING fts5(
            occurrence_id UNINDEXED,
            raw_text,
            normalized_text,
            plain_text,
            block_attribute_tag,
            block_attribute_value,
            layer_name,
            block_name,
            layout_name,
            drawing_title,
            tokenize='unicode61 remove_diacritics 2'
        );

        CREATE TABLE annotations (
            row_index INTEGER PRIMARY KEY,
            occurrence_id TEXT NOT NULL,
            definition_id TEXT NOT NULL,
            annotation_kind TEXT NOT NULL,
            source_type TEXT NOT NULL,
            measured_value REAL,
            measured_value_present INTEGER NOT NULL,
            text_override TEXT NOT NULL,
            text_override_present INTEGER NOT NULL,
            measurement_scale REAL,
            measurement_scale_present INTEGER NOT NULL,
            definition_points_json TEXT NOT NULL,
            anchor_x REAL,
            anchor_y REAL,
            anchor_z REAL,
            text_min_x REAL,
            text_min_y REAL,
            text_max_x REAL,
            text_max_y REAL,
            target_refs_json TEXT NOT NULL,
            boundary_refs_json TEXT NOT NULL,
            pattern_name TEXT NOT NULL,
            pattern_name_present INTEGER NOT NULL,
            solid_fill_value INTEGER NOT NULL,
            solid_fill_present INTEGER NOT NULL,
            min_x REAL,
            min_y REAL,
            max_x REAL,
            max_y REAL,
            diagnostic_codes_json TEXT NOT NULL
        );

        CREATE INDEX annotations_kind ON annotations(annotation_kind, row_index);

        CREATE VIRTUAL TABLE annotation_rtree USING rtree(
            annotation_row,
            min_x, max_x,
            min_y, max_y
        );

        CREATE TABLE endpoint_grid (
            geometry_row INTEGER NOT NULL,
            endpoint_ordinal INTEGER NOT NULL,
            grid_x INTEGER NOT NULL,
            grid_y INTEGER NOT NULL,
            cell_x INTEGER NOT NULL,
            cell_y INTEGER NOT NULL,
            PRIMARY KEY(geometry_row, endpoint_ordinal)
        ) WITHOUT ROWID;

        CREATE TABLE derived_artifacts (
            artifact_id TEXT PRIMARY KEY,
            operator_id TEXT NOT NULL,
            operator_version TEXT NOT NULL,
            tolerance_profile_id TEXT NOT NULL,
            precision_model_id TEXT NOT NULL,
            input_digest TEXT NOT NULL,
            payload_path TEXT NOT NULL,
            payload_sha256 TEXT NOT NULL,
            decision TEXT NOT NULL,
            validation_diagnostics_json TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE faces (
            row_index INTEGER PRIMARY KEY,
            face_id TEXT NOT NULL UNIQUE,
            artifact_id TEXT NOT NULL,
            depth INTEGER NOT NULL,
            hole_count INTEGER NOT NULL,
            area REAL NOT NULL,
            geometry_wkb BLOB NOT NULL,
            boundary_json TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE face_rtree USING rtree(
            face_row,
            min_x, max_x,
            min_y, max_y
        );
        """
    )


def _write_sqlite(
    path: Path,
    snapshot: DrawingSnapshot,
    derived_records: tuple[tuple[DerivedArtifactPayload, str, str], ...],
) -> None:
    tolerance = ToleranceProfile.from_json(snapshot.tolerance_profile_json)
    cell_width = max(1, int(np.ceil(tolerance.endpoint_snap / snapshot.coordinate_frame.grid_size)))
    connection = sqlite3.connect(path)
    try:
        compile_options = assert_sqlite_capabilities(connection)
        _create_schema(connection)
        metadata = {
            "schema_version": str(SCHEMA_VERSION),
            "snapshot_id": snapshot.snapshot_id,
            "source_path": snapshot.source_path,
            "source_file_sha256": snapshot.source_file_sha256,
            "file_id": (
                str(snapshot.definitions.file_ids[0])
                if len(snapshot.definitions)
                else ""
            ),
            "source_format": snapshot.source_format,
            "adapter_version": snapshot.adapter_version,
            "tolerance_profile_id": snapshot.tolerance_profile_id,
            "precision_model_id": snapshot.precision_model_id,
            "tolerance_profile_json": snapshot.tolerance_profile_json,
            "precision_model_json": snapshot.precision_model_json,
            "coordinate_frame_json": snapshot.coordinate_frame.to_json(),
            "provenance_json": snapshot.provenance_json,
            "unit_status": snapshot.unit_status,
            "diagnostics_json": snapshot.diagnostics_json,
            "endpoint_cell_width": str(cell_width),
            "sqlite_compile_options": stable_json_dumps(sorted(compile_options)),
        }
        connection.executemany(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            sorted(metadata.items()),
        )
        definitions = snapshot.definitions
        connection.executemany(
            """INSERT INTO definitions(
                row_index, definition_id, layout_id, block_definition_path,
                source_handle, dxf_type, layer
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                (
                    index,
                    str(definitions.definition_ids[index]),
                    str(definitions.layout_ids[index]),
                    str(definitions.block_definition_paths[index]),
                    str(definitions.source_handles[index]),
                    str(definitions.dxf_types[index]),
                    str(definitions.layers[index]),
                )
                for index in range(len(definitions))
            ),
        )
        occurrences = snapshot.occurrences
        definition_rows = np.searchsorted(
            definitions.definition_ids,
            occurrences.definition_ids,
        )
        if len(definition_rows):
            safe = np.minimum(definition_rows, len(definitions) - 1)
            if np.any(definition_rows >= len(definitions)) or np.any(
                definitions.definition_ids[safe] != occurrences.definition_ids
            ):
                raise ValueError("Occurrence references an unknown definition")
        connection.executemany(
            """INSERT INTO occurrences(
                row_index, occurrence_id, definition_row, layout_name, instance_path,
                transform_class, transform_count, transform_chain
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                (
                    index,
                    str(occurrences.occurrence_ids[index]),
                    int(definition_rows[index]),
                    str(occurrences.layout_names[index]),
                    str(occurrences.instance_paths[index]),
                    str(occurrences.transform_classes[index]),
                    int(
                        occurrences.transform_offsets[index + 1]
                        - occurrences.transform_offsets[index]
                    ),
                    sqlite3.Binary(
                        np.ascontiguousarray(
                            occurrences.transforms[
                                occurrences.transform_offsets[index] : occurrences.transform_offsets[index + 1]
                            ],
                            dtype="<f8",
                        ).tobytes()
                    ),
                )
                for index in range(len(occurrences))
            ),
        )
        geometry = snapshot.geometry
        occurrence_rows = np.searchsorted(
            occurrences.occurrence_ids,
            geometry.occurrence_ids,
        )
        if len(occurrence_rows):
            safe = np.minimum(occurrence_rows, len(occurrences) - 1)
            if np.any(occurrence_rows >= len(occurrences)) or np.any(
                occurrences.occurrence_ids[safe] != geometry.occurrence_ids
            ):
                raise ValueError("Geometry references an unknown occurrence")
        connection.executemany(
            "INSERT INTO geometry_entities(row_index, occurrence_row, source_type) VALUES (?, ?, ?)",
            (
                (
                    index,
                    int(occurrence_rows[index]),
                    str(geometry.source_types[index]),
                )
                for index in range(len(geometry))
            ),
        )
        connection.executemany(
            "INSERT INTO entity_rtree(rtree_id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)",
            (
                (
                    index + 1,
                    float(geometry.bounds[index, 0]),
                    float(geometry.bounds[index, 2]),
                    float(geometry.bounds[index, 1]),
                    float(geometry.bounds[index, 3]),
                )
                for index in range(len(geometry))
            ),
        )
        texts = snapshot.texts

        def text_rows():
            for index in range(len(texts)):
                yield (
                    index,
                    str(texts.occurrence_ids[index]),
                    str(texts.raw_text[index]),
                    str(texts.normalized_text[index]),
                    str(texts.plain_text[index]),
                    str(texts.block_attribute_tag[index]),
                    str(texts.block_attribute_value[index]),
                    str(texts.layer_name[index]),
                    str(texts.block_name[index]),
                    str(texts.layout_name[index]),
                    str(texts.drawing_title[index]),
                    float(texts.points[index, 0]),
                    float(texts.points[index, 1]),
                    float(texts.points[index, 2]),
                )

        connection.executemany(
            "INSERT INTO texts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            text_rows(),
        )
        connection.executemany(
            "INSERT INTO text_fts(rowid, occurrence_id, raw_text, normalized_text, plain_text, "
            "block_attribute_tag, block_attribute_value, layer_name, block_name, layout_name, drawing_title) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (row[:11] for row in text_rows()),
        )

        annotations = snapshot.annotations

        def annotation_rows():
            for index in range(len(annotations)):
                definition_start = int(annotations.definition_point_offsets[index])
                definition_end = int(annotations.definition_point_offsets[index + 1])
                boundary_start = int(annotations.boundary_ref_offsets[index])
                boundary_end = int(annotations.boundary_ref_offsets[index + 1])
                diagnostic_start = int(annotations.diagnostic_offsets[index])
                diagnostic_end = int(annotations.diagnostic_offsets[index + 1])
                anchor = annotations.anchor_points[index]
                text_bounds = annotations.text_bounds[index]
                bounds = annotations.bounds[index]
                yield (
                    index,
                    str(annotations.occurrence_ids[index]),
                    str(annotations.definition_ids[index]),
                    str(annotations.annotation_kinds[index]),
                    str(annotations.source_types[index]),
                    (
                        float(annotations.measured_values[index])
                        if annotations.measured_value_present[index]
                        else None
                    ),
                    int(annotations.measured_value_present[index]),
                    str(annotations.text_overrides[index]),
                    int(annotations.text_override_present[index]),
                    (
                        float(annotations.measurement_scales[index])
                        if annotations.measurement_scale_present[index]
                        else None
                    ),
                    int(annotations.measurement_scale_present[index]),
                    stable_json_dumps(
                        tuple(
                            tuple(float(value) for value in point)
                            for point in annotations.definition_points[
                                definition_start:definition_end
                            ]
                        )
                    ),
                    float(anchor[0]) if np.isfinite(anchor[0]) else None,
                    float(anchor[1]) if np.isfinite(anchor[1]) else None,
                    float(anchor[2]) if np.isfinite(anchor[2]) else None,
                    float(text_bounds[0]) if np.isfinite(text_bounds[0]) else None,
                    float(text_bounds[1]) if np.isfinite(text_bounds[1]) else None,
                    float(text_bounds[2]) if np.isfinite(text_bounds[2]) else None,
                    float(text_bounds[3]) if np.isfinite(text_bounds[3]) else None,
                    stable_json_dumps(annotations.target_refs_at(index)),
                    stable_json_dumps(
                        tuple(
                            str(value)
                            for value in annotations.boundary_refs[
                                boundary_start:boundary_end
                            ]
                        )
                    ),
                    str(annotations.pattern_names[index]),
                    int(annotations.pattern_name_present[index]),
                    int(annotations.solid_fill_values[index]),
                    int(annotations.solid_fill_present[index]),
                    float(bounds[0]) if np.isfinite(bounds[0]) else None,
                    float(bounds[1]) if np.isfinite(bounds[1]) else None,
                    float(bounds[2]) if np.isfinite(bounds[2]) else None,
                    float(bounds[3]) if np.isfinite(bounds[3]) else None,
                    stable_json_dumps(
                        tuple(
                            str(value)
                            for value in annotations.diagnostic_codes[
                                diagnostic_start:diagnostic_end
                            ]
                        )
                    ),
                )

        connection.executemany(
            "INSERT INTO annotations VALUES ("
            + ",".join("?" for _ in range(30))
            + ")",
            annotation_rows(),
        )
        connection.executemany(
            "INSERT INTO annotation_rtree VALUES (?, ?, ?, ?, ?)",
            (
                (
                    index,
                    float(annotations.bounds[index, 0]),
                    float(annotations.bounds[index, 2]),
                    float(annotations.bounds[index, 1]),
                    float(annotations.bounds[index, 3]),
                )
                for index in range(len(annotations))
                if np.isfinite(annotations.bounds[index]).all()
            ),
        )

        topology_rows = np.flatnonzero(
            geometry.topology_eligible
            & ~geometry.annotation_derived
            & (geometry.kinds != int(GeometryKind.POINT))
        )
        point_rows = np.flatnonzero(
            (geometry.kinds == int(GeometryKind.POINT))
            & ~geometry.annotation_derived
        )

        def endpoint_rows():
            for geometry_row in topology_rows:
                start = int(geometry.coordinate_offsets[geometry_row])
                end = int(geometry.coordinate_offsets[geometry_row + 1])
                for ordinal, coordinate_index in ((0, start), (1, end - 1)):
                    grid_x, grid_y = (
                        int(item) for item in geometry.grid_coordinates[coordinate_index]
                    )
                    yield (
                        int(geometry_row),
                        ordinal,
                        grid_x,
                        grid_y,
                        grid_x // cell_width,
                        grid_y // cell_width,
                    )
            for geometry_row in point_rows:
                coordinate_index = int(geometry.coordinate_offsets[geometry_row])
                grid_x, grid_y = (
                    int(item) for item in geometry.grid_coordinates[coordinate_index]
                )
                yield (
                    int(geometry_row),
                    0,
                    grid_x,
                    grid_y,
                    grid_x // cell_width,
                    grid_y // cell_width,
                )

        connection.executemany(
            "INSERT INTO endpoint_grid VALUES (?, ?, ?, ?, ?, ?)",
            endpoint_rows(),
        )
        connection.execute(
            "CREATE INDEX endpoint_grid_cell ON endpoint_grid(cell_x, cell_y)"
        )
        face_row = 0
        for artifact, payload_path, payload_sha256 in derived_records:
            connection.execute(
                "INSERT INTO derived_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    artifact.artifact_id,
                    artifact.operator_id,
                    artifact.operator_version,
                    artifact.tolerance_profile_id,
                    artifact.precision_model_id,
                    artifact.input_digest,
                    payload_path,
                    payload_sha256,
                    artifact.decision,
                    stable_json_dumps(artifact.validation_diagnostics),
                ),
            )
            for face in sorted(artifact.faces, key=lambda item: item.face_id):
                connection.execute(
                    "INSERT INTO faces VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        face_row,
                        face.face_id,
                        artifact.artifact_id,
                        face.depth,
                        face.hole_count,
                        face.area,
                        sqlite3.Binary(face.geometry_wkb),
                        face.boundary_json,
                    ),
                )
                connection.execute(
                    "INSERT INTO face_rtree VALUES (?, ?, ?, ?, ?)",
                    (
                        face_row,
                        face.bounds[0],
                        face.bounds[2],
                        face.bounds[1],
                        face.bounds[3],
                    ),
                )
                face_row += 1
        connection.commit()
    finally:
        connection.close()


def _read_columns(connection: sqlite3.Connection, query: str) -> list[tuple[Any, ...]]:
    return [tuple(row) for row in connection.execute(query)]


class SnapshotStore:
    """Create and load immutable SQLite + NPY drawing snapshots."""

    @staticmethod
    def create(
        path: str | Path,
        snapshot: DrawingSnapshot,
        *,
        derived_artifacts: tuple[DerivedArtifactPayload, ...] = (),
    ) -> SnapshotLocation:
        target = Path(path)
        if target.exists():
            manifest_path = target / "manifest.json"
            if manifest_path.is_file():
                manifest = stable_json_loads(manifest_path.read_text(encoding="utf-8"))
                requested = tuple(sorted(item.artifact_id for item in derived_artifacts))
                existing = tuple(sorted(str(item) for item in manifest.get("derived_artifact_ids", ())))
                if (
                    manifest.get("schema_version") == SCHEMA_VERSION
                    and manifest.get("snapshot_id") == snapshot.snapshot_id
                    and requested == existing
                ):
                    errors = SnapshotStore.verify(target)
                    if errors:
                        raise ValueError(
                            "Existing snapshot integrity failure: " + ", ".join(errors)
                        )
                    return SnapshotStore.describe(target)
            raise FileExistsError(f"Refusing to overwrite snapshot directory: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=f"{target.name}.staging-", dir=target.parent))
        try:
            geometry_dir = staging / "geometry"
            geometry_dir.mkdir()
            for field in GEOMETRY_ARRAY_FIELDS:
                np.save(geometry_dir / f"{field}.npy", getattr(snapshot.geometry, field), allow_pickle=False)
            derived_records: list[tuple[DerivedArtifactPayload, str, str]] = []
            for artifact in sorted(derived_artifacts, key=lambda item: item.artifact_id):
                artifact_dir = staging / "derived" / artifact.artifact_id
                artifact_dir.mkdir(parents=True)
                for name, array in sorted(artifact.arrays, key=lambda item: item[0]):
                    if not name or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_" for character in name):
                        raise ValueError(f"Invalid derived array name: {name!r}")
                    np.save(artifact_dir / f"{name}.npy", array, allow_pickle=False)
                payload_file = artifact_dir / "payload.json"
                payload_file.write_text(artifact.json_payload + "\n", encoding="utf-8", newline="\n")
                relative = payload_file.relative_to(staging).as_posix()
                derived_records.append((artifact, relative, sha256_file(str(payload_file))))
            _write_sqlite(staging / "snapshot.sqlite3", snapshot, tuple(derived_records))
            files: list[tuple[str, str, int]] = []
            for file_path in sorted(item for item in staging.rglob("*") if item.is_file()):
                relative = file_path.relative_to(staging).as_posix()
                files.append((relative, sha256_file(str(file_path)), file_path.stat().st_size))
            manifest = {
                "schema_version": SCHEMA_VERSION,
                "snapshot_id": snapshot.snapshot_id,
                "derived_artifact_ids": tuple(
                    sorted(artifact.artifact_id for artifact in derived_artifacts)
                ),
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
        return SnapshotStore.describe(target)

    @staticmethod
    def describe(path: str | Path) -> SnapshotLocation:
        root = Path(path)
        manifest = stable_json_loads((root / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("schema_version") != SCHEMA_VERSION:
            raise ValueError(
                f"Snapshot schema {manifest.get('schema_version')} is not supported; "
                f"expected {SCHEMA_VERSION}"
            )
        file_hashes = tuple((str(row[0]), str(row[1])) for row in manifest["files"])
        size = sum(item.stat().st_size for item in root.rglob("*") if item.is_file())
        return SnapshotLocation(str(root.resolve()), str(manifest["snapshot_id"]), size, file_hashes)

    @staticmethod
    def verify(path: str | Path) -> tuple[str, ...]:
        root = Path(path)
        manifest = stable_json_loads((root / "manifest.json").read_text(encoding="utf-8"))
        errors: list[str] = []
        if manifest.get("schema_version") != SCHEMA_VERSION:
            errors.append(
                f"schema_version:{manifest.get('schema_version')}!={SCHEMA_VERSION}"
            )
        expected_files = {"manifest.json"}
        for relative, expected_hash, expected_size in manifest["files"]:
            expected_files.add(str(relative))
            file_path = root / relative
            if not file_path.is_file():
                errors.append(f"missing:{relative}")
                continue
            if file_path.stat().st_size != int(expected_size):
                errors.append(f"size:{relative}")
            if sha256_file(str(file_path)) != expected_hash:
                errors.append(f"sha256:{relative}")
        actual_files = {
            item.relative_to(root).as_posix()
            for item in root.rglob("*")
            if item.is_file()
        }
        errors.extend(
            f"unexpected:{relative}"
            for relative in sorted(actual_files - expected_files)
        )
        return tuple(errors)

    @staticmethod
    def load(path: str | Path, *, verify: bool = True) -> DrawingSnapshot:
        root = Path(path)
        if verify:
            errors = SnapshotStore.verify(root)
            if errors:
                raise ValueError("Snapshot integrity failure: " + ", ".join(errors))
        connection = sqlite3.connect(root / "snapshot.sqlite3")
        try:
            assert_sqlite_capabilities(connection)
            metadata = dict(connection.execute("SELECT key, value FROM metadata"))
            definition_rows = _read_columns(
                connection,
                "SELECT definition_id,layout_id,block_definition_path,source_handle,dxf_type,layer "
                "FROM definitions ORDER BY row_index",
            )
            if definition_rows:
                definition_columns = list(zip(*definition_rows))
                definitions = EntityDefinitionTable(
                    definition_columns[0],
                    [metadata["file_id"]] * len(definition_rows),
                    *definition_columns[1:],
                )
            else:
                definitions = EntityDefinitionTable.empty()
            occurrence_rows = _read_columns(
                connection,
                "SELECT occurrence_id,definition_row,layout_name,instance_path,transform_class,"
                "transform_count,transform_chain "
                "FROM occurrences ORDER BY row_index",
            )
            transform_offsets = [0]
            transforms: list[np.ndarray] = []
            for row in occurrence_rows:
                transform_count = int(row[5])
                chain = np.frombuffer(bytes(row[6]), dtype="<f8")
                if chain.size != transform_count * 16:
                    raise ValueError("Occurrence transform BLOB has an invalid size")
                chain = chain.reshape((transform_count, 4, 4))
                transforms.extend(chain)
                transform_offsets.append(len(transforms))
            occurrences = EntityOccurrenceTable(
                occurrence_ids=[row[0] for row in occurrence_rows],
                definition_ids=[definitions.definition_ids[int(row[1])] for row in occurrence_rows],
                layout_names=[row[2] for row in occurrence_rows],
                instance_paths=[row[3] for row in occurrence_rows],
                transform_classes=[row[4] for row in occurrence_rows],
                transform_offsets=transform_offsets,
                transforms=np.asarray(transforms, dtype=np.float64).reshape((-1, 4, 4)),
            ) if occurrence_rows else EntityOccurrenceTable.empty()
            geometry_rows = _read_columns(
                connection,
                "SELECT occurrence_row,source_type FROM geometry_entities ORDER BY row_index",
            )
            arrays = {
                field: np.load(root / "geometry" / f"{field}.npy", mmap_mode="r", allow_pickle=False)
                for field in GEOMETRY_ARRAY_FIELDS
            }
            geometry = GeometryStore(
                occurrence_ids=[occurrences.occurrence_ids[int(row[0])] for row in geometry_rows],
                definition_ids=[occurrences.definition_ids[int(row[0])] for row in geometry_rows],
                source_types=[row[1] for row in geometry_rows],
                **arrays,
            )
            text_rows = _read_columns(
                connection,
                "SELECT occurrence_id,raw_text,normalized_text,plain_text,block_attribute_tag,"
                "block_attribute_value,layer_name,block_name,layout_name,drawing_title,x,y,z "
                "FROM texts ORDER BY row_index",
            )
            texts = TextStore(
                occurrence_ids=[row[0] for row in text_rows],
                raw_text=[row[1] for row in text_rows],
                normalized_text=[row[2] for row in text_rows],
                plain_text=[row[3] for row in text_rows],
                block_attribute_tag=[row[4] for row in text_rows],
                block_attribute_value=[row[5] for row in text_rows],
                layer_name=[row[6] for row in text_rows],
                block_name=[row[7] for row in text_rows],
                layout_name=[row[8] for row in text_rows],
                drawing_title=[row[9] for row in text_rows],
                points=[row[10:13] for row in text_rows],
            ) if text_rows else TextStore.empty()
            annotation_rows = _read_columns(
                connection,
                "SELECT occurrence_id,definition_id,annotation_kind,source_type,"
                "measured_value,measured_value_present,text_override,text_override_present,"
                "measurement_scale,measurement_scale_present,definition_points_json,"
                "anchor_x,anchor_y,anchor_z,text_min_x,text_min_y,text_max_x,text_max_y,"
                "target_refs_json,boundary_refs_json,pattern_name,pattern_name_present,"
                "solid_fill_value,solid_fill_present,min_x,min_y,max_x,max_y,"
                "diagnostic_codes_json FROM annotations ORDER BY row_index",
            )
            annotation_records: list[AnnotationRecord] = []
            for row in annotation_rows:
                target_values = stable_json_loads(str(row[18]))
                target_refs = tuple(
                    AnnotationTargetRef(
                        ref_kind=str(value["ref_kind"]),
                        occurrence_id=value.get("occurrence_id"),
                        source_handle=value.get("source_handle"),
                        point=(
                            tuple(float(item) for item in value["point"])
                            if value.get("point") is not None
                            else None
                        ),
                        authored=bool(value.get("authored", True)),
                    )
                    for value in target_values
                )
                anchor = (
                    tuple(float(value) for value in row[11:14])
                    if all(value is not None for value in row[11:14])
                    else None
                )
                stored_text_bounds = (
                    tuple(float(value) for value in row[14:18])
                    if all(value is not None for value in row[14:18])
                    else None
                )
                stored_bounds = (
                    tuple(float(value) for value in row[24:28])
                    if all(value is not None for value in row[24:28])
                    else None
                )
                annotation_records.append(
                    AnnotationRecord(
                        occurrence_id=str(row[0]),
                        definition_id=str(row[1]),
                        annotation_kind=str(row[2]),
                        source_type=str(row[3]),
                        measured_value=float(row[4]) if bool(row[5]) else None,
                        text_override=str(row[6]) if bool(row[7]) else None,
                        measurement_scale=float(row[8]) if bool(row[9]) else None,
                        definition_points=tuple(
                            tuple(float(item) for item in point)
                            for point in stable_json_loads(str(row[10]))
                        ),
                        anchor_point=anchor,
                        text_bounds=stored_text_bounds,
                        target_refs=target_refs,
                        boundary_refs=tuple(
                            str(value)
                            for value in stable_json_loads(str(row[19]))
                        ),
                        pattern_name=str(row[20]) if bool(row[21]) else None,
                        is_solid_fill=bool(row[22]) if bool(row[23]) else None,
                        bounds=stored_bounds,
                        diagnostic_codes=tuple(
                            str(value)
                            for value in stable_json_loads(str(row[28]))
                        ),
                    )
                )
            annotations = AnnotationStore.from_records(annotation_records)
        finally:
            connection.close()
        snapshot = DrawingSnapshot.create(
            source_path=metadata["source_path"],
            source_file_sha256=metadata["source_file_sha256"],
            source_format=metadata["source_format"],
            adapter_version=metadata["adapter_version"],
            tolerance_profile_id=metadata["tolerance_profile_id"],
            precision_model_id=metadata["precision_model_id"],
            tolerance_profile_json=metadata["tolerance_profile_json"],
            precision_model_json=metadata["precision_model_json"],
            coordinate_frame=CoordinateFrame.from_json(metadata["coordinate_frame_json"]),
            definitions=definitions,
            occurrences=occurrences,
            geometry=geometry,
            texts=texts,
            annotations=annotations,
            provenance_json=metadata["provenance_json"],
            unit_status=metadata["unit_status"],
            diagnostics_json=metadata["diagnostics_json"],
        )
        manifest = stable_json_loads((root / "manifest.json").read_text(encoding="utf-8"))
        if snapshot.snapshot_id != manifest["snapshot_id"]:
            raise ValueError("Snapshot manifest and database identifiers disagree")
        return snapshot
