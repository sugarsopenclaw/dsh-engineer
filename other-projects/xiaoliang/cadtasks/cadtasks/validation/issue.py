from __future__ import annotations

from typing import Iterable, Mapping

from cadtasks.binding import ProjectFactBundle
from cadtasks.contracts import AuditIssue, Claim, ConclusionStatus, TaskSpec
from cadtasks.rules import RuleRegistry, evaluate_predicate


class IssueValidationError(ValueError):
    pass


class IssueValidator:
    version = "1.0.0"

    def __init__(self, rules: RuleRegistry) -> None:
        self.rules = rules

    def validate(
        self,
        issue: AuditIssue,
        *,
        claims: Iterable[Claim],
        facts: ProjectFactBundle,
        spec: TaskSpec,
    ) -> None:
        claim_index = {claim.claim_id: claim for claim in claims}
        if not issue.evidence_refs:
            raise IssueValidationError(f"Issue has no evidence: {issue.issue_id}")
        missing_evidence = tuple(
            ref for ref in issue.evidence_refs if not facts.has_evidence(ref)
        )
        if missing_evidence:
            raise IssueValidationError(
                f"Issue references facts outside the binding: {issue.issue_id}: "
                + ", ".join(missing_evidence)
            )
        missing_claims = tuple(
            claim_id
            for claim_id in issue.observation_claim_ids
            if claim_id not in claim_index
        )
        if missing_claims:
            raise IssueValidationError(
                f"Issue references unknown observation claims: {issue.issue_id}"
            )
        rule = self.rules.require(issue.rule_id)
        if rule.version != issue.rule_version:
            raise IssueValidationError(f"Issue rule version drift: {issue.issue_id}")
        if issue.source_rule_ref != rule.source_ref:
            raise IssueValidationError(f"Issue rule source drift: {issue.issue_id}")
        if issue.conclusion_status is ConclusionStatus.FAIL and not issue.affected_object_refs:
            raise IssueValidationError("A failing issue must identify affected facts")
        if issue.rule_id == "generic.distinct_labels" and issue.conclusion_status is ConclusionStatus.FAIL:
            labels = []
            for reference in issue.affected_object_refs:
                bound = facts.resolution_index.get(reference)
                if bound is None:
                    raise IssueValidationError("Duplicate-label issue references a non-representation")
                labels.extend(
                    str(assertion.normalized_value).strip().casefold()
                    for assertion in bound.representation.properties
                    if assertion.property_id == "core.label_text"
                    and assertion.normalized_value is not None
                    and str(assertion.normalized_value).strip()
                )
            if len(labels) < 2 or len(set(labels)) != 1:
                raise IssueValidationError("Duplicate-label issue is not reproducible")
        if issue.rule_id.startswith("generic.numeric_threshold_"):
            observations = tuple(
                claim_index[claim_id] for claim_id in issue.observation_claim_ids
            )
            if len(observations) != 1:
                raise IssueValidationError(
                    "Numeric-condition issue requires one observation claim"
                )
            observation = observations[0]
            raw_parameters = spec.constraint("parameters", {})
            parameters = dict(raw_parameters) if isinstance(raw_parameters, Mapping) else {}
            threshold = spec.constraint("threshold")
            if threshold is not None:
                parameters["threshold"] = threshold
            if observation.value is None or (
                rule.right_parameter is not None
                and rule.right_parameter not in parameters
            ):
                expected = rule.missing_outcome
            else:
                right = (
                    None
                    if rule.right_parameter is None
                    else parameters[rule.right_parameter]
                )
                try:
                    result = evaluate_predicate(rule.op, observation.value, right)
                except (TypeError, ValueError):
                    expected = rule.missing_outcome
                else:
                    expected = rule.pass_outcome if result else rule.fail_outcome
            if issue.conclusion_status is not expected:
                raise IssueValidationError(
                    "Numeric-condition conclusion is not independently reproducible"
                )

    def validate_all(
        self,
        issues: Iterable[AuditIssue],
        *,
        claims: Iterable[Claim],
        facts: ProjectFactBundle,
        spec: TaskSpec,
    ) -> None:
        seen = set()
        claim_values = tuple(claims)
        for issue in issues:
            if issue.issue_id in seen:
                raise IssueValidationError(f"Duplicate issue id: {issue.issue_id}")
            seen.add(issue.issue_id)
            self.validate(
                issue,
                claims=claim_values,
                facts=facts,
                spec=spec,
            )
