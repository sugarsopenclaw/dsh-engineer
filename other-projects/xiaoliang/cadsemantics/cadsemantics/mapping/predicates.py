from __future__ import annotations

from dataclasses import dataclass
import fnmatch
from typing import Callable

from cadkernel.ir import DrawingSnapshot
from cadpatterns.contracts import PatternInstance, ReferenceKind, RelationType
from cadpatterns.graph import PatternGraph

from cadsemantics.context import DrawingContextHypothesis
from cadsemantics.contracts import EvidenceKind, EvidenceRef
from cadsemantics.mapping.specs import PREDICATE_WHITELIST, PredicateCall
from cadsemantics.packs import PackManifest


@dataclass(frozen=True, slots=True)
class PredicateContext:
    snapshot: DrawingSnapshot
    graph: PatternGraph
    context: DrawingContextHypothesis
    manifest: PackManifest
    instance: PatternInstance


@dataclass(frozen=True, slots=True)
class PredicateResult:
    matched: bool
    evidence: tuple[EvidenceRef, ...]
    reason: str


def _pattern_ref(context: PredicateContext) -> EvidenceRef:
    return EvidenceRef.create(
        kind=EvidenceKind.PATTERN,
        ref_id=context.instance.pattern_key,
        source_snapshot_id=context.graph.snapshot_id,
        source_pattern_graph_id=context.graph.pattern_graph_id,
        geometry_proof_grade=context.instance.proof_grade.value,
    )


def _feature_ref(context: PredicateContext, name: str) -> EvidenceRef:
    return EvidenceRef.create(
        kind=EvidenceKind.FEATURE,
        ref_id=context.instance.pattern_key,
        source_snapshot_id=context.graph.snapshot_id,
        source_pattern_graph_id=context.graph.pattern_graph_id,
        feature_key=name,
        geometry_proof_grade=context.instance.proof_grade.value,
        literal=str(context.instance.feature(name)),
    )


def _text_ids(context: PredicateContext) -> tuple[str, ...]:
    values = {
        item.ref.ref_id
        for item in context.instance.members
        if item.ref.kind is ReferenceKind.TEXT
    }
    text_patterns = {context.instance.pattern_key}
    for edge in context.graph.edges:
        if (
            edge.relation in {RelationType.LABELS, RelationType.POINTS_TO}
            and edge.target.kind is ReferenceKind.PATTERN
            and edge.target.ref_id == context.instance.pattern_key
        ):
            text_patterns.add(edge.source_pattern_key)
    for pattern in context.graph.instances:
        if pattern.pattern_key not in text_patterns:
            continue
        values.update(
            member.ref.ref_id
            for member in pattern.members
            if member.ref.kind is ReferenceKind.TEXT
        )
    return tuple(sorted(values))


def _text_rows(snapshot: DrawingSnapshot) -> dict[str, int]:
    return {
        str(occurrence_id): row
        for row, occurrence_id in enumerate(snapshot.texts.occurrence_ids)
    }


def _pattern_type_is(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    expected = str(call.argument("value"))
    return PredicateResult(
        context.instance.pattern_type == expected,
        (_pattern_ref(context),),
        f"pattern type is {expected}",
    )


def _feature_at_least(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    name = str(call.argument("feature", call.argument("name")))
    actual = context.instance.feature(name)
    expected = call.argument("value")
    matched = isinstance(actual, (int, float)) and not isinstance(actual, bool) and actual >= expected
    return PredicateResult(matched, (_feature_ref(context, name),), f"feature {name} >= {expected}")


def _feature_in(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    name = str(call.argument("feature", call.argument("name")))
    values = tuple(call.argument("values", ()))
    return PredicateResult(
        context.instance.feature(name) in values,
        (_feature_ref(context, name),),
        f"feature {name} is in declared values",
    )


def _member_count_at_least(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    expected = int(call.argument("value"))
    return PredicateResult(
        len(context.instance.members) >= expected,
        (_pattern_ref(context),),
        f"member count >= {expected}",
    )


def _has_edge(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    relation = RelationType(str(call.argument("relation")))
    edges = tuple(
        edge
        for edge in context.graph.edges
        if edge.relation is relation
        and (
            edge.source_pattern_key == context.instance.pattern_key
            or edge.target.kind is ReferenceKind.PATTERN
            and edge.target.ref_id == context.instance.pattern_key
        )
    )
    evidence = tuple(
        EvidenceRef.create(
            kind=EvidenceKind.PATTERN_EDGE,
            ref_id=edge.edge_id,
            source_snapshot_id=context.graph.snapshot_id,
            source_pattern_graph_id=context.graph.pattern_graph_id,
            geometry_proof_grade=edge.proof_grade.value,
        )
        for edge in edges
    ) or (_pattern_ref(context),)
    return PredicateResult(bool(edges), evidence, f"has {relation.value} edge")


def _scope_is_descendant(graph: PatternGraph, inner: str, outer: str) -> bool:
    parents = {scope.scope_id: scope.parent_scope_id for scope in graph.scopes}
    current: str | None = inner
    while current is not None:
        if current == outer:
            return True
        current = parents.get(current)
    return False


def _inside_pattern_of_type(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    expected = str(call.argument("pattern_type", call.argument("value")))
    targets = tuple(
        item
        for item in context.graph.instances
        if item.pattern_type == expected
        and item.pattern_key != context.instance.pattern_key
        and _scope_is_descendant(context.graph, context.instance.scope_id, item.scope_id)
    )
    evidence = (
        _pattern_ref(context),
        *(
            EvidenceRef.create(
                kind=EvidenceKind.PATTERN,
                ref_id=item.pattern_key,
                source_snapshot_id=context.graph.snapshot_id,
                source_pattern_graph_id=context.graph.pattern_graph_id,
                geometry_proof_grade=item.proof_grade.value,
            )
            for item in targets
        ),
    )
    return PredicateResult(bool(targets), evidence, f"inside pattern type {expected}")


def _shares_feature_with_pattern_type(
    context: PredicateContext,
    call: PredicateCall,
) -> PredicateResult:
    expected_type = str(call.argument("pattern_type"))
    feature_name = str(call.argument("feature", "face_id"))
    actual = context.instance.feature(feature_name)
    targets = tuple(
        item
        for item in context.graph.instances
        if item.pattern_key != context.instance.pattern_key
        and item.pattern_type == expected_type
        and actual is not None
        and item.feature(feature_name) == actual
    )
    evidence = (
        _feature_ref(context, feature_name),
        *(
            EvidenceRef.create(
                kind=EvidenceKind.FEATURE,
                ref_id=item.pattern_key,
                source_snapshot_id=context.graph.snapshot_id,
                source_pattern_graph_id=context.graph.pattern_graph_id,
                feature_key=feature_name,
                geometry_proof_grade=item.proof_grade.value,
                literal=str(item.feature(feature_name)),
            )
            for item in targets
        ),
    )
    return PredicateResult(
        bool(targets),
        evidence,
        f"shares {feature_name} with pattern type {expected_type}",
    )


def _text_matches_lexicon(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    name = str(call.argument("lexicon"))
    terms = tuple(item.casefold() for item in context.manifest.lexicon(name))
    rows = _text_rows(context.snapshot)
    evidence = []
    for occurrence_id in _text_ids(context):
        row = rows.get(occurrence_id)
        if row is None:
            continue
        literal = str(context.snapshot.texts.plain_text[row])
        if any(term in literal.casefold() for term in terms):
            evidence.append(
                EvidenceRef.create(
                    kind=EvidenceKind.TEXT,
                    ref_id=occurrence_id,
                    source_snapshot_id=context.snapshot.snapshot_id,
                    literal=literal,
                )
            )
    return PredicateResult(bool(evidence), tuple(evidence) or (_pattern_ref(context),), f"text matches lexicon {name}")


def _context_discipline_any(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    values = {str(item) for item in call.argument("values", ())}
    candidates = {item.value for item in context.context.discipline_candidates}
    return PredicateResult(
        bool(values.intersection(candidates)),
        context.context.source_evidence or (_pattern_ref(context),),
        "context discipline intersects declared values",
    )


def _source_layer_matches(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    expression = str(call.argument("value", call.argument("pattern", "*")))
    geometry = context.snapshot.geometry
    definition_layer = {
        str(definition_id): str(layer)
        for definition_id, layer in zip(
            context.snapshot.definitions.definition_ids,
            context.snapshot.definitions.layers,
        )
    }
    rows = {
        str(occurrence_id): row
        for row, occurrence_id in enumerate(geometry.occurrence_ids)
    }
    evidence = []
    for member in context.instance.members:
        if member.ref.kind is not ReferenceKind.OCCURRENCE:
            continue
        row = rows.get(member.ref.ref_id)
        if row is None:
            continue
        layer = definition_layer.get(str(geometry.definition_ids[row]), "")
        if fnmatch.fnmatchcase(layer.casefold(), expression.casefold()):
            evidence.append(
                EvidenceRef.create(
                    kind=EvidenceKind.OCCURRENCE,
                    ref_id=member.ref.ref_id,
                    source_snapshot_id=context.snapshot.snapshot_id,
                    literal=layer,
                )
            )
    return PredicateResult(bool(evidence), tuple(evidence) or (_pattern_ref(context),), f"source layer matches {expression}")


def _block_attribute_present(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    expected = call.argument("tag")
    rows = _text_rows(context.snapshot)
    evidence = []
    for occurrence_id in _text_ids(context):
        row = rows.get(occurrence_id)
        if row is None:
            continue
        tag = str(context.snapshot.texts.block_attribute_tag[row])
        value = str(context.snapshot.texts.block_attribute_value[row])
        if value and (expected is None or tag.casefold() == str(expected).casefold()):
            evidence.append(
                EvidenceRef.create(
                    kind=EvidenceKind.TEXT,
                    ref_id=occurrence_id,
                    source_snapshot_id=context.snapshot.snapshot_id,
                    feature_key="block_attribute",
                    literal=f"{tag}={value}",
                )
            )
    return PredicateResult(bool(evidence), tuple(evidence) or (_pattern_ref(context),), "block attribute is present")


def _annotation_kind_present(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    expected = str(call.argument("value", call.argument("kind"))).casefold()
    scope = next(item for item in context.graph.scopes if item.scope_id == context.instance.scope_id)
    allowed = set(scope.occurrence_ids)
    evidence = tuple(
        EvidenceRef.create(
            kind=EvidenceKind.ANNOTATION,
            ref_id=str(occurrence_id),
            source_snapshot_id=context.snapshot.snapshot_id,
            literal=str(kind),
        )
        for occurrence_id, kind in zip(
            context.snapshot.annotations.occurrence_ids,
            context.snapshot.annotations.annotation_kinds,
        )
        if str(occurrence_id) in allowed and str(kind).casefold() == expected
    )
    return PredicateResult(bool(evidence), evidence or (_pattern_ref(context),), f"annotation kind {expected} is present")


_PREDICATES: dict[str, Callable[[PredicateContext, PredicateCall], PredicateResult]] = {
    "pattern_type_is": _pattern_type_is,
    "feature_at_least": _feature_at_least,
    "feature_in": _feature_in,
    "member_count_at_least": _member_count_at_least,
    "has_edge": _has_edge,
    "inside_pattern_of_type": _inside_pattern_of_type,
    "shares_feature_with_pattern_type": _shares_feature_with_pattern_type,
    "text_matches_lexicon": _text_matches_lexicon,
    "context_discipline_any": _context_discipline_any,
    "source_layer_matches": _source_layer_matches,
    "block_attribute_present": _block_attribute_present,
    "annotation_kind_present": _annotation_kind_present,
}

if tuple(sorted(_PREDICATES)) != PREDICATE_WHITELIST:
    raise RuntimeError("Semantic predicate declarations and implementations disagree")


def evaluate_predicate(context: PredicateContext, call: PredicateCall) -> PredicateResult:
    function = _PREDICATES.get(call.predicate)
    if function is None:
        raise ValueError(
            f"Predicate {call.predicate!r} is not allowed; whitelist={PREDICATE_WHITELIST}"
        )
    return function(context, call)
