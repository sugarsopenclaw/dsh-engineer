from __future__ import annotations

from dataclasses import dataclass

from cadkernel.contracts import stable_id, stable_json_dumps

from cadtasks.binding import ProjectFactBundle
from cadtasks.capabilities import CapabilityRegistry
from cadtasks.contracts import ID_LENGTH
from cadtasks.recipes import RecipeRegistry
from cadtasks.rules import RuleRegistry


@dataclass(frozen=True, slots=True)
class TaskCoverageReport:
    report_id: str
    project_snapshot_set_id: str
    source_count: int
    occurrence_count: int
    pattern_count: int
    representation_count: int
    project_object_count: int
    semantic_classes: tuple[str, ...]
    capability_versions: tuple[tuple[str, str], ...]
    recipe_versions: tuple[tuple[str, str], ...]
    rule_versions: tuple[tuple[str, str], ...]
    intentional_gaps: tuple[str, ...]

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)


def task_coverage_report(
    facts: ProjectFactBundle,
    *,
    capabilities: CapabilityRegistry,
    recipes: RecipeRegistry,
    rules: RuleRegistry,
) -> TaskCoverageReport:
    capability_versions = capabilities.versions()
    recipe_versions = recipes.versions()
    rule_versions = rules.versions()
    gaps = (
        "cross_file_identity",
        "field_level_result_invalidation",
        "schedule.row_segmentation",
    )
    digest = stable_id(
        "task-coverage-report",
        facts.binding.project_snapshot_set_id,
        len(facts.sources),
        len(facts.occurrence_index),
        len(facts.detection_index),
        len(facts.resolution_index),
        len(facts.project_object_index),
        facts.semantic_classes,
        capability_versions,
        recipe_versions,
        rule_versions,
        gaps,
        length=ID_LENGTH,
    )
    return TaskCoverageReport(
        "task-coverage:" + digest,
        facts.binding.project_snapshot_set_id,
        len(facts.sources),
        len(facts.occurrence_index),
        len(facts.detection_index),
        len(facts.resolution_index),
        len(facts.project_object_index),
        facts.semantic_classes,
        capability_versions,
        recipe_versions,
        rule_versions,
        gaps,
    )

