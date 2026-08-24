from cadsemantics.ontology.classes import (
    BUILTIN_CLASS_IDS,
    DOCUMENTATION_CLASSES,
    GENERIC_ENGINEERING_CLASSES,
)
from cadsemantics.ontology.definitions import (
    PropertyDefinition,
    RelationDefinition,
    RoleDefinition,
    SemanticClassDefinition,
    UnitDefinition,
)
from cadsemantics.ontology.registry import (
    ClassRegistry,
    OntologyRegistry,
    PropertyRegistry,
    RelationRegistry,
    RoleRegistry,
    UnitRegistry,
    builtin_class_definitions,
    builtin_ontology,
    validate_identity_axes,
)
from cadsemantics.ontology.spec_loader import load_ontology_spec

__all__ = [
    "BUILTIN_CLASS_IDS",
    "DOCUMENTATION_CLASSES",
    "GENERIC_ENGINEERING_CLASSES",
    "ClassRegistry",
    "OntologyRegistry",
    "PropertyDefinition",
    "PropertyRegistry",
    "RelationDefinition",
    "RelationRegistry",
    "RoleDefinition",
    "RoleRegistry",
    "SemanticClassDefinition",
    "UnitDefinition",
    "UnitRegistry",
    "builtin_class_definitions",
    "builtin_ontology",
    "load_ontology_spec",
    "validate_identity_axes",
]
