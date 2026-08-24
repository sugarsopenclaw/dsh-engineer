from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Iterable, TypeVar

from cadkernel.contracts import stable_id

from cadsemantics.contracts import RepresentationMode
from cadsemantics.ontology.classes import BUILTIN_CLASS_IDS
from cadsemantics.ontology.definitions import (
    PropertyDefinition,
    RelationDefinition,
    RoleDefinition,
    SemanticClassDefinition,
    UnitDefinition,
)
from cadsemantics.ontology.properties import BUILTIN_PROPERTY_DEFINITIONS
from cadsemantics.ontology.relations import BUILTIN_RELATION_DEFINITIONS
from cadsemantics.ontology.roles import BUILTIN_ROLE_DEFINITIONS
from cadsemantics.ontology.units import BUILTIN_UNIT_DEFINITIONS


T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class _Registry(Generic[T]):
    kind: str
    entries: tuple[tuple[str, T], ...]

    @classmethod
    def from_entries(cls, kind: str, entries: Iterable[tuple[str, T]]):
        indexed: dict[str, T] = {}
        for key, value in entries:
            if key in indexed:
                raise ValueError(f"Duplicate {kind} id: {key}")
            indexed[key] = value
        return cls(kind, tuple((key, indexed[key]) for key in sorted(indexed)))

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(key for key, _ in self.entries)

    def require(self, key: str) -> T:
        for entry_id, value in self.entries:
            if entry_id == key:
                return value
        raise ValueError(f"Unregistered {self.kind}: {key}")

    def get(self, key: str) -> T | None:
        for entry_id, value in self.entries:
            if entry_id == key:
                return value
        return None


@dataclass(frozen=True, slots=True)
class ClassRegistry(_Registry[SemanticClassDefinition]):
    @classmethod
    def create(cls, definitions: Iterable[SemanticClassDefinition]) -> "ClassRegistry":
        base = _Registry.from_entries("semantic class", ((item.class_id, item) for item in definitions))
        return cls(base.kind, base.entries)


@dataclass(frozen=True, slots=True)
class PropertyRegistry(_Registry[PropertyDefinition]):
    @classmethod
    def create(cls, definitions: Iterable[PropertyDefinition]) -> "PropertyRegistry":
        base = _Registry.from_entries("property", ((item.property_id, item) for item in definitions))
        return cls(base.kind, base.entries)


@dataclass(frozen=True, slots=True)
class RelationRegistry(_Registry[RelationDefinition]):
    @classmethod
    def create(cls, definitions: Iterable[RelationDefinition]) -> "RelationRegistry":
        base = _Registry.from_entries("relation", ((item.relation_id, item) for item in definitions))
        return cls(base.kind, base.entries)


@dataclass(frozen=True, slots=True)
class RoleRegistry(_Registry[RoleDefinition]):
    @classmethod
    def create(cls, definitions: Iterable[RoleDefinition]) -> "RoleRegistry":
        base = _Registry.from_entries("functional role", ((item.role_id, item) for item in definitions))
        return cls(base.kind, base.entries)


@dataclass(frozen=True, slots=True)
class UnitRegistry(_Registry[UnitDefinition]):
    @classmethod
    def create(cls, definitions: Iterable[UnitDefinition]) -> "UnitRegistry":
        base = _Registry.from_entries("unit", ((item.unit_id, item) for item in definitions))
        return cls(base.kind, base.entries)

    def by_literal(self, literal: str) -> UnitDefinition | None:
        folded = literal.strip().casefold()
        for _, definition in self.entries:
            candidates = (definition.symbol, *definition.aliases)
            if folded in {item.casefold() for item in candidates}:
                return definition
        return None


@dataclass(frozen=True, slots=True)
class OntologyRegistry:
    classes: ClassRegistry
    properties: PropertyRegistry
    relations: RelationRegistry
    roles: RoleRegistry
    units: UnitRegistry
    ontology_version: str

    @classmethod
    def create(
        cls,
        *,
        classes: Iterable[SemanticClassDefinition],
        properties: Iterable[PropertyDefinition] = BUILTIN_PROPERTY_DEFINITIONS,
        relations: Iterable[RelationDefinition] = BUILTIN_RELATION_DEFINITIONS,
        roles: Iterable[RoleDefinition] = BUILTIN_ROLE_DEFINITIONS,
        units: Iterable[UnitDefinition] = BUILTIN_UNIT_DEFINITIONS,
    ) -> "OntologyRegistry":
        class_registry = ClassRegistry.create(classes)
        property_registry = PropertyRegistry.create(properties)
        relation_registry = RelationRegistry.create(relations)
        role_registry = RoleRegistry.create(roles)
        unit_registry = UnitRegistry.create(units)
        version = "ontology:" + stable_id(
            "semantic-ontology",
            class_registry.entries,
            property_registry.entries,
            relation_registry.entries,
            role_registry.entries,
            unit_registry.entries,
            length=64,
        )
        return cls(
            class_registry,
            property_registry,
            relation_registry,
            role_registry,
            unit_registry,
            version,
        )


def builtin_class_definitions(
    pack_by_class: dict[str, str] | None = None,
) -> tuple[SemanticClassDefinition, ...]:
    owners = pack_by_class or {}
    return tuple(
        SemanticClassDefinition(
            class_id=class_id,
            label=class_id.rsplit(".", 1)[-1],
            category="document_object" if class_id.startswith("documentation.") else "engineering_object",
            pack_id=owners.get(
                class_id,
                "documentation_layout" if class_id.startswith("documentation.") else "generic_engineering",
            ),
            allowed_representation_modes=tuple(RepresentationMode),
        )
        for class_id in BUILTIN_CLASS_IDS
    )


def builtin_ontology(pack_by_class: dict[str, str] | None = None) -> OntologyRegistry:
    return OntologyRegistry.create(classes=builtin_class_definitions(pack_by_class))


def validate_identity_axes(
    *,
    semantic_class_ids: Iterable[str],
    object_type_id: str | None,
    functional_roles: Iterable[str],
    lifecycle_state: str | None,
    project_phase: str | None,
    registry: OntologyRegistry,
) -> None:
    classes = tuple(sorted(set(semantic_class_ids)))
    roles = tuple(sorted(set(functional_roles)))
    for class_id in classes:
        registry.classes.require(class_id)
    for role_id in roles:
        registry.roles.require(role_id)
    values = set(classes) | set(roles)
    for value in (object_type_id, lifecycle_state, project_phase):
        if value is not None and value in values:
            raise ValueError("semantic class, object type, role, lifecycle state, and project phase must remain separate")

