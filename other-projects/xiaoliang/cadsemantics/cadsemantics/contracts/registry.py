from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Iterable, TypeVar


T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class FrozenRegistry(Generic[T]):
    registry_name: str
    entries: tuple[tuple[str, T], ...]

    @classmethod
    def create(
        cls,
        registry_name: str,
        entries: Iterable[tuple[str, T]],
    ) -> "FrozenRegistry[T]":
        indexed: dict[str, T] = {}
        for key, value in entries:
            if key in indexed:
                raise ValueError(f"Duplicate {registry_name} id: {key}")
            indexed[key] = value
        return cls(registry_name, tuple((key, indexed[key]) for key in sorted(indexed)))

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(key for key, _ in self.entries)

    def resolve(self, key: str) -> T:
        for entry_id, value in self.entries:
            if entry_id == key:
                return value
        raise KeyError(f"Unknown {self.registry_name} id: {key}")

    def contains(self, key: str) -> bool:
        return key in self.ids
