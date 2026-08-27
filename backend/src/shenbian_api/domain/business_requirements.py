from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

GraphDimensions = Literal[2, 3]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RequirementOriginKind(StrEnum):
    CUSTOMER_STATED = "customer_stated"
    NORMALIZED = "normalized"
    DOMAIN_DECOMPOSITION = "domain_decomposition"


class RequirementRelationKind(StrEnum):
    CONTAINS = "contains_requirement"
    DECOMPOSES = "decomposes_to"
    REUSES = "reuses_requirement"


class NodePositionSource(StrEnum):
    GENERATED = "generated:initial-semantic-v1"
    STORED = "stored"


class ViewPositionSource(StrEnum):
    GENERATED = "generated:initial-semantic-v1"
    STORED = "stored"
    MIXED = "mixed"


class DatasetRecord(ContractModel):
    dataset_id: str
    schema_version: str
    imported_at: datetime
    content_sha256: str


class GraphViewRecord(ContractModel):
    graph_view_id: str
    name: str
    description: str
    layout_algorithm: str | None
    layout_version: str


class RequirementNodeSummary(ContractModel):
    direct_evidence_count: int = Field(ge=0)
    acceptance_criterion_count: int = Field(ge=0)
    open_question_count: int = Field(ge=0)
    scope_value_ids: list[str]


class StoredGraphPosition(ContractModel):
    x: float | None
    y: float | None
    z: float | None
    position_source: str
    locked: bool


class RequirementNodeRecord(ContractModel):
    requirement_id: str
    name: str
    description: str | None
    requirement_kind: str
    origin_kind: RequirementOriginKind
    atomic: bool
    verification_method: str | None
    priority_order: int | None
    source_emphasis: str | None
    customer_visible: bool
    needs_confirmation: bool
    lifecycle_status: str
    derived_min_depth: int = Field(ge=0)
    summary: RequirementNodeSummary
    stored_position: StoredGraphPosition


class BusinessRequirementGraphEdge(ContractModel):
    id: str
    source_node_id: str
    target_node_id: str
    relation_kind: RequirementRelationKind
    display_order: int
    rationale: str | None
    origin_kind: str


class BusinessRequirementsGraphSnapshot(ContractModel):
    dataset: DatasetRecord
    view: GraphViewRecord
    nodes: list[RequirementNodeRecord]
    edges: list[BusinessRequirementGraphEdge]


class GraphPosition(ContractModel):
    x: float
    y: float
    z: float
    radius: float = Field(ge=0)
    source: NodePositionSource
    locked: bool


class BusinessRequirementGraphNode(ContractModel):
    id: str
    node_kind: Literal["business_requirement"] = "business_requirement"
    label: str
    description: str | None
    requirement_kind: str
    origin_kind: RequirementOriginKind
    atomic: bool
    customer_visible: bool
    needs_confirmation: bool
    lifecycle_status: str
    priority_order: int | None
    derived_min_depth: int = Field(ge=0)
    source_proximity_rank: Literal[0, 1, 2, 3]
    position: GraphPosition
    summary: RequirementNodeSummary


class GraphDatasetMetadata(ContractModel):
    dataset_id: str
    schema_version: str
    imported_at: datetime
    content_sha256: str


class GraphViewMetadata(ContractModel):
    graph_view_id: str
    name: str
    description: str
    dimensions: GraphDimensions
    layout_version: str
    position_source: ViewPositionSource
    coordinate_system: Literal["cartesian"] = "cartesian"
    origin_meaning: str
    persisted: bool


class BusinessRequirementsGraphCounts(ContractModel):
    nodes: int = Field(ge=0)
    edges: int = Field(ge=0)
    atomic_requirements: int = Field(ge=0)
    level_one_requirements: int = Field(ge=0)
    needs_confirmation: int = Field(ge=0)


class BusinessRequirementsGraphResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    dataset: GraphDatasetMetadata
    view: GraphViewMetadata
    counts: BusinessRequirementsGraphCounts
    nodes: list[BusinessRequirementGraphNode]
    edges: list[BusinessRequirementGraphEdge]


class BusinessRequirementDetailNode(ContractModel):
    id: str
    node_kind: Literal["business_requirement"] = "business_requirement"
    label: str
    description: str | None
    requirement_kind: str
    origin_kind: RequirementOriginKind
    atomic: bool
    customer_visible: bool
    needs_confirmation: bool
    lifecycle_status: str
    priority_order: int | None
    derived_min_depth: int = Field(ge=0)
    source_proximity_rank: Literal[0, 1, 2, 3]
    summary: RequirementNodeSummary
    verification_method: str | None
    source_emphasis: str | None


class RequirementRelations(ContractModel):
    parents: list[BusinessRequirementGraphEdge]
    children: list[BusinessRequirementGraphEdge]


class RequirementAlias(ContractModel):
    requirement_alias_id: str
    alternate_name: str
    alias_kind: str
    note: str | None


class SourceDocumentSummary(ContractModel):
    source_document_id: str
    name: str
    source_kind: str
    authority_rank: int


class RequirementEvidence(ContractModel):
    requirement_source_link_id: str
    link_kind: str
    source_evidence_id: str
    evidence_kind: str
    locator: dict[str, Any]
    verbatim_text: str
    source_document: SourceDocumentSummary


class ScopeDimensionSummary(ContractModel):
    scope_dimension_id: str
    name: str


class ScopeValueSummary(ContractModel):
    scope_value_id: str
    name: str
    status: str


class RequirementScope(ContractModel):
    requirement_scope_link_id: str
    applicability: str
    inherit_to_descendants: bool
    dimension: ScopeDimensionSummary
    value: ScopeValueSummary


class AcceptanceCriterion(ContractModel):
    acceptance_criterion_id: str
    criterion_statement: str
    criterion_status: str
    threshold: Any | None
    measurement_method: str
    origin_kind: str


class OpenQuestion(ContractModel):
    open_question_id: str
    question: str
    blocking_kind: str
    status: str


class BusinessRequirementDetailData(ContractModel):
    dataset_id: str
    requirement: RequirementNodeRecord
    relations: RequirementRelations
    aliases: list[RequirementAlias]
    evidence: list[RequirementEvidence]
    scopes: list[RequirementScope]
    acceptance_criteria: list[AcceptanceCriterion]
    open_questions: list[OpenQuestion]


class BusinessRequirementDetailResponse(ContractModel):
    dataset_id: str
    requirement: BusinessRequirementDetailNode
    relations: RequirementRelations
    aliases: list[RequirementAlias]
    evidence: list[RequirementEvidence]
    scopes: list[RequirementScope]
    acceptance_criteria: list[AcceptanceCriterion]
    open_questions: list[OpenQuestion]


class BusinessRequirementsErrorDetail(ContractModel):
    code: str
    message: str


class BusinessRequirementsErrorResponse(ContractModel):
    detail: BusinessRequirementsErrorDetail
