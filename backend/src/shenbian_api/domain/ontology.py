from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ActionRisk(StrEnum):
    READ_ONLY = "read_only"
    REVERSIBLE_WRITE = "reversible_write"
    EXTERNAL_SIDE_EFFECT = "external_side_effect"


class ObjectTypeDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    display_name: str
    identity_property: str
    properties: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def identity_must_be_a_property(self) -> ObjectTypeDefinition:
        if self.identity_property not in self.properties:
            raise ValueError(f"identity_property_not_declared:{self.id}")
        return self


class LinkTypeDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    from_type: str = Field(alias="from")
    to_type: str = Field(alias="to")


class ActionTypeDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    display_name: str
    risk: ActionRisk
    requires_approval: bool
    input_types: list[str] = Field(min_length=1)
    output_types: list[str] = Field(min_length=1)


class OntologyDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str
    namespace: str
    display_name: str
    description: str
    object_types: list[ObjectTypeDefinition] = Field(min_length=1)
    link_types: list[LinkTypeDefinition]
    action_types: list[ActionTypeDefinition]

    @model_validator(mode="after")
    def validate_references_and_unique_ids(self) -> OntologyDefinition:
        object_ids = [item.id for item in self.object_types]
        link_ids = [item.id for item in self.link_types]
        action_ids = [item.id for item in self.action_types]

        for kind, identifiers in (
            ("object", object_ids),
            ("link", link_ids),
            ("action", action_ids),
        ):
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"duplicate_{kind}_type_id")

        known_objects = set(object_ids)
        for link in self.link_types:
            if link.from_type not in known_objects or link.to_type not in known_objects:
                raise ValueError(f"unknown_link_object_type:{link.id}")
        for action in self.action_types:
            referenced = set(action.input_types) | set(action.output_types)
            if not referenced.issubset(known_objects):
                raise ValueError(f"unknown_action_object_type:{action.id}")
        return self


class OntologySummary(BaseModel):
    schema_version: str
    namespace: str
    display_name: str
    description: str
    object_type_count: int
    link_type_count: int
    action_type_count: int
    object_type_ids: list[str]
    link_type_ids: list[str]
    action_type_ids: list[str]
