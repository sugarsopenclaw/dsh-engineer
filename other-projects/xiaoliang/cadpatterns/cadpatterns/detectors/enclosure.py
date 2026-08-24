from __future__ import annotations

import networkx as nx
import numpy as np
import shapely

from cadpatterns.candidates import (
    DetectionBatch,
    DetectionContext,
    face_occurrence_ids,
    make_candidate,
    member,
    physical_face_polygon,
    proof_grade_for_topology,
    ref,
    topology_is_unsupported,
    unsupported_candidate,
)
from cadpatterns.contracts import (
    DetectorSpec,
    PatternMember,
    ProofGrade,
    ReferenceKind,
    ScopeType,
    TraceEvent,
    VirtualPatternGeometry,
    detector_registry,
)
from cadpatterns.ontology import GENERIC_ENCLOSURE_CANDIDATE


DCEL_FACE_SPEC = DetectorSpec(
    detector_id="enclosure.dcel_face",
    version="1.0.0",
    pattern_type=GENERIC_ENCLOSURE_CANDIDATE,
    summary="Promote each validated bounded DCEL face as an enclosure candidate",
)

MERGED_FACE_SPEC = DetectorSpec(
    detector_id="enclosure.merged_face",
    version="1.0.0",
    pattern_type=GENERIC_ENCLOSURE_CANDIDATE,
    summary="Merge adjacent validated faces across a shared edge",
)

GAP_BRIDGED_SPEC = DetectorSpec(
    detector_id="enclosure.gap_bridged",
    version="1.0.0",
    pattern_type=GENERIC_ENCLOSURE_CANDIDATE,
    summary="Bridge nearby dangling endpoints and locally polygonize inferred closure",
)


def _scope_for_face(context: DetectionContext, face_id: str):
    return next(
        scope
        for scope in context.scopes.of_type(ScopeType.ENCLOSURE)
        if scope.source_ref == face_id
    )


def _container_scope(
    context: DetectionContext,
    occurrence_ids: tuple[str, ...],
):
    members = set(occurrence_ids)
    choices = [
        scope
        for scope in context.scopes.scopes
        if scope.scope_type
        in {ScopeType.SPATIAL_CLUSTER, ScopeType.LAYOUT, ScopeType.DRAWING}
        and members.issubset(set(scope.occurrence_ids))
    ]
    return min(choices, key=lambda scope: (len(scope.occurrence_ids), scope.scope_id))


def _face_members(
    context: DetectionContext,
    face_ids: tuple[str, ...],
    occurrence_ids: tuple[str, ...],
) -> tuple[PatternMember, ...]:
    values = [
        member(context, "bounded_face", ReferenceKind.FACE, face_id, ordinal=ordinal)
        for ordinal, face_id in enumerate(face_ids)
    ]
    values.extend(
        member(context, "boundary_source", ReferenceKind.OCCURRENCE, occurrence_id)
        for occurrence_id in occurrence_ids
    )
    return tuple(values)


def _unsupported_batch(context: DetectionContext, detector: DetectorSpec) -> DetectionBatch:
    drawing = context.scopes.of_type(ScopeType.DRAWING)[0]
    return DetectionBatch(
        instances=(
            unsupported_candidate(
                context,
                detector,
                pattern_type=GENERIC_ENCLOSURE_CANDIDATE,
                scope_id=drawing.scope_id,
                reason="DCEL-dependent detection is gated by rejected or unsupported topology",
            ),
        )
    )


@detector_registry.detector(DCEL_FACE_SPEC)
def detect_dcel_faces(context: DetectionContext) -> DetectionBatch:
    if topology_is_unsupported(context):
        return _unsupported_batch(context, DCEL_FACE_SPEC)
    proof_grade, assumptions = proof_grade_for_topology(context)
    instances = []
    for face in context.topology.dcel.faces:
        polygon = physical_face_polygon(context, face.face_id)
        if polygon is None:
            continue
        occurrences = face_occurrence_ids(context, face.face_id)
        scope = _scope_for_face(context, face.face_id)
        instances.append(
            make_candidate(
                context,
                DCEL_FACE_SPEC,
                pattern_type=GENERIC_ENCLOSURE_CANDIDATE,
                scope_id=scope.scope_id,
                members=_face_members(context, (face.face_id,), occurrences),
                proof_grade=proof_grade,
                score=1.0,
                features=(
                    ("area", float(polygon.area)),
                    ("detection_method", "dcel_face"),
                    ("face_id", face.face_id),
                    ("face_depth", face.depth),
                    ("adjacent_face_ids", face.adjacent_face_ids),
                ),
                bounds=tuple(float(value) for value in shapely.bounds(polygon)),
                assumptions=assumptions,
            )
        )
    return DetectionBatch(
        instances=tuple(instances),
        trace=(
            TraceEvent.create(
                "detector",
                DCEL_FACE_SPEC.detector_id,
                "bounded DCEL faces materialized",
                (("candidate_count", len(instances)),),
            ),
        ),
    )


@detector_registry.detector(MERGED_FACE_SPEC)
def detect_merged_faces(context: DetectionContext) -> DetectionBatch:
    if topology_is_unsupported(context):
        return _unsupported_batch(context, MERGED_FACE_SPEC)
    proof_grade, assumptions = proof_grade_for_topology(context)
    face_by_id = {face.face_id: face for face in context.topology.dcel.faces}
    pairs = {
        tuple(sorted((face.face_id, adjacent)))
        for face in context.topology.dcel.faces
        for adjacent in face.adjacent_face_ids
        if adjacent in face_by_id
    }
    instances = []
    for left_id, right_id in sorted(pairs):
        left = physical_face_polygon(context, left_id)
        right = physical_face_polygon(context, right_id)
        if left is None or right is None:
            continue
        merged = shapely.normalize(shapely.union(left, right))
        if shapely.get_type_id(merged) != shapely.GeometryType.POLYGON or not bool(shapely.is_valid(merged)):
            continue
        occurrences = tuple(
            sorted(
                set(face_occurrence_ids(context, left_id))
                | set(face_occurrence_ids(context, right_id))
            )
        )
        scope = _container_scope(context, occurrences)
        envelope_area = float(shapely.area(shapely.envelope(merged)))
        rectangularity = float(merged.area) / envelope_area if envelope_area > 0.0 else 0.0
        instances.append(
            make_candidate(
                context,
                MERGED_FACE_SPEC,
                pattern_type=GENERIC_ENCLOSURE_CANDIDATE,
                scope_id=scope.scope_id,
                members=_face_members(context, (left_id, right_id), occurrences),
                proof_grade=proof_grade,
                score=max(0.0, min(1.0, rectangularity)),
                features=(
                    ("area", float(merged.area)),
                    ("detection_method", "merged_face"),
                    ("merged_face_ids", (left_id, right_id)),
                    ("rectangularity", rectangularity),
                ),
                bounds=tuple(float(value) for value in shapely.bounds(merged)),
                assumptions=assumptions,
            )
        )
    return DetectionBatch(instances=tuple(instances))


def _dangling_pairs(context: DetectionContext):
    incidence = context.topology.incidence_graph
    degrees = np.bincount(
        incidence.edge_node_indices.reshape(-1), minlength=incidence.node_count
    )
    dangling = np.flatnonzero(degrees == 1)
    if len(dangling) < 2:
        return ()
    graph = incidence.to_networkx()
    node_ids = incidence.node_ids
    points = context.snapshot.coordinate_frame.dequantize(
        incidence.node_grid_points[dangling]
    )
    candidates = []
    for left_position, left_index in enumerate(dangling):
        left_id = str(node_ids[left_index])
        for right_position in range(left_position + 1, len(dangling)):
            right_index = int(dangling[right_position])
            right_id = str(node_ids[right_index])
            if not nx.has_path(graph, left_id, right_id):
                continue
            distance = float(np.linalg.norm(points[left_position] - points[right_position]))
            candidates.append((distance, left_id, right_id, int(left_index), right_index))
    return tuple(sorted(candidates))


def _incident_occurrence(context: DetectionContext, node_index: int) -> str:
    incidence = context.topology.incidence_graph
    edge_positions = np.flatnonzero(np.any(incidence.edge_node_indices == node_index, axis=1))
    edge_row = int(incidence.edge_geometry_rows[int(edge_positions[0])])
    return str(context.snapshot.geometry.occurrence_ids[edge_row])


@detector_registry.detector(GAP_BRIDGED_SPEC)
def detect_gap_bridged(context: DetectionContext) -> DetectionBatch:
    if topology_is_unsupported(context):
        return _unsupported_batch(context, GAP_BRIDGED_SPEC)
    incidence = context.topology.incidence_graph
    arrangement = context.topology.arrangement
    if len(arrangement.edge_vertices):
        physical_vertices = context.snapshot.coordinate_frame.dequantize(
            arrangement.vertices_grid
        )
        base_lines = tuple(
            shapely.LineString(physical_vertices[edge])
            for edge in arrangement.edge_vertices
        )
    else:
        base_lines = ()
    existing_faces = {
        bytes(shapely.to_wkb(polygon, byte_order=1, include_srid=False))
        for face in context.topology.dcel.faces
        if (polygon := physical_face_polygon(context, face.face_id)) is not None
    }
    node_lookup = {
        str(node_id): index for index, node_id in enumerate(incidence.node_ids)
    }
    instances = []
    virtual_geometries = []
    occupied_nodes: set[str] = set()
    for distance, left_id, right_id, left_index, right_index in _dangling_pairs(context):
        if left_id in occupied_nodes or right_id in occupied_nodes or distance <= 0.0:
            continue
        occurrences = tuple(
            sorted(
                {
                    _incident_occurrence(context, left_index),
                    _incident_occurrence(context, right_index),
                }
            )
        )
        scope = _container_scope(context, occurrences)
        maximum_gap = context.profile.gap_bridge_ratio * scope.local_frame.scale
        if maximum_gap <= 0.0 or distance > maximum_gap:
            continue
        grid_points = incidence.node_grid_points[
            np.asarray((node_lookup[left_id], node_lookup[right_id]), dtype=np.int64)
        ]
        physical_points = context.snapshot.coordinate_frame.dequantize(grid_points)
        coordinates = tuple(
            (float(point[0]), float(point[1])) for point in physical_points
        )
        source_refs = (
            ref(context, ReferenceKind.NODE, left_id),
            ref(context, ReferenceKind.NODE, right_id),
        )
        virtual = VirtualPatternGeometry.create(
            snapshot_id=context.snapshot.snapshot_id,
            geometry_kind="line_string",
            coordinates=coordinates,
            source_refs=source_refs,
            assumptions=("nearby dangling endpoints are treated as a missing boundary fragment",),
        )
        bridge = shapely.LineString(coordinates)
        polygonized = tuple(shapely.get_parts(shapely.polygonize((*base_lines, bridge))))
        inferred = [
            shapely.normalize(polygon)
            for polygon in polygonized
            if bool(shapely.covered_by(bridge, shapely.boundary(polygon)))
            and bytes(shapely.to_wkb(shapely.normalize(polygon), byte_order=1, include_srid=False))
            not in existing_faces
        ]
        if not inferred:
            continue
        polygon = min(
            inferred,
            key=lambda item: (float(item.area), bytes(shapely.to_wkb(item))),
        )
        pattern_members = [
            member(context, "gap_endpoint", ReferenceKind.NODE, left_id),
            member(context, "gap_endpoint", ReferenceKind.NODE, right_id),
            member(
                context,
                "inferred_bridge",
                ReferenceKind.VIRTUAL_GEOMETRY,
                virtual.virtual_geometry_id,
            ),
        ]
        pattern_members.extend(
            member(context, "boundary_source", ReferenceKind.OCCURRENCE, value)
            for value in occurrences
        )
        instances.append(
            make_candidate(
                context,
                GAP_BRIDGED_SPEC,
                pattern_type=GENERIC_ENCLOSURE_CANDIDATE,
                scope_id=scope.scope_id,
                members=tuple(pattern_members),
                proof_grade=ProofGrade.INFERRED_FROM_MISSING_GEOMETRY,
                score=max(0.0, min(1.0, 1.0 - distance / maximum_gap)),
                features=(
                    ("area", float(polygon.area)),
                    ("bridge_length", distance),
                    ("bridge_length_ratio", distance / scope.local_frame.scale),
                    ("detection_method", "gap_bridged"),
                ),
                bounds=tuple(float(value) for value in shapely.bounds(polygon)),
                virtual_geometry_ids=(virtual.virtual_geometry_id,),
                assumptions=(
                    "closure exists only after adding a virtual bridge; source geometry remains immutable",
                ),
            )
        )
        virtual_geometries.append(virtual)
        occupied_nodes.update((left_id, right_id))
    return DetectionBatch(
        instances=tuple(instances),
        virtual_geometries=tuple(virtual_geometries),
    )
