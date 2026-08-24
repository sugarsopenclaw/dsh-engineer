from __future__ import annotations

from dataclasses import dataclass

from cadkernel._ids import stable_id
from cadkernel.ir.coordinate_frame import CoordinateFrame
from cadkernel.ir.annotations import AnnotationStore
from cadkernel.ir.entities import EntityDefinitionTable, EntityOccurrenceTable, TextStore
from cadkernel.ir.geometry import GeometryStore


@dataclass(frozen=True, slots=True)
class DerivedArtifactKey:
    snapshot_id: str
    operator_id: str
    operator_version: str
    tolerance_profile_id: str
    precision_model_id: str
    input_digest: str

    @property
    def artifact_id(self) -> str:
        return stable_id("derived-artifact", self, length=64)


@dataclass(frozen=True, slots=True, eq=False)
class DrawingSnapshot:
    snapshot_id: str
    source_path: str
    source_file_sha256: str
    source_format: str
    adapter_version: str
    tolerance_profile_id: str
    precision_model_id: str
    tolerance_profile_json: str
    precision_model_json: str
    coordinate_frame: CoordinateFrame
    definitions: EntityDefinitionTable
    occurrences: EntityOccurrenceTable
    geometry: GeometryStore
    texts: TextStore
    annotations: AnnotationStore
    provenance_json: str
    unit_status: str = "unknown"
    diagnostics_json: str = "[]"

    def __post_init__(self) -> None:
        expected = self.compute_snapshot_id(
            self.source_file_sha256,
            self.adapter_version,
            self.tolerance_profile_id,
            self.precision_model_id,
        )
        if self.snapshot_id != expected:
            raise ValueError(f"Snapshot id mismatch: expected {expected}, got {self.snapshot_id}")
        if self.coordinate_frame.precision_model_id != self.precision_model_id:
            raise ValueError("Coordinate frame and snapshot precision models differ")

    @staticmethod
    def compute_snapshot_id(
        source_file_sha256: str,
        adapter_version: str,
        tolerance_profile_id: str,
        precision_model_id: str,
    ) -> str:
        return stable_id(
            "drawing-snapshot",
            source_file_sha256,
            adapter_version,
            tolerance_profile_id,
            precision_model_id,
            length=64,
        )

    @classmethod
    def create(
        cls,
        *,
        source_path: str,
        source_file_sha256: str,
        source_format: str,
        adapter_version: str,
        tolerance_profile_id: str,
        precision_model_id: str,
        tolerance_profile_json: str,
        precision_model_json: str,
        coordinate_frame: CoordinateFrame,
        definitions: EntityDefinitionTable,
        occurrences: EntityOccurrenceTable,
        geometry: GeometryStore,
        texts: TextStore,
        annotations: AnnotationStore,
        provenance_json: str,
        unit_status: str = "unknown",
        diagnostics_json: str = "[]",
    ) -> "DrawingSnapshot":
        snapshot_id = cls.compute_snapshot_id(
            source_file_sha256,
            adapter_version,
            tolerance_profile_id,
            precision_model_id,
        )
        return cls(
            snapshot_id=snapshot_id,
            source_path=source_path,
            source_file_sha256=source_file_sha256,
            source_format=source_format,
            adapter_version=adapter_version,
            tolerance_profile_id=tolerance_profile_id,
            precision_model_id=precision_model_id,
            tolerance_profile_json=tolerance_profile_json,
            precision_model_json=precision_model_json,
            coordinate_frame=coordinate_frame,
            definitions=definitions,
            occurrences=occurrences,
            geometry=geometry,
            texts=texts,
            annotations=annotations,
            provenance_json=provenance_json,
            unit_status=unit_status,
            diagnostics_json=diagnostics_json,
        )
