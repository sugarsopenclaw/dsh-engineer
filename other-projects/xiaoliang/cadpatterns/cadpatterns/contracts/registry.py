from __future__ import annotations

from collections.abc import Callable, Iterator
from threading import RLock
from typing import Any

from cadpatterns.contracts.models import DetectorSpec


class DetectorRegistry:
    """Thread-safe registry that rejects detector version replacement."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._entries: dict[str, tuple[DetectorSpec, Callable[..., Any]]] = {}

    def register(self, spec: DetectorSpec, function: Callable[..., Any]) -> None:
        with self._lock:
            existing = self._entries.get(spec.detector_id)
            if existing is not None and existing[0] != spec:
                raise ValueError(
                    f"Detector {spec.detector_id!r} is already registered as "
                    f"version {existing[0].version!r}"
                )
            self._entries[spec.detector_id] = (spec, function)

    def detector(
        self, spec: DetectorSpec
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(function: Callable[..., Any]) -> Callable[..., Any]:
            self.register(spec, function)
            return function

        return decorator

    def resolve(self, detector_id: str) -> tuple[DetectorSpec, Callable[..., Any]]:
        with self._lock:
            try:
                return self._entries[detector_id]
            except KeyError as error:
                raise KeyError(f"Unknown detector: {detector_id}") from error

    def specs(self) -> tuple[DetectorSpec, ...]:
        with self._lock:
            return tuple(self._entries[key][0] for key in sorted(self._entries))

    def __iter__(self) -> Iterator[DetectorSpec]:
        return iter(self.specs())


detector_registry = DetectorRegistry()
