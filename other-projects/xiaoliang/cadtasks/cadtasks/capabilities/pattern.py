from __future__ import annotations

from cadtasks.binding import ProjectFactBundle
from cadtasks.capabilities.registry import (
    CapabilityOutcome,
    CapabilityRegistry,
    CapabilitySpec,
)


def register_pattern_capabilities(registry: CapabilityRegistry) -> None:
    spec = CapabilitySpec(
        "pattern.signature.lookup",
        "1.0.0",
        "project_facts+signature",
        "bound_pattern_tuple",
        "read",
        "memory",
        "deterministic",
    )

    def lookup(facts: ProjectFactBundle, signature: str) -> CapabilityOutcome:
        values = facts.signature_index.get(str(signature), ())
        refs = tuple(
            sorted(
                {
                    reference
                    for bound in values
                    for reference in (
                        bound.instance.detection_id,
                        bound.instance.pattern_key,
                    )
                }
            )
        )
        return CapabilityOutcome(
            spec.capability_id,
            spec.version,
            values,
            "success",
            "computed",
            "exact",
            refs,
            (),
            ("lookup in the Acquire-stage immutable geometry-signature index",),
            (),
        )

    registry.register(spec, lookup)

