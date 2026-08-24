from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from cadkernel.contracts import stable_id

from cadtasks.binding import ProjectFactBundle
from cadtasks.contracts import ID_LENGTH, ScopeType, TaskSpec


def scoped_object_refs(spec: TaskSpec, facts: ProjectFactBundle) -> tuple[str, ...]:
    """Expand every object reference a TaskSpec selects: explicit scope refs,
    members of referenced systems, and target subject selectors. Scope
    resolution and independent validation share this single expansion."""
    refs = {str(item) for item in spec.scope.object_refs}
    for system_ref in {str(item) for item in spec.scope.systems}:
        refs.update(facts.system_member_index.get(system_ref, ()))
    selector_ref = spec.target.selector("subject_ref")
    if selector_ref is not None:
        refs.add(str(selector_ref))
    selector_refs = spec.target.selector("subject_refs", ())
    if isinstance(selector_refs, (list, tuple, set, frozenset)):
        refs.update(str(item) for item in selector_refs)
    return tuple(sorted(refs))


@dataclass(frozen=True, slots=True)
class ResolvedScope:
    scope_id: str
    scope_type: ScopeType
    project_id: str
    source_ordinals: tuple[int, ...]
    snapshot_ids: tuple[str, ...]
    regions: tuple[tuple[float, float, float, float], ...]
    object_refs: tuple[str, ...]
    layout_names: tuple[str, ...]
    assumptions: tuple[str, ...] = ()

    def includes_bounds(
        self,
        bounds: tuple[float, float, float, float] | None,
    ) -> bool:
        if not self.regions:
            return True
        if bounds is None:
            return False
        return any(
            bounds[0] <= region[2]
            and bounds[2] >= region[0]
            and bounds[1] <= region[3]
            and bounds[3] >= region[1]
            for region in self.regions
        )


class ScopeResolver:
    version = "1.0.0"

    def resolve(self, spec: TaskSpec, facts: ProjectFactBundle) -> ResolvedScope:
        if spec.scope.project_id != facts.binding.project_id:
            raise ValueError(
                "TaskScope project does not match the verified ProjectBinding"
            )
        requested_files = set(spec.scope.files)
        ordinals = []
        for source in facts.sources:
            identifiers = {
                source.source.snapshot_id,
                source.source.pattern_graph_id,
                source.source.drawing_semantic_graph_id,
                source.source.project_semantic_graph_id,
                source.source.snapshot_path,
            }
            if not requested_files or identifiers.intersection(requested_files):
                ordinals.append(source.ordinal)
        if requested_files and not ordinals:
            raise ValueError("TaskScope files do not identify a bound project source")

        system_refs = tuple(sorted(set(spec.scope.systems)))
        unknown_systems = tuple(
            system_ref
            for system_ref in system_refs
            if system_ref not in facts.system_member_index
        )
        if unknown_systems:
            raise ValueError(
                "TaskScope references unknown systems: "
                + ", ".join(unknown_systems)
            )
        object_refs = scoped_object_refs(spec, facts)
        missing_refs = tuple(ref for ref in object_refs if not facts.has_evidence(ref))
        if missing_refs:
            raise ValueError("TaskScope references unknown facts: " + ", ".join(missing_refs))
        if spec.scope.scope_type in {
            ScopeType.ENTITY,
            ScopeType.PATTERN,
            ScopeType.SEMANTIC_REPRESENTATION,
            ScopeType.PROJECT_OBJECT,
        } and not object_refs:
            raise ValueError(f"{spec.scope.scope_type.value} scope requires object_refs")
        if spec.scope.scope_type is ScopeType.SYSTEM and not system_refs:
            raise ValueError("SYSTEM scope requires systems")
        if spec.scope.storeys:
            raise ValueError(
                "STOREY filtering is unavailable until an upstream storey fact exists"
            )

        regions = spec.scope.regions
        selector_bounds = spec.target.selector("bounds")
        if selector_bounds is not None:
            if not isinstance(selector_bounds, (list, tuple)) or len(selector_bounds) != 4:
                raise ValueError("TaskTarget bounds selector requires four coordinates")
            bounds = tuple(float(item) for item in selector_bounds)
            if bounds[2] < bounds[0] or bounds[3] < bounds[1]:
                raise ValueError("TaskTarget bounds selector is not ordered")
            regions = tuple(sorted({*regions, bounds}))
        if spec.scope.scope_type is ScopeType.REGION and not regions:
            raise ValueError("REGION scope requires at least one bounds tuple")

        snapshot_ids = tuple(facts.sources[index].source.snapshot_id for index in ordinals)
        layouts = tuple(sorted({*spec.scope.sheets, *spec.scope.views}))
        available_layouts = {
            str(layout_name)
            for index in ordinals
            for layout_name in facts.sources[index].snapshot.occurrences.layout_names
        }
        unknown_layouts = tuple(
            layout for layout in layouts if layout not in available_layouts
        )
        if unknown_layouts:
            raise ValueError(
                "TaskScope references unknown layouts: "
                + ", ".join(unknown_layouts)
            )
        if spec.scope.scope_type in {ScopeType.VIEW, ScopeType.SHEET} and not layouts:
            raise ValueError(f"{spec.scope.scope_type.value} scope requires views or sheets")
        digest = stable_id(
            "resolved-task-scope",
            spec.task_spec_key,
            facts.binding.project_snapshot_set_id,
            tuple(ordinals),
            snapshot_ids,
            regions,
            object_refs,
            layouts,
            length=ID_LENGTH,
        )
        return ResolvedScope(
            "resolved-scope:" + digest,
            spec.scope.scope_type,
            spec.scope.project_id,
            tuple(ordinals),
            snapshot_ids,
            regions,
            object_refs,
            layouts,
        )


def scoped_bounds(
    values: Iterable[tuple[float, float, float, float]],
) -> tuple[float, float, float, float] | None:
    bounds = tuple(values)
    if not bounds:
        return None
    return (
        min(item[0] for item in bounds),
        min(item[1] for item in bounds),
        max(item[2] for item in bounds),
        max(item[3] for item in bounds),
    )
