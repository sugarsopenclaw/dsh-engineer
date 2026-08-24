from __future__ import annotations

from typing import Any, Mapping

from cadtasks.rules.contracts import RuleSpec


def missing_requirements(
    rule: RuleSpec,
    *,
    properties: Mapping[str, Any],
    measurements: Mapping[str, Any],
) -> tuple[str, ...]:
    missing = {
        *(f"property:{name}" for name in rule.required_properties if name not in properties),
        *(
            f"measurement:{name}"
            for name in rule.required_measurements
            if name not in measurements
        ),
    }
    if rule.left_kind == "property" and rule.left_ref not in properties:
        missing.add(f"property:{rule.left_ref}")
    if rule.left_kind == "measurement" and rule.left_ref not in measurements:
        missing.add(f"measurement:{rule.left_ref}")
    return tuple(sorted(missing))

