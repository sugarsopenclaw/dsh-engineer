from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

from cadkernel.contracts import stable_id
from cadkernel.indexes import SnapshotStore
from cadkernel.ir import DrawingSnapshot
from cadpatterns.contracts import PatternInstance, PatternStatus, ReferenceKind
from cadpatterns.graph import PatternGraph
from cadpatterns.storage import PatternStore

from cadsemantics.attributes import extract_properties, retain_property_conflicts
from cadsemantics.context import resolve_contexts
from cadsemantics.contracts import (
    EvidenceKind,
    EvidenceRef,
    SemanticRepresentation,
    SemanticStatus,
    SemanticToleranceProfile,
)
from cadsemantics.coverage import SemanticCoverageReport, semantic_coverage_report
from cadsemantics.graph import (
    DrawingSemanticGraph,
    ProjectSemanticGraph,
    SemanticGraphBundle,
)
from cadsemantics.identity import build_identity_assertions, resolve_identity
from cadsemantics.inference import (
    RuleBasedSemanticBackend,
    SemanticEvidencePacket,
    SemanticInferencePort,
    SemanticValidator,
)
from cadsemantics.mapping import (
    SemanticMappingSpec,
    generate_semantic_candidates,
    load_pack_mapping_specs,
)
from cadsemantics.ontology import OntologyRegistry, builtin_ontology
from cadsemantics.packs import PackManifest, PackRegistry, load_builtin_manifests
from cadsemantics.relations import (
    apply_document_regions,
    assemble_spatial_membership,
    assemble_systems,
    attach_relation_ids,
    lift_project_relations,
    lift_project_systems,
    map_pattern_ports,
    map_pattern_relations,
)


_STATUS_RANK = {
    SemanticStatus.SUPPORTED: 0,
    SemanticStatus.AMBIGUOUS: 1,
    SemanticStatus.ABSTAINED: 2,
    SemanticStatus.REJECTED: 3,
    SemanticStatus.CONFLICTED: 4,
}


def _associated_text(
    snapshot: DrawingSnapshot,
    pattern: PatternInstance,
    existing: tuple[EvidenceRef, ...],
) -> tuple[EvidenceRef, ...]:
    rows = {
        str(occurrence_id): row
        for row, occurrence_id in enumerate(snapshot.texts.occurrence_ids)
    }
    evidence = {
        item.evidence_id: item
        for item in existing
        if item.kind is EvidenceKind.TEXT
    }
    for member in pattern.members:
        if member.ref.kind is not ReferenceKind.TEXT:
            continue
        row = rows.get(member.ref.ref_id)
        if row is None:
            continue
        item = EvidenceRef.create(
            kind=EvidenceKind.TEXT,
            ref_id=member.ref.ref_id,
            source_snapshot_id=snapshot.snapshot_id,
            literal=str(snapshot.texts.plain_text[row]),
        )
        evidence[item.evidence_id] = item
    return tuple(evidence[key] for key in sorted(evidence))


@dataclass(frozen=True, slots=True)
class SemanticBuildResult:
    bundle: SemanticGraphBundle
    coverage: SemanticCoverageReport
    location: object | None = None

    @property
    def drawing_graph(self) -> DrawingSemanticGraph:
        return self.bundle.drawing_graph

    @property
    def project_graph(self) -> ProjectSemanticGraph:
        return self.bundle.project_graph


class SemanticRuntime:
    """Execute the 3A–3I semantic pipeline over immutable L1/L2 artifacts."""

    def __init__(
        self,
        *,
        manifests: Iterable[PackManifest] | None = None,
        mapping_specs: Iterable[SemanticMappingSpec] | None = None,
        ontology: OntologyRegistry | None = None,
        backend: SemanticInferencePort | None = None,
        profile: SemanticToleranceProfile | None = None,
        project_profile_version: str = "project-profile:unconfigured",
    ) -> None:
        self.manifests = tuple(manifests) if manifests is not None else load_builtin_manifests()
        self.mapping_specs = (
            tuple(sorted(mapping_specs, key=lambda item: item.mapping_id))
            if mapping_specs is not None
            else tuple(
                spec
                for manifest in self.manifests
                for spec in load_pack_mapping_specs(manifest)
            )
        )
        owners = {
            class_id: manifest.pack_id
            for manifest in self.manifests
            for class_id in manifest.provides_classes
        }
        self.ontology = ontology or builtin_ontology(owners)
        self.backend = backend or RuleBasedSemanticBackend()
        self.profile = profile or SemanticToleranceProfile()
        self.project_profile_version = project_profile_version
        for manifest in self.manifests:
            for class_id in manifest.provides_classes:
                definition = self.ontology.classes.require(class_id)
                if definition.pack_id != manifest.pack_id:
                    raise ValueError(f"Semantic class owner mismatch for {class_id}")

    def build(
        self,
        snapshot: DrawingSnapshot,
        pattern_graph: PatternGraph,
        *,
        snapshot_path: str | Path | None = None,
        pattern_path: str | Path | None = None,
        project_id: str | None = None,
    ) -> SemanticBuildResult:
        if pattern_graph.snapshot_id != snapshot.snapshot_id:
            raise ValueError("PatternGraph belongs to another DrawingSnapshot")
        if snapshot_path is not None:
            errors = SnapshotStore.verify(snapshot_path)
            if errors:
                raise ValueError("Source snapshot integrity failure: " + ", ".join(errors))
        if pattern_path is not None:
            errors = PatternStore.verify(pattern_path, snapshot_path=snapshot_path)
            if errors:
                raise ValueError("Source PatternGraph integrity failure: " + ", ".join(errors))

        contexts = resolve_contexts(snapshot, pattern_graph, self.profile)
        pack_registry = PackRegistry.create(self.manifests)
        routing_decisions = tuple(
            decision
            for context in contexts
            for decision in pack_registry.route(context, pattern_graph)
        )
        candidates = generate_semantic_candidates(
            snapshot,
            pattern_graph,
            contexts,
            self.manifests,
            self.mapping_specs,
            self.ontology,
            self.profile,
        )
        initial = []
        inference_relations = []
        for candidate in candidates:
            representation = SemanticRepresentation.create(
                class_id=candidate.spec.target_class,
                source_snapshot_id=snapshot.snapshot_id,
                source_pattern_keys=(candidate.source.pattern_key,),
                source_detection_ids=(candidate.source.detection_id,),
                context_id=candidate.context.context_id,
                class_assertions=(candidate.class_assertion,),
                representation_mode=candidate.representation_mode,
                domain_pack_id=candidate.manifest.pack_id,
                domain_pack_version=candidate.manifest.version,
                mapping_version=candidate.spec.version,
                ontology_version=self.ontology.ontology_version,
                backend_version=self.backend.backend_version,
                project_profile_version=self.project_profile_version,
                status=candidate.class_assertion.status,
                functional_roles=candidate.functional_roles,
                project_phase=(
                    candidate.context.phase_candidates[0].value
                    if candidate.context.phase_candidates
                    else None
                ),
                bounds=candidate.source.bounds,
                geometry_signature=(
                    str(candidate.source.feature("geometry_signature"))
                    if candidate.source.feature("geometry_signature") is not None
                    else None
                ),
            )
            packet = SemanticEvidencePacket(
                representation_id=representation.resolution_id,
                context=candidate.context,
                source_pattern_key=candidate.source.pattern_key,
                source_pattern_type=candidate.source.pattern_type,
                source_bounds=candidate.source.bounds,
                source_features=candidate.source.features,
                associated_text=_associated_text(
                    snapshot,
                    candidate.source,
                    candidate.class_assertion.evidence.all_refs,
                ),
                class_candidates=candidate.manifest.provides_classes,
                allowed_properties=candidate.manifest.provides_properties,
                existing_class_assertions=(candidate.class_assertion,),
            )
            inference = self.backend.classify_object(packet)
            if any(
                assertion.class_id != candidate.spec.target_class
                for assertion in inference.class_assertions
            ):
                raise ValueError(
                    "Inference backend cannot change a mapping candidate's semantic class"
                )
            class_assertions = {
                item.assertion_id: item
                for item in (
                    candidate.class_assertion,
                    *inference.class_assertions,
                )
            }
            ordered_class_assertions = tuple(
                class_assertions[key] for key in sorted(class_assertions)
            )
            representation = replace(
                representation,
                class_assertions=ordered_class_assertions,
                status=min(
                    (item.status for item in ordered_class_assertions),
                    key=lambda item: _STATUS_RANK[item],
                ),
                alternatives=tuple(sorted(set(inference.alternatives))),
                diagnostics=(
                    (inference.abstention_reason,)
                    if inference.abstention_reason is not None
                    else ()
                ),
            )
            for assertion in inference.property_assertions:
                if assertion.subject_id != representation.resolution_id:
                    raise ValueError(
                        "Inference property assertion belongs to another representation"
                    )
                if assertion.property_id not in candidate.manifest.provides_properties:
                    raise ValueError(
                        f"Inference property is outside pack whitelist: {assertion.property_id}"
                    )
            inference_relations.extend(inference.relations)
            properties = retain_property_conflicts(
                (
                    *extract_properties(
                        representation,
                        candidate.source,
                        snapshot,
                        pattern_graph,
                        self.ontology,
                    ),
                    *inference.property_assertions,
                )
            )
            ports = map_pattern_ports(representation, candidate.source, pattern_graph)
            initial.append(replace(representation, properties=properties, ports=ports))

        grouped: dict[str, list[SemanticRepresentation]] = {}
        for representation in initial:
            grouped.setdefault(representation.resolution_id, []).append(representation)
        merged = []
        for resolution in sorted(grouped):
            values = grouped[resolution]
            first = values[0]
            properties = retain_property_conflicts(
                tuple(
                    {item.assertion_id: item for value in values for item in value.properties}[key]
                    for key in sorted(
                        {item.assertion_id: item for value in values for item in value.properties}
                    )
                )
            )
            ports = {
                item.port_id: item for value in values for item in value.ports
            }
            assertions = {
                item.assertion_id: item
                for value in values
                for item in value.class_assertions
            }
            merged.append(
                replace(
                    first,
                    source_detection_ids=tuple(
                        sorted(
                            {
                                item
                                for value in values
                                for item in value.source_detection_ids
                            }
                        )
                    ),
                    class_assertions=tuple(
                        assertions[key] for key in sorted(assertions)
                    ),
                    properties=properties,
                    ports=tuple(ports[key] for key in sorted(ports)),
                    status=min(
                        (value.status for value in values),
                        key=lambda item: _STATUS_RANK[item],
                    ),
                )
            )
        representations = tuple(merged)
        representations, region_relations = apply_document_regions(representations, pattern_graph)
        pattern_relations = map_pattern_relations(representations, pattern_graph)
        spatial_relations = assemble_spatial_membership(representations, pattern_graph)
        relation_index = {
            item.relation_id: item
            for item in (
                *pattern_relations,
                *region_relations,
                *spatial_relations,
                *inference_relations,
            )
        }
        relations = tuple(relation_index[key] for key in sorted(relation_index))
        representations = attach_relation_ids(representations, relations)
        systems = assemble_systems(representations, pattern_graph)
        identity_assertions = build_identity_assertions(representations, pattern_graph)
        identity = resolve_identity(representations, identity_assertions, pattern_graph)
        representations = identity.representations
        project_relations = lift_project_relations(relations, identity.project_objects)
        project_systems = lift_project_systems(systems, identity.project_objects)

        validator = SemanticValidator(snapshot, pattern_graph, contexts, self.ontology)
        representation_ids = {item.resolution_id for item in representations}
        for representation in representations:
            for assertion in representation.class_assertions:
                validator.validate_class_assertion(assertion)
            for assertion in representation.properties:
                validator.validate_property_assertion(
                    assertion,
                    semantic_class=representation.semantic_class,
                )
            for port in representation.ports:
                validator.validate_port(port, owner_ids=representation_ids)
        for relation in relations:
            validator.validate_relation(relation, endpoint_ids=representation_ids)
        project_node_ids = {
            item.project_object_id for item in identity.project_objects
        } | {item.object_type_id for item in identity.object_types}
        for relation in project_relations:
            validator.validate_relation(relation, endpoint_ids=project_node_ids)
        for assertion in identity_assertions:
            validator.validate_identity_assertion(
                assertion,
                representation_ids=representation_ids,
            )
        for system in systems:
            validator.validate_system(system, member_ids=representation_ids)
        for system in project_systems:
            validator.validate_system(system, member_ids=project_node_ids)
        for project_object in identity.project_objects:
            validator.validate_bundle(
                project_object.project_object_id,
                project_object.evidence,
            )
        for object_type in identity.object_types:
            validator.validate_bundle(object_type.object_type_id, object_type.evidence)

        source_pattern_keys = tuple(
            item.pattern_key
            for item in pattern_graph.instances
            if item.status not in {PatternStatus.SUPPRESSED, PatternStatus.UNSUPPORTED}
        )
        drawing = DrawingSemanticGraph.create(
            snapshot_id=snapshot.snapshot_id,
            pattern_graph_id=pattern_graph.pattern_graph_id,
            ontology_version=self.ontology.ontology_version,
            semantic_tolerance_profile_id=self.profile.profile_id,
            contexts=contexts,
            routing_decisions=routing_decisions,
            representations=representations,
            relations=relations,
            systems=systems,
            identity_assertions=identity_assertions,
            source_pattern_keys=source_pattern_keys,
        )
        effective_project_id = project_id or "project:" + stable_id(
            "single-snapshot-project", snapshot.snapshot_id, length=64
        )
        project = ProjectSemanticGraph.create(
            project_id=effective_project_id,
            drawing_graph_ids=(drawing.drawing_semantic_graph_id,),
            source_snapshot_ids=(snapshot.snapshot_id,),
            project_objects=identity.project_objects,
            object_types=identity.object_types,
            systems=project_systems,
            relations=project_relations,
            identity_clusters=identity.clusters,
            identity_assertions=identity_assertions,
        )
        bundle = SemanticGraphBundle(drawing, project)
        coverage = semantic_coverage_report(drawing, project)

        if snapshot_path is not None:
            errors = SnapshotStore.verify(snapshot_path)
            if errors:
                raise RuntimeError("Semantic inference changed source snapshot integrity: " + ", ".join(errors))
        if pattern_path is not None:
            errors = PatternStore.verify(pattern_path, snapshot_path=snapshot_path)
            if errors:
                raise RuntimeError("Semantic inference changed source PatternGraph integrity: " + ", ".join(errors))
        return SemanticBuildResult(bundle, coverage)

    def build_and_store(
        self,
        snapshot_path: str | Path,
        pattern_path: str | Path,
        output_root: str | Path,
        *,
        project_id: str | None = None,
    ) -> SemanticBuildResult:
        from cadsemantics.storage import SemanticStore

        snapshot = SnapshotStore.load(snapshot_path)
        pattern_graph = PatternStore.load(pattern_path)
        result = self.build(
            snapshot,
            pattern_graph,
            snapshot_path=snapshot_path,
            pattern_path=pattern_path,
            project_id=project_id,
        )
        location = SemanticStore.create(
            output_root,
            result.bundle,
            snapshot_path=snapshot_path,
            pattern_path=pattern_path,
        )
        return replace(result, location=location)
