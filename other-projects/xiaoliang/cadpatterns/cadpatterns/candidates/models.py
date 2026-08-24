from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
import shapely

from cadkernel.contracts import Decision, ToleranceProfile
from cadkernel.ir import DrawingSnapshot
from cadkernel.topology import TopologyCompilation, face_polygon

from cadpatterns.contracts import (
    DetectorSpec,
    PatternEdge,
    PatternInstance,
    PatternMember,
    PatternRef,
    PatternStatus,
    PatternToleranceProfile,
    ProofGrade,
    ReferenceKind,
    TraceEvent,
    VirtualPatternGeometry,
    create_pattern_instance,
)
from cadpatterns.features import PatternFeatureStore, quantize_feature_value
from cadpatterns.ontology import PatternSpec, ensure_canonical_pattern_type
from cadpatterns.scopes import ScopeTree


@dataclass(frozen=True, slots=True)
class DetectionContext:
    snapshot: DrawingSnapshot
    topology: TopologyCompilation
    scopes: ScopeTree
    features: PatternFeatureStore
    specs: tuple[PatternSpec, ...]
    profile: PatternToleranceProfile

    @property
    def upstream_tolerance(self) -> ToleranceProfile:
        return ToleranceProfile.from_json(self.snapshot.tolerance_profile_json)

    def spec_for(self, pattern_type: str) -> PatternSpec:
        canonical = ensure_canonical_pattern_type(pattern_type)
        for spec in self.specs:
            if spec.pattern_type == canonical:
                return spec
        raise KeyError(f"No PatternSpec for {canonical!r}")


@dataclass(frozen=True, slots=True)
class DetectionBatch:
    instances: tuple[PatternInstance, ...] = ()
    edges: tuple[PatternEdge, ...] = ()
    virtual_geometries: tuple[VirtualPatternGeometry, ...] = ()
    trace: tuple[TraceEvent, ...] = ()

    @classmethod
    def combine(cls, batches: Iterable["DetectionBatch"]) -> "DetectionBatch":
        instances: list[PatternInstance] = []
        edges: list[PatternEdge] = []
        virtual_geometries: list[VirtualPatternGeometry] = []
        trace: list[TraceEvent] = []
        for batch in batches:
            instances.extend(batch.instances)
            edges.extend(batch.edges)
            virtual_geometries.extend(batch.virtual_geometries)
            trace.extend(batch.trace)
        return cls(
            instances=tuple(
                sorted(
                    instances,
                    key=lambda item: (item.pattern_type, item.scope_id, item.pattern_key, item.detection_id),
                )
            ),
            edges=tuple(sorted(edges, key=lambda item: item.edge_id)),
            virtual_geometries=tuple(
                sorted(virtual_geometries, key=lambda item: item.virtual_geometry_id)
            ),
            trace=tuple(sorted(trace, key=lambda item: item.trace_id)),
        )


def proof_grade_for_topology(
    context: DetectionContext,
    desired: ProofGrade = ProofGrade.STRUCTURALLY_PROVEN,
) -> tuple[ProofGrade, tuple[str, ...]]:
    if context.topology.decision is Decision.AMBIGUOUS:
        return (
            ProofGrade.TOLERANCE_DERIVED,
            ("upstream topology is ambiguous because snap or validation evidence conflicts",),
        )
    return desired, ()


def topology_is_unsupported(context: DetectionContext) -> bool:
    return context.topology.decision in {Decision.REJECTED, Decision.UNSUPPORTED}


def make_candidate(
    context: DetectionContext,
    detector: DetectorSpec,
    *,
    pattern_type: str,
    scope_id: str,
    members: tuple[PatternMember, ...],
    proof_grade: ProofGrade,
    score: float,
    features: tuple[tuple[str, Any], ...] = (),
    bounds: tuple[float, float, float, float] | None = None,
    virtual_geometry_ids: tuple[str, ...] = (),
    assumptions: tuple[str, ...] = (),
    status: PatternStatus = PatternStatus.CANDIDATE,
) -> PatternInstance:
    spec = context.spec_for(pattern_type)
    quantized_features = tuple(
        (name, quantize_feature_value(value, spec.feature_precision))
        for name, value in features
    )
    quantized_score = quantize_feature_value(float(score), spec.feature_precision)
    return create_pattern_instance(
        snapshot_id=context.snapshot.snapshot_id,
        pattern_type=pattern_type,
        scope_id=scope_id,
        spec_version=spec.spec_version,
        detector_id=detector.detector_id,
        detector_version=detector.version,
        feature_set_version=spec.feature_set_version,
        resolver_version=spec.resolver_version,
        pattern_tolerance_profile_id=context.profile.profile_id,
        status=status,
        proof_grade=proof_grade,
        score=quantized_score,
        members=members,
        features=quantized_features,
        bounds=bounds,
        virtual_geometry_ids=virtual_geometry_ids,
        assumptions=assumptions,
    )


def ref(context: DetectionContext, kind: ReferenceKind, ref_id: str) -> PatternRef:
    return PatternRef(kind, ref_id, context.snapshot.snapshot_id)


def member(
    context: DetectionContext,
    role: str,
    kind: ReferenceKind,
    ref_id: str,
    *,
    ordinal: int = 0,
    parameters: tuple[tuple[str, Any], ...] = (),
) -> PatternMember:
    return PatternMember(role, ref(context, kind, ref_id), ordinal, parameters)


def geometry_rows_for_occurrences(
    context: DetectionContext,
    occurrence_ids: tuple[str, ...],
) -> np.ndarray:
    if not occurrence_ids:
        return np.empty(0, dtype=np.int64)
    return context.snapshot.geometry.positions(occurrence_ids)


def face_occurrence_ids(
    context: DetectionContext,
    face_id: str,
) -> tuple[str, ...]:
    face = next(item for item in context.topology.dcel.faces if item.face_id == face_id)
    ring_by_id = {ring.ring_id: ring for ring in context.topology.dcel.rings}
    arrangement = context.topology.arrangement
    values: set[str] = set()
    for ring_id in (face.outer_ring_id, *face.hole_ring_ids):
        for half_edge in ring_by_id[ring_id].half_edges:
            edge_index = int(context.topology.dcel.half_edge_edges[half_edge])
            start = int(arrangement.support_offsets[edge_index])
            end = int(arrangement.support_offsets[edge_index + 1])
            values.update(
                str(value)
                for value in arrangement.support_occurrence_ids[start:end]
            )
    return tuple(sorted(values))


def physical_face_polygon(
    context: DetectionContext,
    face_id: str,
) -> shapely.Polygon | None:
    face = next(item for item in context.topology.dcel.faces if item.face_id == face_id)
    polygon = face_polygon(context.topology.arrangement, context.topology.dcel, face)
    if polygon is None:
        return None
    return shapely.normalize(
        shapely.transform(polygon, context.snapshot.coordinate_frame.dequantize)
    )


def unsupported_candidate(
    context: DetectionContext,
    detector: DetectorSpec,
    *,
    pattern_type: str,
    scope_id: str,
    reason: str,
) -> PatternInstance:
    return make_candidate(
        context,
        detector,
        pattern_type=pattern_type,
        scope_id=scope_id,
        members=(),
        proof_grade=ProofGrade.TOLERANCE_DERIVED,
        score=0.0,
        assumptions=(reason,),
        status=PatternStatus.UNSUPPORTED,
    )
