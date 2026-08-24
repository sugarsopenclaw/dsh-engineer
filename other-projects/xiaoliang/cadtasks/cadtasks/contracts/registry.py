from __future__ import annotations

from collections.abc import Iterator
from threading import RLock
from typing import Generic, Protocol, TypeVar


class Versioned(Protocol):
    @property
    def registry_id(self) -> str: ...

    @property
    def version(self) -> str: ...


T = TypeVar("T", bound=Versioned)


class VersionedRegistry(Generic[T]):
    """Thread-safe registry that never silently replaces a versioned contract."""

    def __init__(self, *, kind: str) -> None:
        self._kind = kind
        self._entries: dict[str, T] = {}
        self._lock = RLock()

    def register(self, value: T) -> None:
        key = value.registry_id
        with self._lock:
            current = self._entries.get(key)
            if current is not None and current != value:
                raise ValueError(
                    f"{self._kind} {key!r} is already registered as version "
                    f"{current.version}"
                )
            self._entries[key] = value

    def require(self, key: str) -> T:
        with self._lock:
            try:
                return self._entries[key]
            except KeyError as error:
                raise KeyError(f"Unknown {self._kind}: {key}") from error

    def values(self) -> tuple[T, ...]:
        with self._lock:
            return tuple(self._entries[key] for key in sorted(self._entries))

    def __contains__(self, key: object) -> bool:
        with self._lock:
            return key in self._entries

    def __iter__(self) -> Iterator[T]:
        return iter(self.values())

