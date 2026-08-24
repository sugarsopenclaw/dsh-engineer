from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable

from cadtasks.contracts import Artifact, ArtifactType


@dataclass(frozen=True, slots=True)
class HighlightItem:
    snapshot_id: str
    source_ref: str
    occurrence_id: str | None
    bounds: tuple[float, float, float, float] | None
    viewport: tuple[float, float, float, float] | None

    def __post_init__(self) -> None:
        for bounds in (self.bounds, self.viewport):
            if bounds is None:
                continue
            if not all(math.isfinite(value) for value in bounds):
                raise ValueError("Highlight bounds must be finite")
            if bounds[2] < bounds[0] or bounds[3] < bounds[1]:
                raise ValueError("Highlight bounds are not ordered")


@dataclass(frozen=True, slots=True)
class HighlightOverlay:
    items: tuple[HighlightItem, ...]

    @classmethod
    def create(cls, items: Iterable[HighlightItem]) -> "HighlightOverlay":
        return cls(
            tuple(
                sorted(
                    items,
                    key=lambda item: (
                        item.snapshot_id,
                        item.source_ref,
                        item.occurrence_id or "",
                    ),
                )
            )
        )

    def to_artifact(
        self,
        *,
        task_run_id: str,
        evidence_refs: Iterable[str],
    ) -> Artifact:
        return Artifact.create(
            task_run_id=task_run_id,
            artifact_type=ArtifactType.SOURCE_HIGHLIGHTS,
            media_type="application/vnd.xiaoliang.highlight+json",
            payload={"items": self.items},
            evidence_refs=evidence_refs,
        )

