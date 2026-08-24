from __future__ import annotations

from pathlib import Path

import yaml

from cadsemantics.contracts import PropertyScope, RepresentationMode
from cadsemantics.ontology.definitions import (
    PropertyDefinition,
    RelationDefinition,
    RoleDefinition,
    SemanticClassDefinition,
    UnitDefinition,
)
from cadsemantics.ontology.registry import OntologyRegistry


def load_ontology_spec(path: str | Path) -> OntologyRegistry:
    value = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError("Ontology spec must be a mapping")
    classes = tuple(
        SemanticClassDefinition(
            str(item["class_id"]),
            str(item.get("label", item["class_id"])),
            str(item.get("category", "object")),
            str(item["pack_id"]),
            tuple(RepresentationMode(mode) for mode in item.get("allowed_representation_modes", tuple(mode.value for mode in RepresentationMode))),
        )
        for item in value.get("classes", ())
    )
    properties = tuple(
        PropertyDefinition(
            str(item["property_id"]),
            str(item["value_type"]),
            None if item.get("quantity_dimension") is None else str(item["quantity_dimension"]),
            None if item.get("canonical_unit") is None else str(item["canonical_unit"]),
            str(item.get("cardinality", "0..1")),
            tuple(str(entry) for entry in item.get("applies_to", ())),
            tuple(PropertyScope(entry) for entry in item.get("allowed_scopes", (PropertyScope.REPRESENTATION.value,))),
            bool(item.get("inheritable_from_type", False)),
        )
        for item in value.get("properties", ())
    )
    relations = tuple(
        RelationDefinition(
            str(item["relation_id"]),
            tuple(str(entry) for entry in item.get("source_classes", ())),
            tuple(str(entry) for entry in item.get("target_classes", ())),
            bool(item.get("directional", True)),
        )
        for item in value.get("relations", ())
    )
    roles = tuple(
        RoleDefinition(
            str(item["role_id"]),
            str(item.get("label", item["role_id"])),
            tuple(str(entry) for entry in item.get("applies_to", ())),
        )
        for item in value.get("roles", ())
    )
    units = tuple(
        UnitDefinition(
            str(item["unit_id"]),
            str(item["symbol"]),
            str(item["quantity_dimension"]),
            str(item["canonical_unit"]),
            float(item["factor_to_canonical"]),
            tuple(str(entry) for entry in item.get("aliases", ())),
        )
        for item in value.get("units", ())
    )
    return OntologyRegistry.create(
        classes=classes,
        properties=properties,
        relations=relations,
        roles=roles,
        units=units,
    )

