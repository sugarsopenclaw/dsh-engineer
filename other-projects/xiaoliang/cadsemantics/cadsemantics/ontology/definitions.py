from __future__ import annotations

from dataclasses import dataclass

from cadsemantics.contracts import PropertyScope, RepresentationMode


@dataclass(frozen=True, slots=True)
class SemanticClassDefinition:
    class_id: str
    label: str
    category: str
    pack_id: str
    allowed_representation_modes: tuple[RepresentationMode, ...]


@dataclass(frozen=True, slots=True)
class PropertyDefinition:
    property_id: str
    value_type: str
    quantity_dimension: str | None
    canonical_unit: str | None
    cardinality: str
    applies_to: tuple[str, ...]
    allowed_scopes: tuple[PropertyScope, ...]
    inheritable_from_type: bool = False


@dataclass(frozen=True, slots=True)
class RelationDefinition:
    relation_id: str
    source_classes: tuple[str, ...] = ()
    target_classes: tuple[str, ...] = ()
    directional: bool = True


@dataclass(frozen=True, slots=True)
class RoleDefinition:
    role_id: str
    label: str
    applies_to: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class UnitDefinition:
    unit_id: str
    symbol: str
    quantity_dimension: str
    canonical_unit: str
    factor_to_canonical: float
    aliases: tuple[str, ...] = ()

