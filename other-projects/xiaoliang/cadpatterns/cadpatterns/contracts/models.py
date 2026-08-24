from __future__ import annotations

from dataclasses import dataclass, fields, replace
from enum import Enum
import math
from typing import Any

from cadkernel.contracts import stable_id, stable_json_dumps


class PatternStatus(str, Enum):
    CANDIDATE = "candidate"
    SUPPORTED = "supported"
    SUPPRESSED = "suppressed"
    CONFLICTING = "conflicting"
    UNSUPPORTED = "unsupported"


class ProofGrade(str, Enum):
    STRUCTURALLY_PROVEN = "structurally_proven"
    TOLERANCE_DERIVED = "tolerance_derived"
    INFERRED_FROM_MISSING_GEOMETRY = "inferred_from_missing_geometry"
    HEURISTIC = "heuristic"


class GeometryProvenance(str, Enum):
    SOURCE_FACT = "source_fact"
    DERIVED_TOPOLOGY = "derived_topology"
    PATTERN_DERIVED = "pattern_derived"
    VIRTUAL_INFERENCE = "virtual_inference"


class ScopeType(str, Enum):
    DRAWING = "drawing"
    LAYOUT = "layout"
    SPATIAL_CLUSTER = "spatial_cluster"
    CONNECTED_COMPONENT = "connected_component"
    ENCLOSURE = "enclosure"


class ReferenceKind(str, Enum):
    OCCURRENCE = "occurrence"
    TEXT = "text"
    ANNOTATION = "annotation"
    FACE = "face"
    NODE = "node"
    PATTERN = "pattern"
    VIRTUAL_GEOMETRY = "virtual_geometry"
    CROSSING = "crossing"


class RelationType(str, Enum):
    CONTAINS = "contains"
    INSIDE = "inside"
    ADJACENT_TO = "adjacent_to"
    ALIGNED_WITH = "aligned_with"
    CONNECTED_TO = "connected_to"
    CROSSES = "crosses"
    LABELS = "labels"
    REPEATS = "repeats"
    INSTANCE_OF = "instance_of"
    CONFLICTS_WITH = "conflicts_with"
    ALTERNATIVE_TO = "alternative_to"
    DERIVED_FROM = "derived_from"
    POINTS_TO = "points_to"


@dataclass(frozen=True, slots=True)
class PatternToleranceProfile:
    """Dimensionless second-layer tolerances, scaled in a local scope."""

    upstream_tolerance_profile_id: str
    scope_cluster_gap_ratio: float = 0.25
    gap_bridge_ratio: float = 0.35
    text_height_ratio: float = 0.08
    text_character_width_ratio: float = 0.60
    text_inline_gap_ratio: float = 2.0
    text_line_alignment_ratio: float = 0.60
    text_line_spacing_ratio: float = 1.80
    text_rotation_ratio: float = 0.03
    title_height_ratio: float = 1.25
    orthogonal_ratio: float = 0.02
    grid_coordinate_merge_ratio: float = 0.02
    cell_bounds_ratio: float = 0.05
    motif_min_instances: int = 2
    mirror_invariant: bool = True
    junction_min_degree: int = 3
    crossing_boundary_ratio: float = 1.20
    nms_overlap_ratio: float = 0.85
    nested_overlap_ratio: float = 0.98
    sheet_min_rectangularity: float = 0.80
    sheet_min_peripherality: float = 0.70
    sheet_min_internal_coverage: float = 0.70
    sheet_min_whitespace_stability: float = 0.20
    profile_name: str = "normal"

    def __post_init__(self) -> None:
        if not self.upstream_tolerance_profile_id:
            raise ValueError("PatternToleranceProfile requires an upstream profile id")
        for item in fields(self):
            value = getattr(self, item.name)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            if value < 0:
                raise ValueError(f"{item.name} must be non-negative")
        if self.motif_min_instances < 2:
            raise ValueError("motif_min_instances must be at least two")
        if self.junction_min_degree < 3:
            raise ValueError("junction_min_degree must be at least three")
        for name in (
            "sheet_min_rectangularity",
            "sheet_min_peripherality",
            "sheet_min_internal_coverage",
            "sheet_min_whitespace_stability",
        ):
            if getattr(self, name) > 1.0:
                raise ValueError(f"{name} must be within [0, 1]")

    @property
    def profile_id(self) -> str:
        return "pattern-tolerance:" + stable_id(
            "pattern-tolerance-profile", self, length=64
        )


@dataclass(frozen=True, slots=True)
class PatternLocalFrame:
    origin: tuple[float, float]
    axis_x: tuple[float, float]
    axis_y: tuple[float, float]
    scale: float
    scale_sources: tuple[str, ...]

    def __post_init__(self) -> None:
        if not math.isfinite(self.scale) or self.scale <= 0:
            raise ValueError("PatternLocalFrame.scale must be finite and positive")

    def to_local(self, point: tuple[float, float]) -> tuple[float, float]:
        delta_x = point[0] - self.origin[0]
        delta_y = point[1] - self.origin[1]
        return (
            (delta_x * self.axis_x[0] + delta_y * self.axis_x[1]) / self.scale,
            (delta_x * self.axis_y[0] + delta_y * self.axis_y[1]) / self.scale,
        )

    def to_world(self, point: tuple[float, float]) -> tuple[float, float]:
        scaled_x = point[0] * self.scale
        scaled_y = point[1] * self.scale
        return (
            self.origin[0]
            + scaled_x * self.axis_x[0]
            + scaled_y * self.axis_y[0],
            self.origin[1]
            + scaled_x * self.axis_x[1]
            + scaled_y * self.axis_y[1],
        )


@dataclass(frozen=True, slots=True)
class PatternScope:
    scope_id: str
    snapshot_id: str
    scope_type: ScopeType
    parent_scope_id: str | None
    occurrence_ids: tuple[str, ...]
    text_occurrence_ids: tuple[str, ...]
    bounds: tuple[float, float, float, float]
    local_frame: PatternLocalFrame
    source_ref: str | None = None

    @classmethod
    def create(
        cls,
        *,
        snapshot_id: str,
        scope_type: ScopeType,
        parent_scope_id: str | None,
        occurrence_ids: tuple[str, ...],
        text_occurrence_ids: tuple[str, ...],
        bounds: tuple[float, float, float, float],
        local_frame: PatternLocalFrame,
        source_ref: str | None = None,
    ) -> "PatternScope":
        occurrences = tuple(sorted(set(occurrence_ids)))
        texts = tuple(sorted(set(text_occurrence_ids)))
        digest = stable_id(
            "pattern-scope",
            snapshot_id,
            scope_type.value,
            parent_scope_id,
            occurrences,
            texts,
            source_ref,
            length=64,
        )
        return cls(
            scope_id="scope:" + digest,
            snapshot_id=snapshot_id,
            scope_type=scope_type,
            parent_scope_id=parent_scope_id,
            occurrence_ids=occurrences,
            text_occurrence_ids=texts,
            bounds=tuple(float(value) for value in bounds),
            local_frame=local_frame,
            source_ref=source_ref,
        )


@dataclass(frozen=True, slots=True)
class PatternRef:
    kind: ReferenceKind
    ref_id: str
    snapshot_id: str

    def identity(self) -> tuple[str, str]:
        return self.kind.value, self.ref_id


@dataclass(frozen=True, slots=True)
class PatternMember:
    role: str
    ref: PatternRef
    ordinal: int = 0
    parameters: tuple[tuple[str, Any], ...] = ()

    def identity(self) -> tuple[str, str, str]:
        return self.role, self.ref.kind.value, self.ref.ref_id


@dataclass(frozen=True, slots=True)
class VirtualPatternGeometry:
    virtual_geometry_id: str
    snapshot_id: str
    geometry_kind: str
    coordinates: tuple[tuple[float, float], ...]
    provenance: GeometryProvenance
    source_refs: tuple[PatternRef, ...]
    assumptions: tuple[str, ...] = ()

    @classmethod
    def create(
        cls,
        *,
        snapshot_id: str,
        geometry_kind: str,
        coordinates: tuple[tuple[float, float], ...],
        source_refs: tuple[PatternRef, ...],
        assumptions: tuple[str, ...] = (),
    ) -> "VirtualPatternGeometry":
        normalized = tuple(tuple(float(value) for value in point) for point in coordinates)
        digest = stable_id(
            "virtual-pattern-geometry",
            snapshot_id,
            geometry_kind,
            normalized,
            tuple(sorted(ref.identity() for ref in source_refs)),
            assumptions,
            length=64,
        )
        return cls(
            virtual_geometry_id="virtual:" + digest,
            snapshot_id=snapshot_id,
            geometry_kind=geometry_kind,
            coordinates=normalized,
            provenance=GeometryProvenance.VIRTUAL_INFERENCE,
            source_refs=tuple(sorted(source_refs, key=lambda ref: ref.identity())),
            assumptions=tuple(assumptions),
        )


@dataclass(frozen=True, slots=True)
class PatternInstance:
    pattern_key: str
    detection_id: str
    snapshot_id: str
    pattern_type: str
    scope_id: str
    spec_version: str
    detector_id: str
    detector_version: str
    feature_set_version: str
    resolver_version: str
    pattern_tolerance_profile_id: str
    status: PatternStatus
    proof_grade: ProofGrade
    score: float
    members: tuple[PatternMember, ...]
    features: tuple[tuple[str, Any], ...] = ()
    bounds: tuple[float, float, float, float] | None = None
    virtual_geometry_ids: tuple[str, ...] = ()
    assumptions: tuple[str, ...] = ()
    conflicts: tuple[str, ...] = ()
    alternatives: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.pattern_key.startswith("pattern:"):
            raise ValueError("pattern_key must use the pattern:<64hex> form")
        if not self.detection_id.startswith("detection:"):
            raise ValueError("detection_id must use the detection:<64hex> form")
        if not math.isfinite(self.score) or not 0.0 <= self.score <= 1.0:
            raise ValueError("Pattern score must be finite and in [0, 1]")
        if tuple(sorted(self.members, key=lambda item: item.identity())) != self.members:
            raise ValueError("Pattern members must be in canonical order")
        names = tuple(name for name, _ in self.features)
        if names != tuple(sorted(names)) or len(names) != len(set(names)):
            raise ValueError("Pattern features must be uniquely name-sorted")

    def feature(self, name: str, default: Any = None) -> Any:
        for feature_name, value in self.features:
            if feature_name == name:
                return value
        return default

    def resolved(
        self,
        status: PatternStatus,
        *,
        conflicts: tuple[str, ...] = (),
        alternatives: tuple[str, ...] = (),
    ) -> "PatternInstance":
        return replace(
            self,
            status=status,
            conflicts=tuple(sorted(set(conflicts))),
            alternatives=tuple(sorted(set(alternatives))),
        )


@dataclass(frozen=True, slots=True)
class PatternEdge:
    edge_id: str
    snapshot_id: str
    relation: RelationType
    source_pattern_key: str
    target: PatternRef
    proof_grade: ProofGrade
    score: float = 1.0
    evidence: tuple[PatternRef, ...] = ()

    @classmethod
    def create(
        cls,
        *,
        snapshot_id: str,
        relation: RelationType,
        source_pattern_key: str,
        target: PatternRef,
        proof_grade: ProofGrade,
        score: float = 1.0,
        evidence: tuple[PatternRef, ...] = (),
    ) -> "PatternEdge":
        normalized_evidence = tuple(sorted(evidence, key=lambda ref: ref.identity()))
        digest = stable_id(
            "pattern-edge",
            snapshot_id,
            relation.value,
            source_pattern_key,
            target.identity(),
            tuple(ref.identity() for ref in normalized_evidence),
            length=64,
        )
        return cls(
            edge_id="edge:" + digest,
            snapshot_id=snapshot_id,
            relation=relation,
            source_pattern_key=source_pattern_key,
            target=target,
            proof_grade=proof_grade,
            score=float(score),
            evidence=normalized_evidence,
        )


@dataclass(frozen=True, slots=True)
class FeatureRecord:
    scope_id: str
    subject_ref: str
    name: str
    value: Any
    provenance: GeometryProvenance

    def key(self) -> tuple[str, str, str]:
        return self.scope_id, self.subject_ref, self.name


@dataclass(frozen=True, slots=True)
class TraceEvent:
    trace_id: str
    stage: str
    subject_id: str
    message: str
    details: tuple[tuple[str, Any], ...] = ()

    @classmethod
    def create(
        cls,
        stage: str,
        subject_id: str,
        message: str,
        details: tuple[tuple[str, Any], ...] = (),
    ) -> "TraceEvent":
        normalized = tuple(sorted(details, key=lambda item: item[0]))
        return cls(
            trace_id="trace:"
            + stable_id(
                "pattern-trace", stage, subject_id, message, normalized, length=64
            ),
            stage=stage,
            subject_id=subject_id,
            message=message,
            details=normalized,
        )


@dataclass(frozen=True, slots=True)
class DetectorSpec:
    detector_id: str
    version: str
    pattern_type: str
    summary: str
    requires_topology: bool = True
    deterministic: bool = True
    # Additional pattern types this producer may emit beyond pattern_type
    # (companion types whose specs must be loaded alongside the producer).
    emits: tuple[str, ...] = ()
    # Pattern types read from the candidate pool (composers only).
    consumes: tuple[str, ...] = ()

    @property
    def detector_spec_id(self) -> str:
        return "detector-spec:" + stable_id(
            "detector-spec", self.detector_id, self.version, length=64
        )


def canonical_member_identities(
    members: tuple[PatternMember, ...],
) -> tuple[tuple[str, str, str], ...]:
    return tuple(sorted(member.identity() for member in members))


def create_pattern_instance(
    *,
    snapshot_id: str,
    pattern_type: str,
    scope_id: str,
    spec_version: str,
    detector_id: str,
    detector_version: str,
    feature_set_version: str,
    resolver_version: str,
    pattern_tolerance_profile_id: str,
    status: PatternStatus,
    proof_grade: ProofGrade,
    score: float,
    members: tuple[PatternMember, ...],
    features: tuple[tuple[str, Any], ...] = (),
    bounds: tuple[float, float, float, float] | None = None,
    virtual_geometry_ids: tuple[str, ...] = (),
    assumptions: tuple[str, ...] = (),
) -> PatternInstance:
    ordered_members = tuple(sorted(members, key=lambda item: item.identity()))
    pattern_digest = stable_id(
        "pattern-key",
        pattern_type,
        scope_id,
        canonical_member_identities(ordered_members),
        length=64,
    )
    pattern_key = "pattern:" + pattern_digest
    detection_id = "detection:" + stable_id(
        "pattern-detection",
        pattern_key,
        spec_version,
        detector_id,
        detector_version,
        feature_set_version,
        resolver_version,
        pattern_tolerance_profile_id,
        length=64,
    )
    normalized_features = tuple(sorted(features, key=lambda item: item[0]))
    stable_json_dumps(normalized_features)
    return PatternInstance(
        pattern_key=pattern_key,
        detection_id=detection_id,
        snapshot_id=snapshot_id,
        pattern_type=pattern_type,
        scope_id=scope_id,
        spec_version=spec_version,
        detector_id=detector_id,
        detector_version=detector_version,
        feature_set_version=feature_set_version,
        resolver_version=resolver_version,
        pattern_tolerance_profile_id=pattern_tolerance_profile_id,
        status=status,
        proof_grade=proof_grade,
        score=float(score),
        members=ordered_members,
        features=normalized_features,
        bounds=None if bounds is None else tuple(float(value) for value in bounds),
        virtual_geometry_ids=tuple(sorted(set(virtual_geometry_ids))),
        assumptions=tuple(assumptions),
    )
