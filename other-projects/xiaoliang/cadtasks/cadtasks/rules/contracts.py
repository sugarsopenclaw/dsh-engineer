from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from cadtasks.contracts import (
    ApplicabilityStatus,
    ConclusionStatus,
    Severity,
)


@dataclass(frozen=True, slots=True)
class RuleSpec:
    rule_id: str
    version: str
    description: str
    left_kind: str
    left_ref: str
    op: str
    right_parameter: str | None
    required_properties: tuple[str, ...]
    required_measurements: tuple[str, ...]
    pass_outcome: ConclusionStatus
    fail_outcome: ConclusionStatus
    missing_outcome: ConclusionStatus
    severity: Severity
    source_ref: str

    @property
    def registry_id(self) -> str:
        return self.rule_id

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any],
        *,
        source_ref: str,
    ) -> "RuleSpec":
        left = value.get("left", {})
        outcomes = value.get("outcomes", {})
        requires = value.get("requires", {})
        if not isinstance(left, Mapping) or not isinstance(outcomes, Mapping):
            raise TypeError("Rule left and outcomes must be objects")
        if not isinstance(requires, Mapping):
            raise TypeError("Rule requires must be an object")
        right = value.get("right_parameter")
        return cls(
            str(value["rule_id"]),
            str(value["version"]),
            str(value.get("description", "")),
            str(left["kind"]),
            str(left["ref"]),
            str(value["op"]),
            None if right is None else str(right),
            tuple(sorted(set(str(item) for item in requires.get("properties", ())))),
            tuple(sorted(set(str(item) for item in requires.get("measurements", ())))),
            ConclusionStatus(str(outcomes.get("pass", "pass")).casefold()),
            ConclusionStatus(str(outcomes.get("fail", "fail")).casefold()),
            ConclusionStatus(
                str(outcomes.get("missing_input", "insufficient_information")).casefold()
            ),
            Severity(str(value.get("severity", "major")).casefold()),
            source_ref,
        )


@dataclass(frozen=True, slots=True)
class RuleEvaluation:
    rule_id: str
    rule_version: str
    subject_ref: str
    applicability_status: ApplicabilityStatus
    conclusion_status: ConclusionStatus
    predicate_result: bool | None
    left_value: Any | None
    right_value: Any | None
    missing: tuple[str, ...]
    evidence_refs: tuple[str, ...]
    assumptions: tuple[str, ...]

    @classmethod
    def missing_inputs(
        cls,
        *,
        rule: RuleSpec,
        subject_ref: str,
        missing: Iterable[str],
        evidence_refs: Iterable[str],
    ) -> "RuleEvaluation":
        return cls(
            rule.rule_id,
            rule.version,
            subject_ref,
            ApplicabilityStatus.UNDETERMINED,
            rule.missing_outcome,
            None,
            None,
            None,
            tuple(sorted(set(missing))),
            tuple(sorted(set(evidence_refs))),
            (),
        )
