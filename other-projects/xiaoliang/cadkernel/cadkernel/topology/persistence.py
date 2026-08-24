from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sqlite3
import time
from typing import Callable

import numpy as np
import shapely

from cadkernel._ids import stable_id
from cadkernel._serialization import stable_json_dumps, stable_json_loads
from cadkernel.contracts import (
    Decision,
    Diagnostic,
    DiagnosticSeverity,
    Exactness,
    OperatorSpec,
    OpResult,
    OpStatus,
    ToleranceProfile,
    operator_registry,
)
from cadkernel.indexes import DerivedArtifactPayload, FaceIndexRecord, SnapshotStore
from cadkernel.ir import DrawingSnapshot
from cadkernel.repair import (
    EndpointTable,
    SnapConflict,
    SnapPlan,
    extract_endpoints,
    propose,
)
from cadkernel.topology.arrangement import Arrangement, build_arrangement
from cadkernel.topology.dcel import (
    Dcel,
    DcelFace,
    DcelRing,
    DcelValidation,
    build_dcel,
    face_polygon,
)
from cadkernel.topology.incidence import (
    IncidenceFacts,
    IncidenceGraph,
    build_incidence_graph,
    graph_facts,
)


@dataclass(frozen=True, slots=True)
class TopologyStageOutcome:
    operator_id: str
    status: OpStatus
    decision: Decision
    exactness: Exactness
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True, slots=True)
class TopologyCompilation:
    endpoints: EndpointTable
    snap_plan: SnapPlan
    incidence_graph: IncidenceGraph
    incidence_facts: IncidenceFacts
    arrangement: Arrangement
    dcel: Dcel
    stage_outcomes: tuple[TopologyStageOutcome, ...]
    decision: Decision
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True, slots=True)
class TopologyArtifactDocument:
    schema_version: int
    snapshot_id: str
    decision: Decision
    diagnostics: tuple[Diagnostic, ...]
    stage_outcomes: tuple[TopologyStageOutcome, ...]
    graph_id: str
    arrangement_id: str
    dcel_id: str
    snap_plan: object
    incidence_facts: IncidenceFacts
    rings: tuple[object, ...]
    faces: tuple[object, ...]
    validation: object


@dataclass(frozen=True, slots=True)
class SnapPlanSummary:
    snapshot_id: str
    tolerance_profile_id: str
    graph_id: str
    cluster_count: int
    move_count: int
    affected_entity_count: int
    conflicts: tuple[object, ...]


TOPOLOGY_COMPILE_SPEC = OperatorSpec(
    "topology.compile",
    "1.2.0",
    "Compile snap, incidence, arrangement and validated DCEL facts",
    "DrawingSnapshot",
    "TopologyCompilation",
    Exactness.FLOATING_CONSTRUCTION,
)

TOPOLOGY_LOAD_SPEC = OperatorSpec(
    "topology.load",
    "1.0.0",
    "Load and validate a persisted topology compilation without mutating its snapshot",
    "SnapshotPath+DrawingSnapshot",
    "TopologyCompilation",
    Exactness.EXACT,
)


def _stage_outcome(operator_id: str, result: OpResult[object]) -> TopologyStageOutcome:
    return TopologyStageOutcome(
        operator_id=operator_id,
        status=result.status,
        decision=result.decision,
        exactness=result.exactness,
        diagnostics=result.diagnostics,
    )


def _compilation_decision(outcomes: tuple[TopologyStageOutcome, ...]) -> Decision:
    if any(
        outcome.status in {OpStatus.FAILED, OpStatus.CONVERSION_REQUIRED}
        or outcome.decision is Decision.REJECTED
        for outcome in outcomes
    ):
        return Decision.REJECTED
    if any(
        outcome.status is OpStatus.UNSUPPORTED
        or outcome.decision is Decision.UNSUPPORTED
        for outcome in outcomes
    ):
        return Decision.UNSUPPORTED
    if any(
        outcome.status in {OpStatus.AMBIGUOUS, OpStatus.PARTIAL}
        or outcome.decision is Decision.AMBIGUOUS
        for outcome in outcomes
    ):
        return Decision.AMBIGUOUS
    if any(outcome.decision is Decision.APPROXIMATED for outcome in outcomes):
        return Decision.APPROXIMATED
    return Decision.COMPUTED


def _compilation_diagnostics(
    outcomes: tuple[TopologyStageOutcome, ...],
) -> tuple[Diagnostic, ...]:
    diagnostics: list[Diagnostic] = []
    seen: set[tuple[object, ...]] = set()
    for outcome in outcomes:
        for diagnostic in outcome.diagnostics:
            key = (
                diagnostic.code,
                diagnostic.message,
                diagnostic.severity,
                diagnostic.details,
            )
            if key not in seen:
                seen.add(key)
                diagnostics.append(diagnostic)
    decision = _compilation_decision(outcomes)
    if decision is not Decision.COMPUTED and not diagnostics:
        affected = tuple(
            outcome.operator_id
            for outcome in outcomes
            if outcome.status is not OpStatus.SUCCESS
            or outcome.decision is not Decision.COMPUTED
        )
        diagnostics.append(
            Diagnostic(
                code="TOPOLOGY_COMPILATION_NON_COMPUTED",
                message=f"Topology compilation returned decision {decision.value!r}.",
                severity=DiagnosticSeverity.ERROR,
                details=(("operator_ids", ",".join(affected)),),
            )
        )
    return tuple(diagnostics)


@operator_registry.operator(TOPOLOGY_COMPILE_SPEC)
def compile_topology(
    snapshot: DrawingSnapshot,
    *,
    tolerance: ToleranceProfile | None = None,
    incidence_detail_limit: int | None = 10_000,
    stage_timing_callback: Callable[[str, float], None] | None = None,
) -> TopologyCompilation:
    profile = tolerance or ToleranceProfile.from_json(snapshot.tolerance_profile_json)

    def record_timing(stage: str, started: float) -> None:
        if stage_timing_callback is not None:
            stage_timing_callback(stage, time.perf_counter() - started)

    started = time.perf_counter()
    endpoints = extract_endpoints(snapshot)
    snap_result = propose(snapshot, tolerance=profile, endpoints=endpoints)
    snap_plan = snap_result.value
    if snap_plan is None:
        raise RuntimeError("snap.propose returned no plan")
    record_timing("snap_plan", started)

    started = time.perf_counter()
    incidence_result = build_incidence_graph(snapshot, endpoints, snap_plan)
    incidence = incidence_result.value
    if incidence is None:
        raise RuntimeError("IncidenceGraph construction returned no graph")
    facts_result = graph_facts(snapshot, incidence, detail_limit=incidence_detail_limit)
    facts = facts_result.value
    if facts is None:
        raise RuntimeError("IncidenceGraph facts returned no value")
    record_timing("incidence_graph", started)

    started = time.perf_counter()
    arrangement_result = build_arrangement(snapshot, endpoints=endpoints, snap_plan=snap_plan)
    arrangement = arrangement_result.value
    if arrangement is None:
        raise RuntimeError("Arrangement construction returned no value")
    record_timing("arrangement", started)

    started = time.perf_counter()
    dcel_result = build_dcel(snapshot, arrangement)
    dcel = dcel_result.value
    if dcel is None:
        raise RuntimeError("DCEL construction returned no value")
    record_timing("dcel", started)

    outcomes = (
        _stage_outcome("snap.propose", snap_result),
        _stage_outcome("topology.build_incidence_graph", incidence_result),
        _stage_outcome("graph.incidence_facts", facts_result),
        _stage_outcome("topology.build_arrangement", arrangement_result),
        _stage_outcome("topology.build_dcel", dcel_result),
    )
    return TopologyCompilation(
        endpoints=endpoints,
        snap_plan=snap_plan,
        incidence_graph=incidence,
        incidence_facts=facts,
        arrangement=arrangement,
        dcel=dcel,
        stage_outcomes=outcomes,
        decision=_compilation_decision(outcomes),
        diagnostics=_compilation_diagnostics(outcomes),
    )


def _diagnostic_from_dict(value: object) -> Diagnostic:
    if not isinstance(value, dict):
        raise TypeError("Persisted diagnostic must be an object")
    return Diagnostic.from_dict(value)


def _stage_outcome_from_dict(value: object) -> TopologyStageOutcome:
    if not isinstance(value, dict):
        raise TypeError("Persisted topology stage outcome must be an object")
    return TopologyStageOutcome(
        operator_id=str(value["operator_id"]),
        status=OpStatus(value["status"]),
        decision=Decision(value["decision"]),
        exactness=Exactness(value["exactness"]),
        diagnostics=tuple(
            _diagnostic_from_dict(item) for item in value.get("diagnostics", ())
        ),
    )


def _incidence_facts_from_dict(value: object) -> IncidenceFacts:
    if not isinstance(value, dict):
        raise TypeError("Persisted incidence facts must be an object")
    return IncidenceFacts(
        graph_id=str(value["graph_id"]),
        node_count=int(value["node_count"]),
        edge_count=int(value["edge_count"]),
        connected_components=tuple(
            tuple(str(member) for member in component)
            for component in value.get("connected_components", ())
        ),
        degrees=tuple(
            (str(node_id), int(degree))
            for node_id, degree in value.get("degrees", ())
        ),
        isolated_nodes=tuple(str(item) for item in value.get("isolated_nodes", ())),
        dangling_nodes=tuple(str(item) for item in value.get("dangling_nodes", ())),
        bridge_occurrence_ids=tuple(
            str(item) for item in value.get("bridge_occurrence_ids", ())
        ),
        articulation_points=tuple(
            str(item) for item in value.get("articulation_points", ())
        ),
        cycles=tuple(
            tuple(str(member) for member in cycle)
            for cycle in value.get("cycles", ())
        ),
        minimum_cycle_basis=tuple(
            tuple(str(member) for member in cycle)
            for cycle in value.get("minimum_cycle_basis", ())
        ),
        connected_component_count=int(value["connected_component_count"]),
        isolated_node_count=int(value["isolated_node_count"]),
        dangling_node_count=int(value["dangling_node_count"]),
        bridge_count=int(value["bridge_count"]),
        articulation_point_count=int(value["articulation_point_count"]),
        cycle_count=int(value["cycle_count"]),
        minimum_cycle_basis_count=int(value["minimum_cycle_basis_count"]),
        details_truncated=bool(value["details_truncated"]),
    )


def _ring_from_dict(value: object) -> DcelRing:
    if not isinstance(value, dict):
        raise TypeError("Persisted DCEL ring must be an object")
    return DcelRing(
        ring_id=str(value["ring_id"]),
        half_edges=tuple(int(item) for item in value.get("half_edges", ())),
        vertex_indices=tuple(int(item) for item in value.get("vertex_indices", ())),
        signed_area_grid=float(value["signed_area_grid"]),
    )


def _face_from_dict(value: object) -> DcelFace:
    if not isinstance(value, dict):
        raise TypeError("Persisted DCEL face must be an object")
    parent = value.get("parent_face_id")
    return DcelFace(
        face_id=str(value["face_id"]),
        outer_ring_id=str(value["outer_ring_id"]),
        hole_ring_ids=tuple(str(item) for item in value.get("hole_ring_ids", ())),
        parent_face_id=None if parent is None else str(parent),
        depth=int(value["depth"]),
        area_grid=float(value["area_grid"]),
        adjacent_face_ids=tuple(
            str(item) for item in value.get("adjacent_face_ids", ())
        ),
    )


def _validation_from_dict(value: object) -> DcelValidation:
    if not isinstance(value, dict):
        raise TypeError("Persisted DCEL validation must be an object")
    return DcelValidation(
        valid=bool(value["valid"]),
        vertex_count=int(value["vertex_count"]),
        edge_count=int(value["edge_count"]),
        face_count_including_unbounded=int(value["face_count_including_unbounded"]),
        connected_component_count=int(value["connected_component_count"]),
        euler_left=int(value["euler_left"]),
        euler_right=int(value["euler_right"]),
        twin_complete=bool(value["twin_complete"]),
        next_complete=bool(value["next_complete"]),
        face_assignment_consistent=bool(value["face_assignment_consistent"]),
        face_geometry_valid=bool(value["face_geometry_valid"]),
        invalid_face_count=int(value["invalid_face_count"]),
        area_consistent=bool(value["area_consistent"]),
        dcel_area_grid=float(value["dcel_area_grid"]),
        polygonized_area_grid=float(value["polygonized_area_grid"]),
        diagnostics=tuple(str(item) for item in value.get("diagnostics", ())),
    )


def _load_failure(snapshot: DrawingSnapshot, message: str) -> OpResult[TopologyCompilation]:
    return OpResult(
        status=OpStatus.FAILED,
        value=None,
        decision=Decision.REJECTED,
        exactness=Exactness.EXACT,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        diagnostics=(
            Diagnostic(
                code="TOPOLOGY_LOAD_FAILED",
                message=message,
                severity=DiagnosticSeverity.ERROR,
            ),
        ),
        derivation=("validated immutable topology artifact read",),
    )


def _load_array(directory: Path, name: str, *, dtype: object | None = None) -> np.ndarray:
    array = np.load(directory / f"{name}.npy", allow_pickle=False)
    if dtype is not None:
        array = array.astype(dtype, copy=False)
    return array


@operator_registry.operator(TOPOLOGY_LOAD_SPEC)
def load_topology(
    snapshot_path: str | Path,
    snapshot: DrawingSnapshot,
) -> OpResult[TopologyCompilation]:
    """Restore a topology artifact and prove that its source-facing columns agree.

    The persisted artifact intentionally omits columns that are already immutable
    snapshot facts.  Those columns are reconstructed from ``snapshot`` and checked
    against the compact persisted witnesses before a compilation is returned.
    """

    root = Path(snapshot_path)
    try:
        integrity_errors = SnapshotStore.verify(root)
        if integrity_errors:
            raise ValueError(
                "snapshot integrity failure: " + ", ".join(integrity_errors)
            )
        manifest = stable_json_loads(
            (root / "manifest.json").read_text(encoding="utf-8")
        )
        if str(manifest["snapshot_id"]) != snapshot.snapshot_id:
            raise ValueError("snapshot path and DrawingSnapshot identifiers disagree")

        connection = sqlite3.connect(root / "snapshot.sqlite3")
        try:
            rows = tuple(
                connection.execute(
                    "SELECT artifact_id,operator_version,payload_path "
                    "FROM derived_artifacts WHERE operator_id=? ORDER BY artifact_id",
                    (TOPOLOGY_COMPILE_SPEC.operator_id,),
                )
            )
        finally:
            connection.close()
        if len(rows) != 1:
            raise ValueError(
                f"expected exactly one topology.compile artifact, found {len(rows)}"
            )
        _, operator_version, payload_relative = rows[0]
        if str(operator_version) != TOPOLOGY_COMPILE_SPEC.version:
            raise ValueError(
                "unsupported topology.compile artifact version "
                f"{operator_version!r}; expected {TOPOLOGY_COMPILE_SPEC.version!r}"
            )
        payload_path = root / str(payload_relative)
        document = stable_json_loads(payload_path.read_text(encoding="utf-8"))
        if not isinstance(document, dict):
            raise TypeError("topology payload root must be an object")
        if int(document["schema_version"]) != 2:
            raise ValueError(
                f"unsupported topology payload schema {document['schema_version']!r}"
            )
        if str(document["snapshot_id"]) != snapshot.snapshot_id:
            raise ValueError("topology payload belongs to another snapshot")
        array_dir = payload_path.parent

        endpoints = extract_endpoints(snapshot)
        persisted_geometry_rows = _load_array(
            array_dir, "snap_geometry_rows", dtype=np.int64
        )
        persisted_ordinals = _load_array(array_dir, "snap_ordinals", dtype=np.int8)
        if not np.array_equal(endpoints.geometry_rows, persisted_geometry_rows):
            raise ValueError("reconstructed endpoint geometry rows disagree with artifact")
        if not np.array_equal(endpoints.ordinals, persisted_ordinals):
            raise ValueError("reconstructed endpoint ordinals disagree with artifact")

        summary = document["snap_plan"]
        if not isinstance(summary, dict):
            raise TypeError("persisted snap plan summary must be an object")
        representative_grid = _load_array(
            array_dir, "snap_representative_grid", dtype=np.int64
        )
        conflicts = tuple(
            SnapConflict(
                cluster_id=str(item["cluster_id"]),
                code=str(item["code"]),
                message=str(item["message"]),
                member_endpoint_ids=tuple(
                    str(member) for member in item.get("member_endpoint_ids", ())
                ),
                max_displacement=float(item["max_displacement"]),
            )
            for item in summary.get("conflicts", ())
        )
        snap_plan = SnapPlan(
            snapshot_id=str(summary["snapshot_id"]),
            tolerance_profile_id=str(summary["tolerance_profile_id"]),
            graph_id=str(summary["graph_id"]),
            endpoints=endpoints,
            cluster_anchor_endpoint_indices=_load_array(
                array_dir, "snap_cluster_anchor_endpoint_indices", dtype=np.int64
            ),
            representative_endpoint_indices=_load_array(
                array_dir, "snap_representative_endpoint_indices", dtype=np.int64
            ),
            representative_grid_points=representative_grid,
            representative_points=snapshot.coordinate_frame.dequantize(
                representative_grid
            ),
            member_offsets=_load_array(
                array_dir, "snap_member_offsets", dtype=np.int64
            ),
            member_endpoint_indices=_load_array(
                array_dir, "snap_member_endpoint_indices", dtype=np.int64
            ),
            cluster_indices_by_endpoint=_load_array(
                array_dir, "snap_cluster_indices", dtype=np.int32
            ),
            displacements=_load_array(array_dir, "snap_displacements", dtype=np.float64),
            conflicts=conflicts,
        )
        if snap_plan.snapshot_id != snapshot.snapshot_id:
            raise ValueError("persisted SnapPlan belongs to another snapshot")
        if snap_plan.graph_id != str(document["graph_id"]):
            raise ValueError("SnapPlan graph id disagrees with topology document")
        if snap_plan.cluster_count != int(summary["cluster_count"]):
            raise ValueError("SnapPlan cluster count disagrees with topology document")
        if snap_plan.move_count != int(summary["move_count"]):
            raise ValueError("SnapPlan move count disagrees with topology document")
        if len(snap_plan.affected_occurrence_ids) != int(summary["affected_entity_count"]):
            raise ValueError("SnapPlan affected-entity count disagrees with topology document")

        incidence_result = build_incidence_graph(snapshot, endpoints, snap_plan)
        incidence = incidence_result.value
        if incidence is None or incidence.graph_id != str(document["graph_id"]):
            raise ValueError("reconstructed incidence graph id disagrees with artifact")
        incidence_facts = _incidence_facts_from_dict(document["incidence_facts"])
        if incidence_facts.graph_id != incidence.graph_id:
            raise ValueError("incidence facts graph id disagrees with reconstructed graph")

        support_rows = _load_array(array_dir, "support_geometry_rows", dtype=np.int64)
        geometry = snapshot.geometry
        if len(support_rows) and (
            support_rows.min() < 0 or support_rows.max() >= len(geometry)
        ):
            raise ValueError("arrangement support references an unknown geometry row")
        if len(support_rows):
            support_occurrence_ids = geometry.occurrence_ids[support_rows]
            support_definition_ids = geometry.definition_ids[support_rows]
        else:
            # Arrangement's empty support columns use the canonical minimal
            # Unicode dtype rather than inheriting snapshot identifier width.
            support_occurrence_ids = np.asarray([], dtype="<U1")
            support_definition_ids = np.asarray([], dtype="<U1")
        arrangement = Arrangement(
            snapshot_id=snapshot.snapshot_id,
            arrangement_id=str(document["arrangement_id"]),
            graph_id=str(document["graph_id"]),
            vertices_grid=_load_array(
                array_dir, "arrangement_vertices_grid", dtype=np.int64
            ),
            edge_vertices=_load_array(
                array_dir, "arrangement_edge_vertices", dtype=np.int64
            ),
            support_offsets=_load_array(array_dir, "support_offsets", dtype=np.int64),
            support_occurrence_ids=support_occurrence_ids,
            support_definition_ids=support_definition_ids,
            support_parameter_ranges=_load_array(
                array_dir, "support_parameter_ranges", dtype=np.float64
            ),
            support_directions=_load_array(
                array_dir, "support_directions", dtype=np.bool_
            ),
            source_geometry_rows=_load_array(
                array_dir, "arrangement_source_geometry_rows", dtype=np.int64
            ),
        )

        rings = tuple(_ring_from_dict(item) for item in document.get("rings", ()))
        faces = tuple(_face_from_dict(item) for item in document.get("faces", ()))
        half_edge_faces = _load_array(array_dir, "half_edge_faces", dtype=np.int64)
        unbounded_ring_ids = tuple(
            sorted(
                ring.ring_id
                for ring in rings
                if ring.signed_area_grid < 0.0
                and all(half_edge_faces[index] == -1 for index in ring.half_edges)
            )
        )
        dcel = Dcel(
            snapshot_id=snapshot.snapshot_id,
            dcel_id=str(document["dcel_id"]),
            arrangement_id=arrangement.arrangement_id,
            vertices_grid=arrangement.vertices_grid,
            half_edge_origins=_load_array(
                array_dir, "half_edge_origins", dtype=np.int64
            ),
            half_edge_destinations=_load_array(
                array_dir, "half_edge_destinations", dtype=np.int64
            ),
            half_edge_twins=_load_array(array_dir, "half_edge_twins", dtype=np.int64),
            half_edge_next=_load_array(array_dir, "half_edge_next", dtype=np.int64),
            half_edge_edges=_load_array(array_dir, "half_edge_edges", dtype=np.int64),
            half_edge_faces=half_edge_faces,
            rings=rings,
            faces=faces,
            unbounded_ring_ids=unbounded_ring_ids,
            validation=_validation_from_dict(document["validation"]),
        )

        stage_outcomes = tuple(
            _stage_outcome_from_dict(item)
            for item in document.get("stage_outcomes", ())
        )
        compilation = TopologyCompilation(
            endpoints=endpoints,
            snap_plan=snap_plan,
            incidence_graph=incidence,
            incidence_facts=incidence_facts,
            arrangement=arrangement,
            dcel=dcel,
            stage_outcomes=stage_outcomes,
            decision=Decision(document["decision"]),
            diagnostics=tuple(
                _diagnostic_from_dict(item)
                for item in document.get("diagnostics", ())
            ),
        )
        status = {
            Decision.AMBIGUOUS: OpStatus.AMBIGUOUS,
            Decision.UNSUPPORTED: OpStatus.UNSUPPORTED,
            Decision.REJECTED: OpStatus.FAILED,
        }.get(compilation.decision, OpStatus.SUCCESS)
        return OpResult(
            status=status,
            value=compilation,
            decision=compilation.decision,
            exactness=Exactness.EXACT,
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            diagnostics=compilation.diagnostics,
            derivation=(
                "endpoint facts reconstructed and checked against persisted witnesses",
                "incidence graph deterministically rebuilt and graph id checked",
                "arrangement and DCEL columns restored from immutable artifact arrays",
            ),
        )
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        IndexError,
        OverflowError,
        sqlite3.DatabaseError,
    ) as error:
        return _load_failure(snapshot, str(error))


def make_topology_payload(
    snapshot: DrawingSnapshot,
    compilation: TopologyCompilation,
) -> DerivedArtifactPayload:
    arrangement = compilation.arrangement
    dcel = compilation.dcel
    document = TopologyArtifactDocument(
        schema_version=2,
        snapshot_id=snapshot.snapshot_id,
        decision=compilation.decision,
        diagnostics=compilation.diagnostics,
        stage_outcomes=compilation.stage_outcomes,
        graph_id=compilation.snap_plan.graph_id,
        arrangement_id=arrangement.arrangement_id,
        dcel_id=dcel.dcel_id,
        snap_plan=SnapPlanSummary(
            snapshot_id=compilation.snap_plan.snapshot_id,
            tolerance_profile_id=compilation.snap_plan.tolerance_profile_id,
            graph_id=compilation.snap_plan.graph_id,
            cluster_count=compilation.snap_plan.cluster_count,
            move_count=compilation.snap_plan.move_count,
            affected_entity_count=len(compilation.snap_plan.affected_occurrence_ids),
            conflicts=compilation.snap_plan.conflicts,
        ),
        incidence_facts=compilation.incidence_facts,
        rings=dcel.rings,
        faces=dcel.faces,
        validation=dcel.validation,
    )
    face_records: list[FaceIndexRecord] = []
    ring_by_id = {ring.ring_id: ring for ring in dcel.rings}
    ring_occurrence_cache: dict[str, tuple[str, ...]] = {}

    def ring_occurrence_ids(ring_id: str) -> tuple[str, ...]:
        cached = ring_occurrence_cache.get(ring_id)
        if cached is not None:
            return cached
        ring = ring_by_id[ring_id]
        source_ids: set[str] = set()
        for half_edge in ring.half_edges:
            edge_index = int(dcel.half_edge_edges[half_edge])
            start = int(arrangement.support_offsets[edge_index])
            end = int(arrangement.support_offsets[edge_index + 1])
            source_ids.update(
                str(value)
                for value in arrangement.support_occurrence_ids[start:end]
            )
        result = tuple(sorted(source_ids))
        ring_occurrence_cache[ring_id] = result
        return result

    for face in dcel.faces:
        grid_polygon = face_polygon(arrangement, dcel, face)
        if grid_polygon is None:
            # ``build_dcel`` must already have marked the artifact ambiguous.
            # Never persist an invalid candidate as queryable WKB.
            continue
        polygon = shapely.transform(grid_polygon, snapshot.coordinate_frame.dequantize)
        polygon = shapely.normalize(polygon)
        bounds = tuple(float(value) for value in shapely.bounds(polygon))
        ring_ids = (face.outer_ring_id, *face.hole_ring_ids)
        boundary_occurrence_ids = tuple(
            sorted(
                {
                    occurrence_id
                    for ring_id in ring_ids
                    for occurrence_id in ring_occurrence_ids(ring_id)
                }
            )
        )
        boundary_json = stable_json_dumps(
            {
                "outer": {
                    "ring_id": face.outer_ring_id,
                    "occurrence_ids": ring_occurrence_ids(face.outer_ring_id),
                },
                "holes": tuple(
                    {
                        "ring_id": ring_id,
                        "occurrence_ids": ring_occurrence_ids(ring_id),
                    }
                    for ring_id in face.hole_ring_ids
                ),
                "boundary_occurrence_ids": boundary_occurrence_ids,
            }
        )
        face_records.append(
            FaceIndexRecord(
                face_id=face.face_id,
                depth=face.depth,
                hole_count=len(face.hole_ring_ids),
                area=float(face.area_grid * snapshot.coordinate_frame.grid_size**2),
                bounds=bounds,
                geometry_wkb=bytes(shapely.to_wkb(polygon, byte_order=1, include_srid=False)),
                boundary_json=boundary_json,
            )
        )
    artifact_id = stable_id(
        "topology-derived-artifact-v1",
        snapshot.snapshot_id,
        compilation.snap_plan.graph_id,
        arrangement.arrangement_id,
        dcel.dcel_id,
        dcel.validation,
        compilation.stage_outcomes,
        length=64,
    )
    support_geometry_rows = snapshot.geometry.positions(
        arrangement.support_occurrence_ids
    ).astype(np.int32, copy=False)
    arrays = (
        ("snap_geometry_rows", compilation.endpoints.geometry_rows.astype(np.int32)),
        ("snap_ordinals", compilation.endpoints.ordinals),
        ("snap_cluster_indices", compilation.snap_plan.cluster_indices_by_endpoint),
        (
            "snap_cluster_anchor_endpoint_indices",
            compilation.snap_plan.cluster_anchor_endpoint_indices.astype(np.int32),
        ),
        (
            "snap_representative_endpoint_indices",
            compilation.snap_plan.representative_endpoint_indices.astype(np.int32),
        ),
        ("snap_representative_grid", compilation.snap_plan.representative_grid_points),
        ("snap_member_offsets", compilation.snap_plan.member_offsets.astype(np.int32)),
        (
            "snap_member_endpoint_indices",
            compilation.snap_plan.member_endpoint_indices.astype(np.int32),
        ),
        ("snap_displacements", compilation.snap_plan.displacements),
        ("arrangement_vertices_grid", arrangement.vertices_grid),
        ("arrangement_edge_vertices", arrangement.edge_vertices.astype(np.int32)),
        ("arrangement_source_geometry_rows", arrangement.source_geometry_rows.astype(np.int32)),
        ("support_offsets", arrangement.support_offsets.astype(np.int32)),
        ("support_geometry_rows", support_geometry_rows),
        ("support_parameter_ranges", arrangement.support_parameter_ranges),
        ("support_directions", arrangement.support_directions),
        ("half_edge_origins", dcel.half_edge_origins.astype(np.int32)),
        ("half_edge_destinations", dcel.half_edge_destinations.astype(np.int32)),
        ("half_edge_twins", dcel.half_edge_twins.astype(np.int32)),
        ("half_edge_next", dcel.half_edge_next.astype(np.int32)),
        ("half_edge_edges", dcel.half_edge_edges.astype(np.int32)),
        ("half_edge_faces", dcel.half_edge_faces.astype(np.int32)),
    )
    return DerivedArtifactPayload(
        artifact_id=artifact_id,
        operator_id="topology.compile",
        operator_version=TOPOLOGY_COMPILE_SPEC.version,
        tolerance_profile_id=snapshot.tolerance_profile_id,
        precision_model_id=snapshot.precision_model_id,
        input_digest=stable_id(
            "topology-input",
            snapshot.snapshot_id,
            compilation.snap_plan.graph_id,
            length=64,
        ),
        json_payload=stable_json_dumps(document, pretty=True),
        arrays=arrays,
        faces=tuple(sorted(face_records, key=lambda item: item.face_id)),
        decision=compilation.decision.value,
        validation_diagnostics=compilation.diagnostics,
    )
