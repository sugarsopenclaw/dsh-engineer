from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from cadkernel.contracts import stable_id, stable_json_dumps, stable_json_loads

from cadsemantics.context import DrawingContextHypothesis
from cadsemantics.contracts import (
    IdentityAssertion,
    IdentityCluster,
    ObjectType,
    ProjectObject,
    SemanticFailure,
    SemanticRelation,
    SemanticRepresentation,
    SemanticSystem,
)
from cadsemantics.graph.codec import decode_dataclass
from cadsemantics.packs import PackRoutingDecision


SEMANTIC_GRAPH_SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class DrawingSemanticGraph:
    schema_version: int
    drawing_semantic_graph_id: str
    snapshot_id: str
    pattern_graph_id: str
    ontology_version: str
    semantic_tolerance_profile_id: str
    contexts: tuple[DrawingContextHypothesis, ...]
    routing_decisions: tuple[PackRoutingDecision, ...]
    representations: tuple[SemanticRepresentation, ...]
    relations: tuple[SemanticRelation, ...]
    systems: tuple[SemanticSystem, ...]
    identity_assertions: tuple[IdentityAssertion, ...]
    failures: tuple[SemanticFailure, ...]
    source_pattern_keys: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.schema_version != SEMANTIC_GRAPH_SCHEMA_VERSION:
            raise ValueError(f"Unsupported DrawingSemanticGraph schema: {self.schema_version}")
        if not self.drawing_semantic_graph_id.startswith("semantic-drawing:"):
            raise ValueError("DrawingSemanticGraph id must use semantic-drawing:<64hex>")
        if any(item.source_snapshot_id != self.snapshot_id for item in self.representations):
            raise ValueError("Semantic representation belongs to another snapshot")

    @classmethod
    def create(
        cls,
        *,
        snapshot_id: str,
        pattern_graph_id: str,
        ontology_version: str,
        semantic_tolerance_profile_id: str,
        contexts: Iterable[DrawingContextHypothesis] = (),
        routing_decisions: Iterable[PackRoutingDecision] = (),
        representations: Iterable[SemanticRepresentation] = (),
        relations: Iterable[SemanticRelation] = (),
        systems: Iterable[SemanticSystem] = (),
        identity_assertions: Iterable[IdentityAssertion] = (),
        failures: Iterable[SemanticFailure] = (),
        source_pattern_keys: Iterable[str] = (),
    ) -> "DrawingSemanticGraph":
        ordered_contexts = tuple(sorted(contexts, key=lambda item: item.context_id))
        ordered_routing = tuple(
            sorted(
                routing_decisions,
                key=lambda item: (item.context_id, item.pack_id),
            )
        )
        ordered_representations = tuple(sorted(representations, key=lambda item: item.resolution_id))
        ordered_relations = tuple(sorted(relations, key=lambda item: item.relation_id))
        ordered_systems = tuple(sorted(systems, key=lambda item: item.system_id))
        ordered_identity = tuple(sorted(identity_assertions, key=lambda item: item.assertion_id))
        ordered_failures = tuple(sorted(failures, key=lambda item: item.failure_id))
        patterns = tuple(sorted(set(source_pattern_keys)))
        digest = stable_id(
            "drawing-semantic-graph",
            snapshot_id,
            pattern_graph_id,
            ontology_version,
            semantic_tolerance_profile_id,
            ordered_contexts,
            ordered_routing,
            ordered_representations,
            ordered_relations,
            ordered_systems,
            ordered_identity,
            ordered_failures,
            patterns,
            length=64,
        )
        return cls(
            SEMANTIC_GRAPH_SCHEMA_VERSION,
            "semantic-drawing:" + digest,
            snapshot_id,
            pattern_graph_id,
            ontology_version,
            semantic_tolerance_profile_id,
            ordered_contexts,
            ordered_routing,
            ordered_representations,
            ordered_relations,
            ordered_systems,
            ordered_identity,
            ordered_failures,
            patterns,
        )

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)

    @classmethod
    def from_json(cls, payload: str) -> "DrawingSemanticGraph":
        return decode_dataclass(cls, stable_json_loads(payload))


@dataclass(frozen=True, slots=True)
class ProjectSemanticGraph:
    schema_version: int
    project_semantic_graph_id: str
    project_id: str
    drawing_graph_ids: tuple[str, ...]
    source_snapshot_ids: tuple[str, ...]
    project_objects: tuple[ProjectObject, ...]
    object_types: tuple[ObjectType, ...]
    systems: tuple[SemanticSystem, ...]
    relations: tuple[SemanticRelation, ...]
    identity_clusters: tuple[IdentityCluster, ...]
    identity_assertions: tuple[IdentityAssertion, ...]
    failures: tuple[SemanticFailure, ...]

    def __post_init__(self) -> None:
        if self.schema_version != SEMANTIC_GRAPH_SCHEMA_VERSION:
            raise ValueError(f"Unsupported ProjectSemanticGraph schema: {self.schema_version}")
        if not self.project_semantic_graph_id.startswith("semantic-project:"):
            raise ValueError("ProjectSemanticGraph id must use semantic-project:<64hex>")

    @classmethod
    def create(
        cls,
        *,
        project_id: str,
        drawing_graph_ids: Iterable[str],
        source_snapshot_ids: Iterable[str],
        project_objects: Iterable[ProjectObject] = (),
        object_types: Iterable[ObjectType] = (),
        systems: Iterable[SemanticSystem] = (),
        relations: Iterable[SemanticRelation] = (),
        identity_clusters: Iterable[IdentityCluster] = (),
        identity_assertions: Iterable[IdentityAssertion] = (),
        failures: Iterable[SemanticFailure] = (),
    ) -> "ProjectSemanticGraph":
        drawings = tuple(sorted(set(drawing_graph_ids)))
        snapshots = tuple(sorted(set(source_snapshot_ids)))
        objects = tuple(sorted(project_objects, key=lambda item: item.project_object_id))
        types = tuple(sorted(object_types, key=lambda item: item.object_type_id))
        ordered_systems = tuple(sorted(systems, key=lambda item: item.system_id))
        ordered_relations = tuple(sorted(relations, key=lambda item: item.relation_id))
        clusters = tuple(sorted(identity_clusters, key=lambda item: item.cluster_id))
        assertions = tuple(sorted(identity_assertions, key=lambda item: item.assertion_id))
        ordered_failures = tuple(sorted(failures, key=lambda item: item.failure_id))
        digest = stable_id(
            "project-semantic-graph",
            project_id,
            drawings,
            snapshots,
            objects,
            types,
            ordered_systems,
            ordered_relations,
            clusters,
            assertions,
            ordered_failures,
            length=64,
        )
        return cls(
            SEMANTIC_GRAPH_SCHEMA_VERSION,
            "semantic-project:" + digest,
            project_id,
            drawings,
            snapshots,
            objects,
            types,
            ordered_systems,
            ordered_relations,
            clusters,
            assertions,
            ordered_failures,
        )

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)

    @classmethod
    def from_json(cls, payload: str) -> "ProjectSemanticGraph":
        return decode_dataclass(cls, stable_json_loads(payload))


@dataclass(frozen=True, slots=True)
class SemanticGraphBundle:
    drawing_graph: DrawingSemanticGraph
    project_graph: ProjectSemanticGraph

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)

    @classmethod
    def from_json(cls, payload: str) -> "SemanticGraphBundle":
        return decode_dataclass(cls, stable_json_loads(payload))
