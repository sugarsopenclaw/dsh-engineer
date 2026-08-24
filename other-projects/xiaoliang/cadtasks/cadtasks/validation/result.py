from __future__ import annotations

from cadtasks.binding import ProjectFactBundle
from cadtasks.contracts import TaskResultBundle, TaskStatus
from cadtasks.rules import RuleRegistry
from cadtasks.validation.claim import ClaimValidator
from cadtasks.validation.issue import IssueValidator


class ResultValidationError(ValueError):
    pass


class ResultValidator:
    version = "1.0.0"

    def __init__(self, rules: RuleRegistry) -> None:
        self.claims = ClaimValidator(rules)
        self.issues = IssueValidator(rules)

    def validate(
        self,
        bundle: TaskResultBundle,
        *,
        facts: ProjectFactBundle,
    ) -> None:
        if bundle.project_snapshot_set_id != facts.binding.project_snapshot_set_id:
            raise ResultValidationError("Result belongs to another project snapshot set")
        if bundle.task_spec.scope.project_id != facts.binding.project_id:
            raise ResultValidationError("Result TaskSpec belongs to another project")
        self.claims.validate_all(
            bundle.claims,
            facts=facts,
            spec=bundle.task_spec,
        )
        self.issues.validate_all(
            bundle.issues,
            claims=bundle.claims,
            facts=facts,
            spec=bundle.task_spec,
        )
        for artifact in bundle.artifacts:
            missing = tuple(
                ref for ref in artifact.evidence_refs if not facts.has_evidence(ref)
            )
            if missing:
                raise ResultValidationError(
                    f"Artifact references facts outside the binding: {artifact.artifact_id}"
                )
        claim_ids = tuple(claim.claim_id for claim in bundle.claims)
        dependency_claim_ids = tuple(
            entry.claim_id for entry in bundle.dependency_graph.entries
        )
        if dependency_claim_ids != claim_ids:
            raise ResultValidationError("Result dependency graph does not cover every claim")
        for claim, entry in zip(bundle.claims, bundle.dependency_graph.entries):
            if claim.evidence_refs != entry.evidence_refs:
                raise ResultValidationError("Result dependency evidence differs from claim evidence")
        if bundle.gaps and bundle.status is TaskStatus.COMPLETED:
            raise ResultValidationError("A result with capability gaps cannot be COMPLETED")
        if not bundle.claims and not bundle.gaps:
            raise ResultValidationError("Task result contains neither claims nor explicit gaps")
        upstream_errors = facts.binding.verify()
        if upstream_errors:
            raise ResultValidationError(
                "Immutable upstream verification failed after execution: "
                + ", ".join(upstream_errors)
            )

