from __future__ import annotations

from dataclasses import dataclass

from cadtasks.binding import ProjectFactBundle
from cadtasks.contracts import ClaimStatus, TaskResultBundle


@dataclass(frozen=True, slots=True)
class TaskMetrics:
    claim_count: int
    proven_claim_count: int
    evidence_reference_count: int
    evidence_valid_ratio: float
    gap_count: int
    issue_count: int


def task_metrics(
    bundle: TaskResultBundle,
    *,
    facts: ProjectFactBundle,
) -> TaskMetrics:
    refs = tuple(ref for claim in bundle.claims for ref in claim.evidence_refs)
    valid = sum(1 for ref in refs if facts.has_evidence(ref))
    return TaskMetrics(
        len(bundle.claims),
        sum(1 for claim in bundle.claims if claim.status is ClaimStatus.PROVEN),
        len(refs),
        valid / len(refs) if refs else 0.0,
        len(bundle.gaps),
        len(bundle.issues),
    )


def deterministic_equal(first: TaskResultBundle, second: TaskResultBundle) -> bool:
    return first.to_json() == second.to_json()

