from __future__ import annotations

from dataclasses import dataclass

from cadkernel._serialization import stable_json_dumps
from cadkernel.adapters.conformance import MLightConformanceReport
from cadkernel.contracts import Diagnostic
from cadkernel.topology import IncidenceFacts


@dataclass(frozen=True, slots=True)
class CoverageDiagnostic:
    code: str
    severity: str
    message: str
    entity_type: str | None = None
    count: int | None = None
    required_action: str | None = None


@dataclass(frozen=True, slots=True)
class DrawingCoverageReport:
    execution_status: str
    total_source_entities: int
    parsed: int
    geometry_supported: int
    indexed: int
    topology_eligible: int
    unsupported_by_type: tuple[tuple[str, int], ...]
    unit_status: str
    transform_failures: tuple[str, ...]
    approximation_count: int
    diagnostics: tuple[CoverageDiagnostic, ...]
    parsed_ratio: float
    geometry_supported_ratio: float
    indexed_ratio: float
    topology_eligible_ratio: float


@dataclass(frozen=True, slots=True)
class AreaDistribution:
    count: int
    minimum: float | None
    median: float | None
    maximum: float | None
    total: float
    unit: str


@dataclass(frozen=True, slots=True)
class FaceFacts:
    closed_face_count: int
    faces_with_holes: int
    hole_count: int
    containment_max_depth: int
    area_distribution: AreaDistribution
    dcel_valid: bool
    euler_left: int
    euler_right: int
    validation_diagnostics: tuple[str, ...]
    compilation_decision: str
    compilation_diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True, slots=True)
class TextFacts:
    text_record_count: int
    fts_term_count: int
    block_attribute_record_count: int
    block_attribute_coverage: float
    nearest_geometry_distance_buckets: tuple[tuple[str, int], ...]


@dataclass(frozen=True, slots=True)
class AnnotationFacts:
    annotation_record_count: int
    source_dimension_count: int
    dimension_record_count: int
    dimension_measured_count: int
    dimension_diagnostic_count: int
    dimension_fact_coverage: int
    text_override_count: int
    target_ref_count: int
    annotation_derived_geometry_count: int


@dataclass(frozen=True, slots=True)
class RepeatedDefinition:
    definition_entity_id: str
    instance_count: int


@dataclass(frozen=True, slots=True)
class GeometryDuplicateGroup:
    geometry_signature: str
    occurrence_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DuplicateFacts:
    repeated_definitions: tuple[RepeatedDefinition, ...]
    geometry_candidate_groups: tuple[GeometryDuplicateGroup, ...]
    repeated_definition_count: int
    geometry_candidate_group_count: int
    details_truncated: bool


@dataclass(frozen=True, slots=True)
class StageTiming:
    stage: str
    seconds: float


@dataclass(frozen=True, slots=True)
class ReportScale:
    definition_count: int
    occurrence_count: int
    geometry_count: int
    coordinate_count: int
    arrangement_vertex_count: int
    arrangement_edge_count: int
    arrangement_support_fragment_count: int
    arrangement_unsupported_edge_count: int
    snapshot_size_bytes: int
    peak_memory_bytes: int


@dataclass(frozen=True, slots=True)
class CapabilityReport:
    schema_version: int
    snapshot_id: str
    source_path: str
    coordinate_frame_id: str
    tolerance_profile_id: str
    precision_model_id: str
    coverage: DrawingCoverageReport
    topology: IncidenceFacts
    faces: FaceFacts
    text: TextFacts
    annotation: AnnotationFacts
    duplicates: DuplicateFacts
    scale: ReportScale
    timings: tuple[StageTiming, ...]
    mlight_conformance: MLightConformanceReport | None = None

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)
