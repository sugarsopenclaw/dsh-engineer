from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from threading import RLock
from typing import Any

from cadkernel.contracts import OpResult


@dataclass(frozen=True, slots=True)
class CapabilitySpec:
    capability_id: str
    version: str
    input_type: str
    output_type: str
    read_write: str
    resource_class: str
    determinism: str

    @property
    def registry_id(self) -> str:
        return self.capability_id


@dataclass(frozen=True, slots=True)
class CapabilityOutcome:
    capability_id: str
    capability_version: str
    value: Any
    status: str
    decision: str
    exactness: str
    evidence_refs: tuple[str, ...]
    assumptions: tuple[str, ...]
    derivation: tuple[str, ...]
    diagnostics: tuple[str, ...]


def outcome_from_op_result(
    capability_id: str,
    capability_version: str,
    result: OpResult[Any],
) -> CapabilityOutcome:
    refs = tuple(
        sorted(
            {
                evidence.occurrence_id or result.snapshot_id
                for evidence in result.evidence
            }
            or {result.snapshot_id}
        )
    )
    diagnostics = tuple(
        sorted(
            f"{item.code}:{item.severity.value}:{item.message}"
            for item in result.diagnostics
        )
    )
    return CapabilityOutcome(
        capability_id,
        capability_version,
        result.value,
        result.status.value,
        result.decision.value,
        result.exactness.value,
        refs,
        tuple(sorted(set(result.assumptions))),
        tuple(result.derivation),
        diagnostics,
    )


class CapabilityRegistry:
    """Explicit capability allowlist with version-replacement protection."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._entries: dict[
            str, tuple[CapabilitySpec, Callable[..., CapabilityOutcome]]
        ] = {}

    def register(
        self,
        spec: CapabilitySpec,
        function: Callable[..., CapabilityOutcome],
    ) -> None:
        with self._lock:
            current = self._entries.get(spec.capability_id)
            if current is not None and current[0] != spec:
                raise ValueError(
                    f"Capability {spec.capability_id!r} is already registered as "
                    f"version {current[0].version}"
                )
            self._entries[spec.capability_id] = (spec, function)

    def resolve(
        self,
        capability_id: str,
    ) -> tuple[CapabilitySpec, Callable[..., CapabilityOutcome]]:
        with self._lock:
            current = self._entries.get(capability_id)
            if current is None:
                raise ValueError(f"Capability is not allowed: {capability_id}")
            return current

    def invoke(self, capability_id: str, *args: Any, **kwargs: Any) -> CapabilityOutcome:
        spec, function = self.resolve(capability_id)
        outcome = function(*args, **kwargs)
        if outcome.capability_id != spec.capability_id:
            raise RuntimeError("Capability implementation returned another capability id")
        if outcome.capability_version != spec.version:
            raise RuntimeError("Capability implementation returned another capability version")
        return outcome

    def specs(self) -> tuple[CapabilitySpec, ...]:
        with self._lock:
            return tuple(self._entries[key][0] for key in sorted(self._entries))

    def versions(self) -> tuple[tuple[str, str], ...]:
        return tuple((spec.capability_id, spec.version) for spec in self.specs())

    def __contains__(self, capability_id: object) -> bool:
        with self._lock:
            return capability_id in self._entries

    def __iter__(self) -> Iterator[CapabilitySpec]:
        return iter(self.specs())

