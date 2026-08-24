from __future__ import annotations

from typing import Iterable

from cadtasks.contracts import CapabilityGap


def schedule_row_gap(evidence_refs: Iterable[str]) -> CapabilityGap:
    return CapabilityGap.create(
        capability_id="schedule.quantity",
        missing="schedule.row_segmentation",
        reason="The current semantic schedule fact is whole-grid, not row-level quantity data.",
        claim_type="BOM_DECLARED_COUNT",
        data_gap="schedule.row_segmentation",
        evidence_refs=evidence_refs,
    )


def cross_file_identity_gap(evidence_refs: Iterable[str]) -> CapabilityGap:
    return CapabilityGap.create(
        capability_id="identity.cross_file",
        missing="cross_file_identity",
        reason="No proven identity relation joins independent drawing stores.",
        claim_type="PHYSICAL_INSTANCE_COUNT",
        data_gap="cross_file_identity",
        evidence_refs=evidence_refs,
    )


def unsupported_recipe_gap(recipe_id: str) -> CapabilityGap:
    return CapabilityGap.create(
        capability_id="recipe.registry",
        missing=recipe_id,
        reason="No registered deterministic recipe implements the requested task.",
        claim_type=None,
    )

