from __future__ import annotations

from typing import Any

from cadtasks.binding import ProjectFactBundle
from cadtasks.capabilities.registry import (
    CapabilityOutcome,
    CapabilityRegistry,
    CapabilitySpec,
)


def register_semantic_capabilities(registry: CapabilityRegistry) -> None:
    query_spec = CapabilitySpec(
        "semantic.query",
        "1.0.0",
        "project_facts+filters",
        "bound_representation_tuple",
        "read",
        "memory",
        "deterministic",
    )

    def query(facts: ProjectFactBundle, **filters: Any) -> CapabilityOutcome:
        values = facts.representations(**filters)
        refs = tuple(
            sorted(bound.representation.resolution_id for bound in values)
        )
        return CapabilityOutcome(
            query_spec.capability_id,
            query_spec.version,
            values,
            "success",
            "computed",
            "exact",
            refs,
            (),
            ("lookup in the Acquire-stage immutable semantic indexes",),
            (),
        )

    registry.register(query_spec, query)

