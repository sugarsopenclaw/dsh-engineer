from __future__ import annotations

from importlib import resources
from threading import RLock
from typing import Any, Iterable, Mapping

import yaml

from cadtasks.contracts import ApplicabilityStatus
from cadtasks.rules.applicability import missing_requirements
from cadtasks.rules.contracts import RuleEvaluation, RuleSpec
from cadtasks.rules.predicates import PREDICATE_WHITELIST, evaluate_predicate


class RuleRegistry:
    def __init__(self) -> None:
        self._lock = RLock()
        self._entries: dict[str, RuleSpec] = {}

    def register(self, rule: RuleSpec) -> None:
        if rule.op not in PREDICATE_WHITELIST:
            raise ValueError(f"Rule predicate is not allowed: {rule.op}")
        if rule.left_kind not in {"measurement", "property", "values"}:
            raise ValueError(f"Rule left kind is not allowed: {rule.left_kind}")
        with self._lock:
            current = self._entries.get(rule.rule_id)
            if current is not None and current != rule:
                raise ValueError(
                    f"Rule {rule.rule_id!r} is already registered as version "
                    f"{current.version}"
                )
            self._entries[rule.rule_id] = rule

    def require(self, rule_id: str) -> RuleSpec:
        with self._lock:
            try:
                return self._entries[rule_id]
            except KeyError as error:
                raise KeyError(f"Unknown rule: {rule_id}") from error

    def rules(self) -> tuple[RuleSpec, ...]:
        with self._lock:
            return tuple(self._entries[key] for key in sorted(self._entries))

    def versions(self) -> tuple[tuple[str, str], ...]:
        return tuple((rule.rule_id, rule.version) for rule in self.rules())

    def evaluate(
        self,
        rule_id: str,
        *,
        subject_ref: str,
        properties: Mapping[str, Any] | None = None,
        measurements: Mapping[str, Any] | None = None,
        values: Mapping[str, Any] | None = None,
        parameters: Mapping[str, Any] | None = None,
        evidence_refs: Iterable[str] = (),
    ) -> RuleEvaluation:
        rule = self.require(rule_id)
        property_values = properties or {}
        measurement_values = measurements or {}
        named_values = values or {}
        parameter_values = parameters or {}
        missing = list(
            missing_requirements(
                rule,
                properties=property_values,
                measurements=measurement_values,
            )
        )
        if rule.right_parameter is not None and rule.right_parameter not in parameter_values:
            missing.append(f"parameter:{rule.right_parameter}")
        if rule.left_kind == "values" and rule.left_ref not in named_values:
            missing.append(f"values:{rule.left_ref}")
        if missing:
            return RuleEvaluation.missing_inputs(
                rule=rule,
                subject_ref=subject_ref,
                missing=missing,
                evidence_refs=evidence_refs,
            )
        sources = {
            "measurement": measurement_values,
            "property": property_values,
            "values": named_values,
        }
        left = sources[rule.left_kind][rule.left_ref]
        right = (
            None
            if rule.right_parameter is None
            else parameter_values[rule.right_parameter]
        )
        try:
            result = evaluate_predicate(rule.op, left, right)
        except (TypeError, ValueError):
            malformed = (
                f"parameter:{rule.right_parameter}"
                if rule.right_parameter is not None
                else f"{rule.left_kind}:{rule.left_ref}"
            )
            return RuleEvaluation(
                rule.rule_id,
                rule.version,
                subject_ref,
                ApplicabilityStatus.UNDETERMINED,
                rule.missing_outcome,
                None,
                left,
                right,
                (malformed,),
                tuple(sorted(set(evidence_refs))),
                ("the declared input shape does not satisfy the predicate contract",),
            )
        return RuleEvaluation(
            rule.rule_id,
            rule.version,
            subject_ref,
            ApplicabilityStatus.APPLICABLE,
            rule.pass_outcome if result else rule.fail_outcome,
            result,
            left,
            right,
            (),
            tuple(sorted(set(evidence_refs))),
            (),
        )


def rule_specs_from_mapping(
    value: Mapping[str, Any],
    *,
    source_ref: str,
) -> tuple[RuleSpec, ...]:
    raw = value.get("rules", ())
    if not isinstance(raw, (list, tuple)):
        raise TypeError("Rule document rules must be an array")
    return tuple(
        RuleSpec.from_mapping(item, source_ref=source_ref)
        for item in raw
        if isinstance(item, Mapping)
    )


def load_builtin_rules() -> tuple[RuleSpec, ...]:
    package = resources.files("cadtasks.rules")
    rules = []
    for item in sorted(package.iterdir(), key=lambda path: path.name):
        if not item.name.endswith(".yaml"):
            continue
        value = yaml.safe_load(item.read_text(encoding="utf-8"))
        if not isinstance(value, Mapping):
            raise TypeError(f"Rule document root must be an object: {item.name}")
        rules.extend(
            rule_specs_from_mapping(
                value,
                source_ref=f"package:cadtasks.rules/{item.name}",
            )
        )
    declared_ops = {rule.op for rule in rules}
    implemented_ops = set(PREDICATE_WHITELIST)
    unknown = declared_ops - implemented_ops
    undeclared = implemented_ops - declared_ops
    if unknown:
        raise ValueError("Rules declare predicates without implementations: " + ", ".join(sorted(unknown)))
    if undeclared:
        raise ValueError("Predicate implementations lack a built-in declaration: " + ", ".join(sorted(undeclared)))
    return tuple(sorted(rules, key=lambda item: item.rule_id))


def create_builtin_rule_registry() -> RuleRegistry:
    registry = RuleRegistry()
    for rule in load_builtin_rules():
        registry.register(rule)
    return registry
