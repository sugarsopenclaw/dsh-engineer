from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from cadpatterns.contracts import PatternStatus
from cadpatterns.graph import PatternGraph

from cadsemantics.context import DrawingContextHypothesis
from cadsemantics.packs.manifest import PackManifest, PackRoutingDecision


def _scope_contains(graph: PatternGraph, outer_scope_id: str, inner_scope_id: str) -> bool:
    parents = {scope.scope_id: scope.parent_scope_id for scope in graph.scopes}
    current: str | None = inner_scope_id
    while current is not None:
        if current == outer_scope_id:
            return True
        current = parents.get(current)
    return False


@dataclass(frozen=True, slots=True)
class PackRegistry:
    manifests: tuple[PackManifest, ...]

    @classmethod
    def create(cls, manifests: Iterable[PackManifest]) -> "PackRegistry":
        indexed: dict[str, PackManifest] = {}
        for manifest in manifests:
            if manifest.pack_id in indexed:
                raise ValueError(f"Duplicate domain pack: {manifest.pack_id}")
            indexed[manifest.pack_id] = manifest
        return cls(tuple(indexed[key] for key in sorted(indexed)))

    def require(self, pack_id: str) -> PackManifest:
        for manifest in self.manifests:
            if manifest.pack_id == pack_id:
                return manifest
        raise KeyError(pack_id)

    def route(
        self,
        context: DrawingContextHypothesis,
        graph: PatternGraph,
    ) -> tuple[PackRoutingDecision, ...]:
        disciplines = {item.value for item in context.discipline_candidates}
        drawing_types = {item.value for item in context.drawing_type_candidates}
        pattern_types = {
            item.pattern_type
            for item in graph.instances
            if item.status not in {PatternStatus.SUPPRESSED, PatternStatus.UNSUPPORTED}
            and _scope_contains(graph, context.scope_id, item.scope_id)
        }
        decisions = []
        for manifest in self.manifests:
            reasons = []
            discipline_match = not manifest.supported_disciplines or bool(
                disciplines.intersection(manifest.supported_disciplines)
            )
            drawing_type_match = not manifest.supported_drawing_types or bool(
                drawing_types.intersection(manifest.supported_drawing_types)
            )
            pattern_match = not manifest.requires_patterns or bool(
                pattern_types.intersection(manifest.requires_patterns)
            )
            if not discipline_match:
                reasons.append("no supported discipline candidate")
            if not drawing_type_match:
                reasons.append("no supported drawing-type candidate")
            if not pattern_match:
                reasons.append("none of the pack candidate patterns are present")
            decisions.append(
                PackRoutingDecision(
                    manifest.pack_id,
                    context.context_id,
                    discipline_match and drawing_type_match and pattern_match,
                    tuple(reasons) if reasons else ("applicable context and source pattern",),
                )
            )
        return tuple(decisions)
