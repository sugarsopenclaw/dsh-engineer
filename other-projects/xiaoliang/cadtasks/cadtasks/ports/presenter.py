from __future__ import annotations

from typing import Iterable, Protocol

from cadtasks.contracts import AuditIssue, CapabilityGap, Claim, TaskSpec


class ResultPresenterPort(Protocol):
    presenter_version: str

    def present(
        self,
        *,
        spec: TaskSpec,
        claims: Iterable[Claim],
        issues: Iterable[AuditIssue],
        gaps: Iterable[CapabilityGap],
    ) -> str: ...


class DeterministicResultPresenter:
    presenter_version = "deterministic-result-presenter:1.0.0"

    def present(
        self,
        *,
        spec: TaskSpec,
        claims: Iterable[Claim],
        issues: Iterable[AuditIssue],
        gaps: Iterable[CapabilityGap],
    ) -> str:
        claim_values = tuple(sorted(claims, key=lambda item: item.claim_id))
        issue_values = tuple(sorted(issues, key=lambda item: item.issue_id))
        gap_values = tuple(sorted(gaps, key=lambda item: item.gap_id))
        lines = [
            f"task={spec.task_type.value}",
            f"target={spec.target.semantic_class}",
            f"claims={len(claim_values)}",
            f"issues={len(issue_values)}",
            f"gaps={len(gap_values)}",
        ]
        lines.extend(
            f"claim {claim.claim_type} {claim.status.value} value={claim.value!r}"
            for claim in claim_values
        )
        lines.extend(
            f"issue {issue.rule_id} {issue.conclusion_status.value}"
            for issue in issue_values
        )
        lines.extend(f"gap {gap.missing}: {gap.reason}" for gap in gap_values)
        return "\n".join(lines)

