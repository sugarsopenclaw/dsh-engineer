from __future__ import annotations

from collections.abc import Callable, Iterator
from threading import RLock
from typing import Any

from cadkernel.contracts.models import OperatorSpec


class OperatorRegistry:
    """Thread-safe registry that rejects silent operator-version replacement."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._entries: dict[str, tuple[OperatorSpec, Callable[..., Any]]] = {}

    def register(self, spec: OperatorSpec, function: Callable[..., Any]) -> None:
        key = spec.operator_id
        with self._lock:
            existing = self._entries.get(key)
            if existing is not None and existing[0] != spec:
                raise ValueError(
                    f"Operator {key!r} is already registered as version {existing[0].version}"
                )
            self._entries[key] = (spec, function)

    def operator(self, spec: OperatorSpec) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(function: Callable[..., Any]) -> Callable[..., Any]:
            self.register(spec, function)
            return function

        return decorator

    def resolve(self, operator_id: str) -> tuple[OperatorSpec, Callable[..., Any]]:
        with self._lock:
            try:
                return self._entries[operator_id]
            except KeyError as error:
                raise KeyError(f"Unknown operator: {operator_id}") from error

    def specs(self) -> tuple[OperatorSpec, ...]:
        with self._lock:
            return tuple(self._entries[key][0] for key in sorted(self._entries))

    def __iter__(self) -> Iterator[OperatorSpec]:
        return iter(self.specs())


operator_registry = OperatorRegistry()

