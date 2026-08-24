from __future__ import annotations

from collections import Counter
import math

import numpy as np

from cadkernel.contracts import stable_id, stable_json_loads

from cadpatterns.candidates import (
    DetectionBatch,
    DetectionContext,
    make_candidate,
    member,
    proof_grade_for_topology,
)
from cadpatterns.contracts import (
    DetectorSpec,
    ProofGrade,
    ReferenceKind,
    ScopeType,
    TraceEvent,
    detector_registry,
)
from cadpatterns.features import quantize_feature_value
from cadpatterns.ontology import GENERIC_SYMBOL_LIKE_CLUSTER


BLOCK_INSTANCE_SPEC = DetectorSpec(
    detector_id="motif.block_instance",
    version="1.0.0",
    pattern_type=GENERIC_SYMBOL_LIKE_CLUSTER,
    summary="Group expanded instances by definition facts and confirm them with geometry signatures",
)

GEOMETRY_SIGNATURE_SPEC = DetectorSpec(
    detector_id="motif.geometry_signature",
    version="1.0.0",
    pattern_type=GENERIC_SYMBOL_LIKE_CLUSTER,
    summary="Build translation- and rotation-invariant local geometry signatures",
)


def _rows_for_occurrences(context: DetectionContext, occurrence_ids: tuple[str, ...]) -> np.ndarray:
    return (
        context.snapshot.geometry.positions(occurrence_ids)
        if occurrence_ids
        else np.empty(0, dtype=np.int64)
    )


def _signature_payload(context: DetectionContext, rows: np.ndarray):
    geometry = context.snapshot.geometry
    kinds = []
    lengths: list[float] = []
    turns: list[float] = []
    centers: list[np.ndarray] = []
    for row_value in rows:
        row = int(row_value)
        kinds.append(int(geometry.kinds[row]))
        start = int(geometry.coordinate_offsets[row])
        end = int(geometry.coordinate_offsets[row + 1])
        points = geometry.coordinates[start:end, :2]
        centers.append(np.mean(points, axis=0))
        if len(points) < 2:
            continue
        vectors = np.diff(points, axis=0)
        segment_lengths = np.linalg.norm(vectors, axis=1)
        lengths.extend(float(value) for value in segment_lengths if value > 0.0)
        for left, right in zip(vectors, vectors[1:]):
            denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
            if denominator <= 0.0:
                continue
            cross = float(left[0] * right[1] - left[1] * right[0])
            dot = float(np.dot(left, right))
            turn = math.atan2(cross, dot) / math.pi
            turns.append(abs(turn) if context.profile.mirror_invariant else turn)
    if not kinds:
        return None
    scale = (
        float(np.median(np.asarray(lengths, dtype=np.float64)))
        if lengths
        else context.snapshot.coordinate_frame.grid_size
    )
    scale = max(scale, context.snapshot.coordinate_frame.grid_size)
    normalized_lengths = tuple(sorted(value / scale for value in lengths))
    center_distances = []
    for left_position, left in enumerate(centers):
        for right in centers[left_position + 1 :]:
            center_distances.append(float(np.linalg.norm(left - right)) / scale)
    precision = context.spec_for(GENERIC_SYMBOL_LIKE_CLUSTER).feature_precision
    return (
        tuple(sorted(kinds)),
        quantize_feature_value(normalized_lengths, precision),
        quantize_feature_value(tuple(sorted(turns)), precision),
        quantize_feature_value(tuple(sorted(center_distances)), precision),
    )


def geometry_signature(context: DetectionContext, occurrence_ids: tuple[str, ...]) -> str | None:
    payload = _signature_payload(context, _rows_for_occurrences(context, occurrence_ids))
    if payload is None:
        return None
    return "signature:" + stable_id(
        "generic-geometry-signature",
        payload,
        context.profile.mirror_invariant,
        length=len(context.snapshot.snapshot_id),
    )


def _ports(context: DetectionContext, occurrence_ids: tuple[str, ...], scope):
    incidence = context.topology.incidence_graph
    allowed = set(occurrence_ids)
    edge_occurrences = np.asarray(
        [
            str(context.snapshot.geometry.occurrence_ids[row])
            for row in incidence.edge_geometry_rows
        ]
    )
    result = []
    for node_index, node_id in enumerate(incidence.node_ids):
        edge_positions = np.flatnonzero(
            np.any(incidence.edge_node_indices == node_index, axis=1)
        )
        if len(edge_positions) < 2:
            continue
        inside = [
            int(position)
            for position in edge_positions
            if str(edge_occurrences[position]) in allowed
        ]
        if not inside or len(inside) == len(edge_positions):
            continue
        directions = []
        node_point = incidence.node_grid_points[node_index]
        for position in inside:
            nodes = incidence.edge_node_indices[position]
            other = int(nodes[1]) if int(nodes[0]) == node_index else int(nodes[0])
            vector_grid = incidence.node_grid_points[other] - node_point
            vector = vector_grid.astype(np.float64)
            local_x = float(vector[0] * scope.local_frame.axis_x[0] + vector[1] * scope.local_frame.axis_x[1])
            local_y = float(vector[0] * scope.local_frame.axis_y[0] + vector[1] * scope.local_frame.axis_y[1])
            directions.append(math.atan2(local_y, local_x) / math.pi)
        result.append(
            (
                str(node_id),
                tuple(sorted(directions)),
                tuple(sorted(str(edge_occurrences[position]) for position in inside)),
            )
        )
    return tuple(sorted(result))


def _scope_for_members(context: DetectionContext, occurrence_ids: tuple[str, ...]):
    members = set(occurrence_ids)
    choices = [
        scope
        for scope in context.scopes.scopes
        if scope.scope_type
        in {
            ScopeType.SPATIAL_CLUSTER,
            ScopeType.CONNECTED_COMPONENT,
            ScopeType.LAYOUT,
            ScopeType.DRAWING,
        }
        and members.issubset(set(scope.occurrence_ids))
    ]
    return min(choices, key=lambda item: (len(item.occurrence_ids), item.scope_id))


def _instance_groups(context: DetectionContext):
    occurrence_paths = {
        str(occurrence_id): stable_json_loads(str(path))
        for occurrence_id, path in zip(
            context.snapshot.occurrences.occurrence_ids,
            context.snapshot.occurrences.instance_paths,
        )
    }
    groups: dict[str, list[str]] = {}
    for occurrence_id in context.snapshot.geometry.occurrence_ids:
        value = str(occurrence_id)
        path = occurrence_paths.get(value, ())
        if isinstance(path, list) and path and str(path[0]).startswith("insert:"):
            groups.setdefault(str(path[0]), []).append(value)
    return tuple(
        (key, tuple(sorted(values))) for key, values in sorted(groups.items())
    )


@detector_registry.detector(BLOCK_INSTANCE_SPEC)
def detect_block_instances(context: DetectionContext) -> DetectionBatch:
    grouped = []
    for instance_key, occurrence_ids in _instance_groups(context):
        rows = _rows_for_occurrences(context, occurrence_ids)
        definition_group = tuple(
            sorted(set(str(value) for value in context.snapshot.geometry.definition_ids[rows]))
        )
        signature = geometry_signature(context, occurrence_ids)
        if signature is not None:
            grouped.append((definition_group, signature, instance_key, occurrence_ids))
    signature_counts = Counter(
        (definition_group, signature)
        for definition_group, signature, _, _ in grouped
    )
    proof_grade, topology_assumptions = proof_grade_for_topology(
        context, ProofGrade.TOLERANCE_DERIVED
    )
    instances = []
    for definition_group, signature, _, occurrence_ids in grouped:
        scope = _scope_for_members(context, occurrence_ids)
        confirmed_count = signature_counts[(definition_group, signature)]
        definition_fingerprint = "definition-group:" + stable_id(
            "generic-definition-group",
            definition_group,
            length=len(context.snapshot.snapshot_id),
        )
        instances.append(
            make_candidate(
                context,
                BLOCK_INSTANCE_SPEC,
                pattern_type=GENERIC_SYMBOL_LIKE_CLUSTER,
                scope_id=scope.scope_id,
                members=tuple(
                    member(context, "cluster_source", ReferenceKind.OCCURRENCE, value)
                    for value in occurrence_ids
                ),
                proof_grade=proof_grade,
                score=1.0,
                features=(
                    ("definition_group", definition_fingerprint),
                    ("definition_group_size", len(definition_group)),
                    ("detection_method", "block_instance"),
                    ("geometry_signature", signature),
                    ("geometry_signature_confirmation_count", confirmed_count),
                    ("ports", _ports(context, occurrence_ids, scope)),
                ),
                bounds=scope.bounds,
                assumptions=topology_assumptions
                + ("definition grouping is accepted only together with a geometry signature",),
            )
        )
    return DetectionBatch(instances=tuple(instances))


@detector_registry.detector(GEOMETRY_SIGNATURE_SPEC)
def detect_geometry_signatures(context: DetectionContext) -> DetectionBatch:
    scopes = context.scopes.of_type(ScopeType.SPATIAL_CLUSTER)
    proof_grade, assumptions = proof_grade_for_topology(
        context, ProofGrade.TOLERANCE_DERIVED
    )
    instances = []
    for scope in scopes:
        signature = geometry_signature(context, scope.occurrence_ids)
        if signature is None:
            continue
        ports = _ports(context, scope.occurrence_ids, scope)
        compactness = 1.0 / (1.0 + len(ports))
        instances.append(
            make_candidate(
                context,
                GEOMETRY_SIGNATURE_SPEC,
                pattern_type=GENERIC_SYMBOL_LIKE_CLUSTER,
                scope_id=scope.scope_id,
                members=tuple(
                    member(context, "cluster_source", ReferenceKind.OCCURRENCE, value)
                    for value in scope.occurrence_ids
                ),
                proof_grade=proof_grade,
                score=max(0.0, min(1.0, compactness)),
                features=(
                    ("detection_method", "geometry_signature"),
                    ("geometry_signature", signature),
                    ("ports", ports),
                ),
                bounds=scope.bounds,
                assumptions=assumptions,
            )
        )
    return DetectionBatch(
        instances=tuple(instances),
        trace=(
            TraceEvent.create(
                "detector",
                GEOMETRY_SIGNATURE_SPEC.detector_id,
                "local geometry signatures and external ports extracted",
                (("candidate_count", len(instances)),),
            ),
        ),
    )
