from __future__ import annotations

from collections import defaultdict

from cadkernel.ir import DrawingSnapshot
from cadpatterns.contracts import PatternStatus, ScopeType
from cadpatterns.graph import PatternGraph

from cadsemantics.context.features import (
    DrawingContextHypothesis,
    RankedContextValue,
    pattern_evidence,
    text_evidence,
)
from cadsemantics.contracts import (
    EvidenceKind,
    EvidenceRef,
    SemanticStatus,
    SemanticToleranceProfile,
)


_PATTERN_CONTEXT = {
    "generic.sheet_boundary_candidate": ("documentation", "sheet_document"),
    "generic.table_grid": ("documentation", "tabular_document"),
    "generic.text_block": ("documentation", "annotated_drawing"),
    "generic.path_network": ("generic_engineering", "network_diagram"),
    "generic.network_junction": ("generic_engineering", "network_diagram"),
    "generic.network_terminal": ("generic_engineering", "network_diagram"),
    "generic.symbol_like_cluster": ("generic_engineering", "symbolic_diagram"),
    "generic.repeated_motif_group": ("generic_engineering", "symbolic_diagram"),
    "generic.enclosure_candidate": ("generic_engineering", "spatial_layout"),
}

_TEXT_CONTEXT = (
    (("legend", "图例"), "documentation", "legend_document"),
    (("schedule", "table", "表", "明细"), "documentation", "tabular_document"),
    (("detail", "详图", "节点"), "documentation", "detail_document"),
    (("section", "剖面", "剖视"), "documentation", "section_document"),
    (("diagram", "系统图", "示意"), "generic_engineering", "network_diagram"),
    (("plan", "平面"), "generic_engineering", "spatial_layout"),
)


def _ranked(
    values: dict[str, list[EvidenceRef]],
    scores: dict[str, float],
) -> tuple[RankedContextValue, ...]:
    maximum = max(scores.values(), default=1.0)
    denominator = maximum if maximum > 0.0 else 1.0
    return tuple(
        RankedContextValue(
            value,
            scores.get(value, 0.0) / denominator,
            tuple(
                {item.evidence_id: item for item in values[value]}[key]
                for key in sorted({item.evidence_id: item for item in values[value]})
            ),
        )
        for value in sorted(values, key=lambda item: (-scores.get(item, 0.0), item))
    )


def _scope_contains(graph: PatternGraph, outer_scope_id: str, inner_scope_id: str) -> bool:
    parents = {scope.scope_id: scope.parent_scope_id for scope in graph.scopes}
    current: str | None = inner_scope_id
    while current is not None:
        if current == outer_scope_id:
            return True
        current = parents.get(current)
    return False


def resolve_contexts(
    snapshot: DrawingSnapshot,
    graph: PatternGraph,
    profile: SemanticToleranceProfile | None = None,
) -> tuple[DrawingContextHypothesis, ...]:
    if graph.snapshot_id != snapshot.snapshot_id:
        raise ValueError("PatternGraph belongs to another DrawingSnapshot")
    effective_profile = profile or SemanticToleranceProfile()
    target_scopes = tuple(
        scope
        for scope in graph.scopes
        if scope.scope_type in {ScopeType.DRAWING, ScopeType.LAYOUT}
    )
    contexts = []
    for scope in target_scopes:
        discipline_evidence: dict[str, list[EvidenceRef]] = defaultdict(list)
        type_evidence: dict[str, list[EvidenceRef]] = defaultdict(list)
        phase_evidence: dict[str, list[EvidenceRef]] = defaultdict(list)
        discipline_scores: dict[str, float] = defaultdict(float)
        type_scores: dict[str, float] = defaultdict(float)
        phase_scores: dict[str, float] = defaultdict(float)
        all_evidence: list[EvidenceRef] = []
        for instance in graph.instances:
            if instance.status not in {PatternStatus.SUPPORTED, PatternStatus.CONFLICTING}:
                continue
            if not _scope_contains(graph, scope.scope_id, instance.scope_id):
                continue
            discipline, drawing_type = _PATTERN_CONTEXT[instance.pattern_type]
            evidence = pattern_evidence(graph, instance.pattern_key)
            discipline_evidence[discipline].append(evidence)
            type_evidence[drawing_type].append(evidence)
            discipline_scores[discipline] += effective_profile.context_pattern_rank
            type_scores[drawing_type] += effective_profile.context_pattern_rank
            all_evidence.append(evidence)
        allowed_text_ids = set(scope.text_occurrence_ids)
        for row, occurrence_id in enumerate(snapshot.texts.occurrence_ids):
            if str(occurrence_id) not in allowed_text_ids:
                continue
            literal = " ".join(
                str(value)
                for value in (
                    snapshot.texts.plain_text[row],
                    snapshot.texts.drawing_title[row],
                    snapshot.texts.layout_name[row],
                )
                if str(value)
            ).casefold()
            evidence = text_evidence(snapshot, row)
            for terms, discipline, drawing_type in _TEXT_CONTEXT:
                if any(term.casefold() in literal for term in terms):
                    discipline_evidence[discipline].append(evidence)
                    type_evidence[drawing_type].append(evidence)
                    discipline_scores[discipline] += effective_profile.context_text_rank
                    type_scores[drawing_type] += effective_profile.context_text_rank
                    all_evidence.append(evidence)
            if any(term in literal for term in ("construction", "施工")):
                phase_evidence["construction_drawing"].append(evidence)
                phase_scores["construction_drawing"] += effective_profile.context_text_rank
                all_evidence.append(evidence)
            elif any(term in literal for term in ("design", "设计")):
                phase_evidence["design"].append(evidence)
                phase_scores["design"] += effective_profile.context_text_rank
                all_evidence.append(evidence)
        if scope.source_ref:
            layout_ref = EvidenceRef.create(
                kind=EvidenceKind.LAYOUT,
                ref_id=scope.source_ref,
                source_snapshot_id=snapshot.snapshot_id,
            )
            all_evidence.append(layout_ref)
        if not discipline_evidence:
            discipline_evidence["unknown"] = list(all_evidence)
        if not type_evidence:
            type_evidence["general_drawing"] = list(all_evidence)
        disciplines = _ranked(discipline_evidence, discipline_scores)
        drawing_types = _ranked(type_evidence, type_scores)
        phases = _ranked(phase_evidence, phase_scores)
        conventions = tuple(
            value
            for value, candidate_types in (
                ("schematic", {"network_diagram", "symbolic_diagram"}),
                ("orthographic", {"spatial_layout", "section_document"}),
                ("tabular", {"tabular_document"}),
            )
            if any(item.value in candidate_types for item in drawing_types)
        ) or ("unknown",)
        top_scores = tuple(item.ranking_score for item in disciplines[:2])
        status = (
            SemanticStatus.AMBIGUOUS
            if len(top_scores) > 1 and top_scores[0] == top_scores[1]
            else SemanticStatus.SUPPORTED
            if all_evidence
            else SemanticStatus.ABSTAINED
        )
        contexts.append(
            DrawingContextHypothesis.create(
                source_snapshot_id=snapshot.snapshot_id,
                scope_id=scope.scope_id,
                bounds=scope.bounds,
                disciplines=disciplines,
                drawing_types=drawing_types,
                representation_conventions=conventions,
                phases=phases,
                source_evidence=tuple(all_evidence),
                status=status,
            )
        )
    return tuple(sorted(contexts, key=lambda item: item.context_id))


def context_for_scope(
    graph: PatternGraph,
    contexts: tuple[DrawingContextHypothesis, ...],
    scope_id: str,
) -> DrawingContextHypothesis:
    eligible = [
        item for item in contexts if _scope_contains(graph, item.scope_id, scope_id)
    ]
    if not eligible:
        raise KeyError(f"No semantic context covers pattern scope {scope_id}")
    scope_by_id = {scope.scope_id: scope for scope in graph.scopes}
    return min(
        eligible,
        key=lambda item: (
            len(scope_by_id[item.scope_id].occurrence_ids),
            item.context_id,
        ),
    )
