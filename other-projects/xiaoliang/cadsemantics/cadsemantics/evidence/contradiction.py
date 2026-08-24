from __future__ import annotations

from collections import defaultdict

from cadkernel.contracts import stable_json_dumps

from cadsemantics.contracts import PropertyAssertion


def retain_property_conflicts(
    assertions: tuple[PropertyAssertion, ...],
) -> tuple[PropertyAssertion, ...]:
    grouped: dict[tuple[str, str, str], list[PropertyAssertion]] = defaultdict(list)
    for assertion in assertions:
        grouped[
            (
                assertion.subject_id,
                assertion.property_id,
                assertion.applies_to_scope.value,
            )
        ].append(assertion)
    result = []
    for key in sorted(grouped):
        values = grouped[key]
        distinct = {
            (
                "normalized",
                stable_json_dumps(item.normalized_value),
                item.normalized_unit,
            )
            if item.normalized_value is not None
            else ("literal", item.original_literal, item.normalized_unit)
            for item in values
        }
        result.extend(
            item.conflicted() if len(distinct) > 1 else item
            for item in values
        )
    return tuple(sorted(result, key=lambda item: item.assertion_id))
