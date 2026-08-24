from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class InvalidationPlan:
    old_snapshot_id: str
    new_snapshot_id: str
    invalidate_all: bool
    scope_ids: tuple[str, ...] = ()
    reason: str = ""


def plan_invalidation(
    old_snapshot_id: str,
    new_snapshot_id: str,
) -> InvalidationPlan:
    """Expose future invalidation policy without pretending snapshots are mutable.

    A drawing edit creates a new immutable snapshot id. There is therefore no
    truthful local invalidation trigger in v1: equal ids reuse content-addressed
    results and different ids invalidate the complete derived graph.
    """

    changed = old_snapshot_id != new_snapshot_id
    return InvalidationPlan(
        old_snapshot_id=old_snapshot_id,
        new_snapshot_id=new_snapshot_id,
        invalidate_all=changed,
        reason=(
            "new immutable snapshot id requires a new PatternGraph"
            if changed
            else "identical immutable snapshot id remains content-addressable"
        ),
    )
