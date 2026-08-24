from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from cadkernel.contracts import stable_id, stable_json_dumps, stable_json_loads

from cadpatterns.contracts import (
    FeatureRecord,
    GeometryProvenance,
    PatternEdge,
    PatternInstance,
    PatternLocalFrame,
    PatternMember,
    PatternRef,
    PatternScope,
    PatternStatus,
    ProofGrade,
    ReferenceKind,
    RelationType,
    ScopeType,
    TraceEvent,
    VirtualPatternGeometry,
)


PATTERN_GRAPH_SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class PatternGraph:
    schema_version: int
    pattern_graph_id: str
    snapshot_id: str
    topology_graph_id: str
    arrangement_id: str
    dcel_id: str
    pattern_tolerance_profile_id: str
    scopes: tuple[PatternScope, ...]
    instances: tuple[PatternInstance, ...]
    edges: tuple[PatternEdge, ...]
    virtual_geometries: tuple[VirtualPatternGeometry, ...]
    features: tuple[FeatureRecord, ...]
    trace: tuple[TraceEvent, ...]

    def __post_init__(self) -> None:
        if self.schema_version != PATTERN_GRAPH_SCHEMA_VERSION:
            raise ValueError(f"Unsupported PatternGraph schema: {self.schema_version}")
        if not self.pattern_graph_id.startswith("pattern-graph:"):
            raise ValueError("PatternGraph id must use pattern-graph:<64hex>")
        if any(scope.snapshot_id != self.snapshot_id for scope in self.scopes):
            raise ValueError("PatternGraph scope belongs to another snapshot")
        if any(item.snapshot_id != self.snapshot_id for item in self.instances):
            raise ValueError("PatternGraph instance belongs to another snapshot")
        if any(edge.snapshot_id != self.snapshot_id for edge in self.edges):
            raise ValueError("PatternGraph edge belongs to another snapshot")
        if any(item.snapshot_id != self.snapshot_id for item in self.virtual_geometries):
            raise ValueError("PatternGraph virtual geometry belongs to another snapshot")

    @classmethod
    def create(
        cls,
        *,
        snapshot_id: str,
        topology_graph_id: str,
        arrangement_id: str,
        dcel_id: str,
        pattern_tolerance_profile_id: str,
        scopes: Iterable[PatternScope] = (),
        instances: Iterable[PatternInstance] = (),
        edges: Iterable[PatternEdge] = (),
        virtual_geometries: Iterable[VirtualPatternGeometry] = (),
        features: Iterable[FeatureRecord] = (),
        trace: Iterable[TraceEvent] = (),
    ) -> "PatternGraph":
        ordered_scopes = tuple(sorted(scopes, key=lambda item: item.scope_id))
        ordered_instances = tuple(
            sorted(
                instances,
                key=lambda item: (
                    item.pattern_type,
                    item.scope_id,
                    item.pattern_key,
                    item.detection_id,
                ),
            )
        )
        ordered_edges = tuple(
            {item.edge_id: item for item in edges}[key]
            for key in sorted({item.edge_id: item for item in edges})
        )
        ordered_virtual = tuple(
            {item.virtual_geometry_id: item for item in virtual_geometries}[key]
            for key in sorted(
                {item.virtual_geometry_id: item for item in virtual_geometries}
            )
        )
        ordered_features = tuple(sorted(features, key=lambda item: item.key()))
        ordered_trace = tuple(
            {item.trace_id: item for item in trace}[key]
            for key in sorted({item.trace_id: item for item in trace})
        )
        identity_payload = (
            snapshot_id,
            topology_graph_id,
            arrangement_id,
            dcel_id,
            pattern_tolerance_profile_id,
            ordered_scopes,
            ordered_instances,
            ordered_edges,
            ordered_virtual,
            ordered_features,
            ordered_trace,
        )
        graph_id = "pattern-graph:" + stable_id(
            "pattern-graph",
            identity_payload,
            length=64,
        )
        return cls(
            schema_version=PATTERN_GRAPH_SCHEMA_VERSION,
            pattern_graph_id=graph_id,
            snapshot_id=snapshot_id,
            topology_graph_id=topology_graph_id,
            arrangement_id=arrangement_id,
            dcel_id=dcel_id,
            pattern_tolerance_profile_id=pattern_tolerance_profile_id,
            scopes=ordered_scopes,
            instances=ordered_instances,
            edges=ordered_edges,
            virtual_geometries=ordered_virtual,
            features=ordered_features,
            trace=ordered_trace,
        )

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)

    @classmethod
    def from_json(cls, payload: str) -> "PatternGraph":
        value = stable_json_loads(payload)
        if not isinstance(value, dict):
            raise TypeError("PatternGraph JSON root must be an object")
        return _graph_from_mapping(value)

    def supported(self, pattern_type: str | None = None) -> tuple[PatternInstance, ...]:
        return tuple(
            item
            for item in self.instances
            if item.status is PatternStatus.SUPPORTED
            and (pattern_type is None or item.pattern_type == pattern_type)
        )


def _local_frame(value: dict[str, Any]) -> PatternLocalFrame:
    return PatternLocalFrame(
        origin=tuple(float(item) for item in value["origin"]),
        axis_x=tuple(float(item) for item in value["axis_x"]),
        axis_y=tuple(float(item) for item in value["axis_y"]),
        scale=float(value["scale"]),
        scale_sources=tuple(str(item) for item in value.get("scale_sources", ())),
    )


def _scope(value: dict[str, Any]) -> PatternScope:
    parent = value.get("parent_scope_id")
    source = value.get("source_ref")
    return PatternScope(
        scope_id=str(value["scope_id"]),
        snapshot_id=str(value["snapshot_id"]),
        scope_type=ScopeType(value["scope_type"]),
        parent_scope_id=None if parent is None else str(parent),
        occurrence_ids=tuple(str(item) for item in value.get("occurrence_ids", ())),
        text_occurrence_ids=tuple(
            str(item) for item in value.get("text_occurrence_ids", ())
        ),
        bounds=tuple(float(item) for item in value["bounds"]),
        local_frame=_local_frame(value["local_frame"]),
        source_ref=None if source is None else str(source),
    )


def _ref(value: dict[str, Any]) -> PatternRef:
    return PatternRef(
        kind=ReferenceKind(value["kind"]),
        ref_id=str(value["ref_id"]),
        snapshot_id=str(value["snapshot_id"]),
    )


def _member(value: dict[str, Any]) -> PatternMember:
    return PatternMember(
        role=str(value["role"]),
        ref=_ref(value["ref"]),
        ordinal=int(value.get("ordinal", 0)),
        parameters=tuple(
            (str(name), item) for name, item in value.get("parameters", ())
        ),
    )


def _instance(value: dict[str, Any]) -> PatternInstance:
    bounds = value.get("bounds")
    return PatternInstance(
        pattern_key=str(value["pattern_key"]),
        detection_id=str(value["detection_id"]),
        snapshot_id=str(value["snapshot_id"]),
        pattern_type=str(value["pattern_type"]),
        scope_id=str(value["scope_id"]),
        spec_version=str(value["spec_version"]),
        detector_id=str(value["detector_id"]),
        detector_version=str(value["detector_version"]),
        feature_set_version=str(value["feature_set_version"]),
        resolver_version=str(value["resolver_version"]),
        pattern_tolerance_profile_id=str(value["pattern_tolerance_profile_id"]),
        status=PatternStatus(value["status"]),
        proof_grade=ProofGrade(value["proof_grade"]),
        score=float(value["score"]),
        members=tuple(_member(item) for item in value.get("members", ())),
        features=tuple(
            (str(name), item) for name, item in value.get("features", ())
        ),
        bounds=None if bounds is None else tuple(float(item) for item in bounds),
        virtual_geometry_ids=tuple(
            str(item) for item in value.get("virtual_geometry_ids", ())
        ),
        assumptions=tuple(str(item) for item in value.get("assumptions", ())),
        conflicts=tuple(str(item) for item in value.get("conflicts", ())),
        alternatives=tuple(str(item) for item in value.get("alternatives", ())),
    )


def _edge(value: dict[str, Any]) -> PatternEdge:
    return PatternEdge(
        edge_id=str(value["edge_id"]),
        snapshot_id=str(value["snapshot_id"]),
        relation=RelationType(value["relation"]),
        source_pattern_key=str(value["source_pattern_key"]),
        target=_ref(value["target"]),
        proof_grade=ProofGrade(value["proof_grade"]),
        score=float(value.get("score", 1.0)),
        evidence=tuple(_ref(item) for item in value.get("evidence", ())),
    )


def _virtual(value: dict[str, Any]) -> VirtualPatternGeometry:
    return VirtualPatternGeometry(
        virtual_geometry_id=str(value["virtual_geometry_id"]),
        snapshot_id=str(value["snapshot_id"]),
        geometry_kind=str(value["geometry_kind"]),
        coordinates=tuple(
            tuple(float(coordinate) for coordinate in point)
            for point in value.get("coordinates", ())
        ),
        provenance=GeometryProvenance(value["provenance"]),
        source_refs=tuple(_ref(item) for item in value.get("source_refs", ())),
        assumptions=tuple(str(item) for item in value.get("assumptions", ())),
    )


def _feature(value: dict[str, Any]) -> FeatureRecord:
    return FeatureRecord(
        scope_id=str(value["scope_id"]),
        subject_ref=str(value["subject_ref"]),
        name=str(value["name"]),
        value=value.get("value"),
        provenance=GeometryProvenance(value["provenance"]),
    )


def _trace(value: dict[str, Any]) -> TraceEvent:
    return TraceEvent(
        trace_id=str(value["trace_id"]),
        stage=str(value["stage"]),
        subject_id=str(value["subject_id"]),
        message=str(value["message"]),
        details=tuple((str(name), item) for name, item in value.get("details", ())),
    )


def _graph_from_mapping(value: dict[str, Any]) -> PatternGraph:
    return PatternGraph(
        schema_version=int(value["schema_version"]),
        pattern_graph_id=str(value["pattern_graph_id"]),
        snapshot_id=str(value["snapshot_id"]),
        topology_graph_id=str(value["topology_graph_id"]),
        arrangement_id=str(value["arrangement_id"]),
        dcel_id=str(value["dcel_id"]),
        pattern_tolerance_profile_id=str(value["pattern_tolerance_profile_id"]),
        scopes=tuple(_scope(item) for item in value.get("scopes", ())),
        instances=tuple(_instance(item) for item in value.get("instances", ())),
        edges=tuple(_edge(item) for item in value.get("edges", ())),
        virtual_geometries=tuple(
            _virtual(item) for item in value.get("virtual_geometries", ())
        ),
        features=tuple(_feature(item) for item in value.get("features", ())),
        trace=tuple(_trace(item) for item in value.get("trace", ())),
    )
