from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sqlite3
from types import MappingProxyType
from typing import Any, Iterable, Mapping

from cadkernel.contracts import stable_json_loads
from cadkernel.indexes import SnapshotStore
from cadkernel.ir import DrawingSnapshot
from cadpatterns.contracts import PatternInstance, PatternStatus
from cadpatterns.graph import PatternGraph
from cadpatterns.storage import PatternStore
from cadsemantics.contracts import (
    EvidenceRef as SemanticEvidenceRef,
    IdentityAssertion,
    ProjectObject,
    SemanticRepresentation,
    SemanticStatus,
)
from cadsemantics.graph import SemanticGraphBundle
from cadsemantics.storage import SemanticStore

from cadtasks.binding.project import ProjectBinding, ProjectSource


@dataclass(frozen=True, slots=True)
class SourceFacts:
    ordinal: int
    source: ProjectSource
    snapshot: DrawingSnapshot
    pattern_graph: PatternGraph
    semantic_bundle: SemanticGraphBundle


@dataclass(frozen=True, slots=True)
class BoundPattern:
    source_ordinal: int
    instance: PatternInstance


@dataclass(frozen=True, slots=True)
class BoundRepresentation:
    source_ordinal: int
    representation: SemanticRepresentation


@dataclass(frozen=True, slots=True)
class BoundProjectObject:
    source_ordinal: int
    project_object: ProjectObject


@dataclass(frozen=True, slots=True)
class BoundIdentityAssertion:
    source_ordinal: int
    assertion: IdentityAssertion


@dataclass(frozen=True, slots=True)
class OccurrenceFact:
    source_ordinal: int
    snapshot_id: str
    occurrence_id: str
    geometry_row: int
    bounds: tuple[float, float, float, float]
    layout_name: str = ""


@dataclass(frozen=True, slots=True)
class TextFact:
    source_ordinal: int
    snapshot_id: str
    occurrence_id: str
    plain_text: str
    anchor_point: tuple[float, float, float]
    bounds: tuple[float, float, float, float] | None


@dataclass(frozen=True, slots=True)
class FaceFact:
    source_ordinal: int
    snapshot_id: str
    face_id: str
    area: float
    bounds: tuple[float, float, float, float]
    boundary_occurrence_ids: tuple[str, ...]


def _append(index: dict[str, list[Any]], key: str, value: Any) -> None:
    index.setdefault(key, []).append(value)


def _freeze_one(values: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType(dict(sorted(values.items())))


def _freeze_many(values: Mapping[str, list[Any]], *, key: Any) -> Mapping[str, tuple[Any, ...]]:
    return MappingProxyType(
        {
            name: tuple(sorted(items, key=key))
            for name, items in sorted(values.items())
        }
    )


def _semantic_evidence(bundle: SemanticGraphBundle) -> tuple[SemanticEvidenceRef, ...]:
    values: dict[str, SemanticEvidenceRef] = {}

    def add_bundle(evidence_bundle: Any) -> None:
        for item in getattr(evidence_bundle, "all_refs", ()):
            values[item.evidence_id] = item

    drawing = bundle.drawing_graph
    project = bundle.project_graph
    for representation in drawing.representations:
        for assertion in representation.class_assertions:
            add_bundle(assertion.evidence)
        for assertion in representation.properties:
            add_bundle(assertion.evidence)
        for port in representation.ports:
            add_bundle(port.evidence)
            for assertion in port.attributes:
                add_bundle(assertion.evidence)
    for relation in (*drawing.relations, *project.relations):
        add_bundle(relation.evidence)
    for system in (*drawing.systems, *project.systems):
        add_bundle(system.evidence)
        for assertion in system.properties:
            add_bundle(assertion.evidence)
    for assertion in (*drawing.identity_assertions, *project.identity_assertions):
        add_bundle(assertion.evidence)
    for project_object in project.project_objects:
        add_bundle(project_object.evidence)
    for object_type in project.object_types:
        add_bundle(object_type.evidence)
        for assertion in object_type.properties:
            add_bundle(assertion.evidence)
    return tuple(values[key] for key in sorted(values))


def _face_facts(source_ordinal: int, source: ProjectSource) -> tuple[FaceFact, ...]:
    database = (Path(source.snapshot_path) / "snapshot.sqlite3").resolve().as_uri()
    connection = sqlite3.connect(f"{database}?mode=ro", uri=True)
    try:
        rows = tuple(
            connection.execute(
                "SELECT f.face_id,f.area,r.min_x,r.min_y,r.max_x,r.max_y,f.boundary_json "
                "FROM faces f JOIN face_rtree r ON r.face_row=f.row_index "
                "ORDER BY f.face_id"
            )
        )
    finally:
        connection.close()
    result = []
    for face_id, area, min_x, min_y, max_x, max_y, boundary_json in rows:
        boundary_value = stable_json_loads(str(boundary_json))
        boundary_ids: list[str] = []
        if isinstance(boundary_value, Mapping):
            for key in ("occurrence_ids", "boundary_occurrence_ids", "source_occurrence_ids"):
                candidate = boundary_value.get(key)
                if isinstance(candidate, (list, tuple)):
                    boundary_ids.extend(str(item) for item in candidate)
        elif isinstance(boundary_value, (list, tuple)):
            for item in boundary_value:
                if isinstance(item, str):
                    boundary_ids.append(item)
                elif isinstance(item, Mapping):
                    ref = item.get("occurrence_id") or item.get("ref_id")
                    if ref is not None:
                        boundary_ids.append(str(ref))
        result.append(
            FaceFact(
                source_ordinal,
                source.snapshot_id,
                str(face_id),
                float(area),
                (float(min_x), float(min_y), float(max_x), float(max_y)),
                tuple(sorted(set(boundary_ids))),
            )
        )
    return tuple(result)


@dataclass(frozen=True, slots=True)
class ProjectFactBundle:
    binding: ProjectBinding
    sources: tuple[SourceFacts, ...]
    detection_index: Mapping[str, BoundPattern]
    pattern_key_index: Mapping[str, tuple[BoundPattern, ...]]
    signature_index: Mapping[str, tuple[BoundPattern, ...]]
    resolution_index: Mapping[str, BoundRepresentation]
    representation_key_index: Mapping[str, tuple[BoundRepresentation, ...]]
    semantic_class_index: Mapping[str, tuple[BoundRepresentation, ...]]
    project_object_index: Mapping[str, BoundProjectObject]
    system_member_index: Mapping[str, tuple[str, ...]]
    identity_assertion_index: Mapping[str, BoundIdentityAssertion]
    occurrence_index: Mapping[str, OccurrenceFact]
    text_index: Mapping[str, TextFact]
    face_index: Mapping[str, FaceFact]
    semantic_evidence_index: Mapping[str, SemanticEvidenceRef]
    evidence_ids: frozenset[str]

    @classmethod
    def load(cls, binding: ProjectBinding) -> "ProjectFactBundle":
        errors = binding.verify()
        if errors:
            raise ValueError("Project binding integrity failure: " + ", ".join(errors))
        source_facts = []
        detections: dict[str, BoundPattern] = {}
        pattern_keys: dict[str, list[BoundPattern]] = {}
        signatures: dict[str, list[BoundPattern]] = {}
        resolutions: dict[str, BoundRepresentation] = {}
        representation_keys: dict[str, list[BoundRepresentation]] = {}
        semantic_classes: dict[str, list[BoundRepresentation]] = {}
        project_objects: dict[str, BoundProjectObject] = {}
        system_members: dict[str, set[str]] = {}
        identity_assertions: dict[str, BoundIdentityAssertion] = {}
        occurrences: dict[str, OccurrenceFact] = {}
        texts: dict[str, TextFact] = {}
        faces: dict[str, FaceFact] = {}
        semantic_evidence: dict[str, SemanticEvidenceRef] = {}
        evidence_ids: set[str] = set()

        for ordinal, source in enumerate(binding.sources):
            snapshot = SnapshotStore.load(source.snapshot_path)
            pattern_graph = PatternStore.load(source.pattern_path)
            semantic_bundle = SemanticStore.load(source.semantic_path)
            if snapshot.snapshot_id != source.snapshot_id:
                raise ValueError("Loaded snapshot differs from bound source")
            if pattern_graph.pattern_graph_id != source.pattern_graph_id:
                raise ValueError("Loaded PatternGraph differs from bound source")
            if (
                semantic_bundle.drawing_graph.drawing_semantic_graph_id
                != source.drawing_semantic_graph_id
            ):
                raise ValueError("Loaded semantic graph differs from bound source")
            fact = SourceFacts(ordinal, source, snapshot, pattern_graph, semantic_bundle)
            source_facts.append(fact)
            evidence_ids.update(
                (
                    source.snapshot_id,
                    source.pattern_graph_id,
                    source.drawing_semantic_graph_id,
                    source.project_semantic_graph_id,
                )
            )

            for instance in pattern_graph.instances:
                bound = BoundPattern(ordinal, instance)
                if instance.detection_id in detections:
                    raise ValueError(f"Duplicate detection id across project sources: {instance.detection_id}")
                detections[instance.detection_id] = bound
                _append(pattern_keys, instance.pattern_key, bound)
                signature = instance.feature("geometry_signature")
                if signature is not None:
                    _append(signatures, str(signature), bound)
                evidence_ids.update((instance.detection_id, instance.pattern_key, instance.scope_id))
                evidence_ids.update(member.ref.ref_id for member in instance.members)
            for edge in pattern_graph.edges:
                evidence_ids.add(edge.edge_id)
            for item in pattern_graph.virtual_geometries:
                evidence_ids.add(item.virtual_geometry_id)
            for item in pattern_graph.features:
                evidence_ids.add(item.subject_ref)

            for representation in semantic_bundle.drawing_graph.representations:
                bound = BoundRepresentation(ordinal, representation)
                if representation.resolution_id in resolutions:
                    raise ValueError(
                        "Duplicate semantic resolution id across project sources: "
                        + representation.resolution_id
                    )
                resolutions[representation.resolution_id] = bound
                _append(representation_keys, representation.representation_key, bound)
                if representation.semantic_class is not None:
                    _append(semantic_classes, representation.semantic_class, bound)
                evidence_ids.update(
                    (representation.resolution_id, representation.representation_key)
                )
            project = semantic_bundle.project_graph
            for system in (
                *semantic_bundle.drawing_graph.systems,
                *project.systems,
            ):
                system_members.setdefault(system.system_id, set()).update(
                    system.member_ids
                )
                evidence_ids.add(system.system_id)
            for project_object in project.project_objects:
                project_objects[project_object.project_object_id] = BoundProjectObject(
                    ordinal, project_object
                )
                evidence_ids.add(project_object.project_object_id)
            for assertion in project.identity_assertions:
                identity_assertions[assertion.assertion_id] = BoundIdentityAssertion(
                    ordinal, assertion
                )
                evidence_ids.add(assertion.assertion_id)
            evidence_ids.update(item.object_type_id for item in project.object_types)
            evidence_ids.update(item.cluster_id for item in project.identity_clusters)
            evidence_ids.update(item.system_id for item in project.systems)
            evidence_ids.update(item.relation_id for item in project.relations)

            geometry_ids = snapshot.geometry.occurrence_ids
            layout_by_occurrence = {
                str(occurrence_id): str(snapshot.occurrences.layout_names[row])
                for row, occurrence_id in enumerate(snapshot.occurrences.occurrence_ids)
            }
            for row, occurrence_id_value in enumerate(geometry_ids):
                occurrence_id = str(occurrence_id_value)
                if occurrence_id in occurrences:
                    raise ValueError(f"Duplicate occurrence id across project sources: {occurrence_id}")
                occurrences[occurrence_id] = OccurrenceFact(
                    ordinal,
                    snapshot.snapshot_id,
                    occurrence_id,
                    row,
                    tuple(float(item) for item in snapshot.geometry.bounds[row]),
                    layout_by_occurrence.get(occurrence_id, ""),
                )
                evidence_ids.add(occurrence_id)
            for row, occurrence_id_value in enumerate(snapshot.texts.occurrence_ids):
                occurrence_id = str(occurrence_id_value)
                occurrence = occurrences.get(occurrence_id)
                texts[occurrence_id] = TextFact(
                    ordinal,
                    snapshot.snapshot_id,
                    occurrence_id,
                    str(snapshot.texts.plain_text[row]),
                    tuple(float(item) for item in snapshot.texts.points[row]),
                    None if occurrence is None else occurrence.bounds,
                )
                evidence_ids.add(occurrence_id)
            evidence_ids.update(str(item) for item in snapshot.annotations.occurrence_ids)

            for face in _face_facts(ordinal, source):
                faces[face.face_id] = face
                evidence_ids.add(face.face_id)
                evidence_ids.update(face.boundary_occurrence_ids)
            for item in _semantic_evidence(semantic_bundle):
                semantic_evidence[item.evidence_id] = item
                evidence_ids.update((item.evidence_id, item.ref_id))

        post_errors = binding.verify()
        if post_errors:
            raise RuntimeError(
                "Fact acquisition changed immutable upstream integrity: "
                + ", ".join(post_errors)
            )
        return cls(
            binding,
            tuple(source_facts),
            _freeze_one(detections),
            _freeze_many(
                pattern_keys,
                key=lambda item: (item.source_ordinal, item.instance.detection_id),
            ),
            _freeze_many(
                signatures,
                key=lambda item: (item.source_ordinal, item.instance.detection_id),
            ),
            _freeze_one(resolutions),
            _freeze_many(
                representation_keys,
                key=lambda item: (item.source_ordinal, item.representation.resolution_id),
            ),
            _freeze_many(
                semantic_classes,
                key=lambda item: (item.source_ordinal, item.representation.resolution_id),
            ),
            _freeze_one(project_objects),
            _freeze_one(
                {
                    system_id: tuple(sorted(members))
                    for system_id, members in system_members.items()
                }
            ),
            _freeze_one(identity_assertions),
            _freeze_one(occurrences),
            _freeze_one(texts),
            _freeze_one(faces),
            _freeze_one(semantic_evidence),
            frozenset(evidence_ids),
        )

    @property
    def source_snapshot_ids(self) -> tuple[str, ...]:
        return tuple(source.source.snapshot_id for source in self.sources)

    @property
    def semantic_classes(self) -> tuple[str, ...]:
        return tuple(sorted(self.semantic_class_index))

    @property
    def ontology_versions(self) -> tuple[str, ...]:
        return tuple(
            sorted(
                {
                    source.semantic_bundle.drawing_graph.ontology_version
                    for source in self.sources
                }
            )
        )

    @property
    def pack_versions(self) -> tuple[str, ...]:
        return tuple(
            sorted(
                {
                    f"{representation.representation.domain_pack_id}@"
                    f"{representation.representation.domain_pack_version}"
                    for values in self.semantic_class_index.values()
                    for representation in values
                }
            )
        )

    def has_evidence(self, reference: str) -> bool:
        return str(reference) in self.evidence_ids

    def source(self, ordinal: int) -> SourceFacts:
        return self.sources[int(ordinal)]

    def source_for_snapshot(self, snapshot_id: str) -> SourceFacts:
        for source in self.sources:
            if source.source.snapshot_id == snapshot_id:
                return source
        raise KeyError(f"Unknown project snapshot: {snapshot_id}")

    def representations(
        self,
        *,
        semantic_class: str | None = None,
        snapshot_ids: Iterable[str] = (),
        bounds: tuple[float, float, float, float] | None = None,
        supported_only: bool = False,
    ) -> tuple[BoundRepresentation, ...]:
        selected_snapshots = set(str(item) for item in snapshot_ids)
        values: Iterable[BoundRepresentation]
        if semantic_class is None or semantic_class == "*":
            values = self.resolution_index.values()
        else:
            values = self.semantic_class_index.get(semantic_class, ())
        result = []
        for bound in values:
            representation = bound.representation
            if selected_snapshots and representation.source_snapshot_id not in selected_snapshots:
                continue
            if supported_only and representation.status is not SemanticStatus.SUPPORTED:
                continue
            if bounds is not None:
                item_bounds = representation.bounds
                if item_bounds is None or not (
                    item_bounds[0] <= bounds[2]
                    and item_bounds[2] >= bounds[0]
                    and item_bounds[1] <= bounds[3]
                    and item_bounds[3] >= bounds[1]
                ):
                    continue
            result.append(bound)
        return tuple(
            sorted(result, key=lambda item: (item.source_ordinal, item.representation.resolution_id))
        )

    def patterns(
        self,
        *,
        pattern_type: str | None = None,
        snapshot_ids: Iterable[str] = (),
        supported_only: bool = False,
    ) -> tuple[BoundPattern, ...]:
        selected_snapshots = set(str(item) for item in snapshot_ids)
        result = []
        for bound in self.detection_index.values():
            instance = bound.instance
            if selected_snapshots and instance.snapshot_id not in selected_snapshots:
                continue
            if pattern_type is not None and instance.pattern_type != pattern_type:
                continue
            if supported_only and instance.status is not PatternStatus.SUPPORTED:
                continue
            result.append(bound)
        return tuple(
            sorted(result, key=lambda item: (item.source_ordinal, item.instance.detection_id))
        )
