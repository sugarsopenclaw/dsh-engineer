from __future__ import annotations

from dataclasses import dataclass

from cadkernel.ir import DrawingSnapshot
from cadpatterns.contracts import PatternInstance, PatternStatus
from cadpatterns.graph import PatternGraph

from cadsemantics.context import DrawingContextHypothesis, context_for_scope
from cadsemantics.contracts import (
    ClassAssertion,
    EvidenceBundle,
    RepresentationMode,
    SemanticStatus,
    SemanticToleranceProfile,
)
from cadsemantics.evidence import fuse_evidence
from cadsemantics.mapping.predicates import (
    PredicateContext,
    PredicateResult,
    evaluate_predicate,
)
from cadsemantics.mapping.specs import PredicateCall, SemanticMappingSpec
from cadsemantics.ontology import OntologyRegistry, validate_identity_axes
from cadsemantics.packs import PackManifest, PackRegistry


@dataclass(frozen=True, slots=True)
class SemanticCandidate:
    spec: SemanticMappingSpec
    manifest: PackManifest
    source: PatternInstance
    context: DrawingContextHypothesis
    class_assertion: ClassAssertion
    representation_mode: RepresentationMode
    functional_roles: tuple[str, ...]


def _evaluate_calls(
    context: PredicateContext,
    calls,
) -> tuple[PredicateResult, ...]:
    return tuple(evaluate_predicate(context, call) for call in calls)


def evaluate_mapping(
    snapshot: DrawingSnapshot,
    graph: PatternGraph,
    context: DrawingContextHypothesis,
    manifest: PackManifest,
    instance: PatternInstance,
    spec: SemanticMappingSpec,
    profile: SemanticToleranceProfile | None = None,
) -> ClassAssertion:
    predicate_context = PredicateContext(snapshot, graph, context, manifest, instance)
    must = _evaluate_calls(predicate_context, spec.must)
    must_any = _evaluate_calls(predicate_context, spec.must_any)
    should = _evaluate_calls(predicate_context, spec.should)
    must_not = _evaluate_calls(predicate_context, spec.must_not)
    base = evaluate_predicate(
        predicate_context,
        next(call for call in spec.must if call.predicate == "pattern_type_is")
        if any(call.predicate == "pattern_type_is" for call in spec.must)
        else PredicateCall("pattern_type_is", (("value", instance.pattern_type),)),
    )
    support = [*base.evidence]
    support.extend(
        evidence
        for result in (*must, *must_any, *should)
        if result.matched
        for evidence in result.evidence
    )
    opposing = [
        evidence
        for result in must
        if not result.matched
        for evidence in result.evidence
    ]
    excluding = [
        evidence
        for result in must_not
        if result.matched
        for evidence in result.evidence
    ]
    missing = tuple(
        result.reason for result in must if not result.matched
    )
    has_required_alternative = not must_any or any(item.matched for item in must_any)
    if must_any and not has_required_alternative:
        opposing.extend(evidence for result in must_any for evidence in result.evidence)
    bundle = EvidenceBundle.create(
        supporting=support,
        opposing=opposing,
        excluding=excluding,
        missing_required=missing,
    )
    status, grade = fuse_evidence(
        bundle,
        has_required_alternative=has_required_alternative,
        should_declared=bool(should),
        should_match_ratio=(
            sum(item.matched for item in should) / len(should)
            if should
            else 1.0
        ),
        minimum_should_ratio=(
            profile or SemanticToleranceProfile()
        ).supported_should_ratio,
    )
    return ClassAssertion.create(
        class_id=spec.target_class,
        status=status,
        evidence_grade=grade,
        evidence=bundle,
        geometry_proof_grades=(instance.proof_grade.value,),
    )


def generate_semantic_candidates(
    snapshot: DrawingSnapshot,
    graph: PatternGraph,
    contexts: tuple[DrawingContextHypothesis, ...],
    manifests: tuple[PackManifest, ...],
    specs: tuple[SemanticMappingSpec, ...],
    ontology: OntologyRegistry,
    profile: SemanticToleranceProfile | None = None,
) -> tuple[SemanticCandidate, ...]:
    manifest_by_id = {item.pack_id: item for item in manifests}
    registry = PackRegistry.create(manifests)
    candidates = []
    for spec in specs:
        class_definition = ontology.classes.require(spec.target_class)
        if spec.representation_mode not in class_definition.allowed_representation_modes:
            raise ValueError(
                f"Mapping {spec.mapping_id} uses a representation mode that is not "
                f"allowed for {spec.target_class}"
            )
        manifest = manifest_by_id[spec.pack_id]
        if spec.target_class not in manifest.provides_classes:
            raise ValueError(
                f"Mapping {spec.mapping_id} targets class outside pack whitelist: {spec.target_class}"
            )
        validate_identity_axes(
            semantic_class_ids=(spec.target_class,),
            object_type_id=None,
            functional_roles=spec.functional_roles,
            lifecycle_state=None,
            project_phase=None,
            registry=ontology,
        )
        for instance in graph.instances:
            if instance.pattern_type not in spec.source_patterns:
                continue
            if instance.status in {PatternStatus.SUPPRESSED, PatternStatus.UNSUPPORTED}:
                continue
            context = context_for_scope(graph, contexts, instance.scope_id)
            decision = next(
                item
                for item in registry.route(context, graph)
                if item.pack_id == manifest.pack_id
            )
            if not decision.accepted:
                continue
            assertion = evaluate_mapping(
                snapshot,
                graph,
                context,
                manifest,
                instance,
                spec,
                profile,
            )
            candidates.append(
                SemanticCandidate(
                    spec,
                    manifest,
                    instance,
                    context,
                    assertion,
                    spec.representation_mode,
                    spec.functional_roles,
                )
            )
    return tuple(
        sorted(
            candidates,
            key=lambda item: (
                item.spec.target_class,
                item.source.pattern_key,
                item.spec.mapping_id,
            ),
        )
    )
