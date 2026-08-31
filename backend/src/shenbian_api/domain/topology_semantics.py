from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SHA256_PATTERN = r"^[0-9a-f]{64}$"


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TopologyFingerprint(ContractModel):
    fingerprint_schema_version: str = Field(min_length=1, max_length=80)
    scope_kind: str = Field(min_length=1, max_length=80)
    graph_hash: str = Field(pattern=SHA256_PATTERN)
    shape_hash: str = Field(pattern=SHA256_PATTERN)
    metric_hash: str = Field(pattern=SHA256_PATTERN)
    invariances: list[str] = Field(default_factory=list, max_length=20)
    feature_summary: dict[str, Any] = Field(default_factory=dict)
    canonical_payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("invariances")
    @classmethod
    def unique_invariances(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("invariances must be unique")
        return value


class DrawingContext(ContractModel):
    document_name: str = Field(min_length=1, max_length=500)
    document_ref: str | None = Field(default=None, max_length=2000)
    analysis_id: str = Field(min_length=1, max_length=300)
    dbmod: int = Field(ge=0)
    source_status: str = Field(min_length=1, max_length=100)


class EvidenceAsset(ContractModel):
    role: str = Field(min_length=1, max_length=120)
    artifact_ref: str = Field(min_length=1, max_length=4000)
    media_type: str | None = Field(default=None, max_length=200)
    sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)
    bytes: int | None = Field(default=None, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ModelProvenance(ContractModel):
    model: str | None = Field(default=None, max_length=300)
    role: str | None = Field(default=None, max_length=120)
    thinking_level: str | None = Field(default=None, max_length=80)
    prompt_ref: str | None = Field(default=None, max_length=4000)
    session_ref: str | None = Field(default=None, max_length=4000)
    raw_output_ref: str | None = Field(default=None, max_length=4000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TopologyObservationCreateRequest(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    knowledge_scope: str = Field(default="shenbian-transformer", min_length=1, max_length=200)
    ingestion_key: str = Field(min_length=1, max_length=500)
    workflow_kind: str = Field(min_length=1, max_length=100)
    review_run_id: str = Field(min_length=1, max_length=300)
    group_id: str = Field(min_length=1, max_length=300)
    drawing: DrawingContext
    topology: TopologyFingerprint
    selection: dict[str, Any]
    plots: list[EvidenceAsset] = Field(default_factory=list, max_length=20)
    bom_context: dict[str, Any] = Field(default_factory=dict)
    capability_evidence: dict[str, Any] = Field(default_factory=dict)
    artifact_refs: list[str] = Field(default_factory=list, max_length=500)
    provenance: dict[str, Any] = Field(default_factory=dict)


class TopologyPatternRecord(ContractModel):
    pattern_id: str
    knowledge_scope: str
    fingerprint: TopologyFingerprint
    observation_count: int = Field(ge=0)
    created_at: datetime
    last_observed_at: datetime


class TopologyObservationRecord(ContractModel):
    observation_id: str
    pattern_id: str
    knowledge_scope: str
    ingestion_key: str
    workflow_kind: str
    review_run_id: str
    group_id: str
    drawing: DrawingContext
    selection: dict[str, Any]
    plots: list[EvidenceAsset]
    bom_context: dict[str, Any]
    capability_evidence: dict[str, Any]
    artifact_refs: list[str]
    provenance: dict[str, Any]
    payload_sha256: str = Field(pattern=SHA256_PATTERN)
    created_at: datetime


class TopologyObservationWriteResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    created: bool
    pattern_created: bool
    pattern: TopologyPatternRecord
    observation: TopologyObservationRecord


class SemanticDescriptionCreateRequest(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    knowledge_scope: str = Field(default="shenbian-transformer", min_length=1, max_length=200)
    description_key: str = Field(min_length=1, max_length=500)
    description_kind: str = Field(min_length=1, max_length=100)
    content_md: str = Field(min_length=1, max_length=500_000)
    structured_content: dict[str, Any] = Field(default_factory=dict)
    source_kind: str = Field(min_length=1, max_length=100)
    model_provenance: ModelProvenance | None = None
    evidence_refs: list[str] = Field(default_factory=list, max_length=500)
    observation_keys: list[str] = Field(min_length=1, max_length=500)
    relation_kind: str = Field(default="describes", min_length=1, max_length=100)
    link_context: dict[str, Any] = Field(default_factory=dict)
    supersedes_description_id: str | None = Field(default=None, max_length=100)

    @field_validator("observation_keys")
    @classmethod
    def unique_observation_keys(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("observation_keys must be unique")
        return value


class SemanticDescriptionRecord(ContractModel):
    description_id: str
    knowledge_scope: str
    description_key: str
    description_kind: str
    content_md: str
    structured_content: dict[str, Any]
    source_kind: str
    model_provenance: ModelProvenance | None
    evidence_refs: list[str]
    supersedes_description_id: str | None
    content_sha256: str = Field(pattern=SHA256_PATTERN)
    created_at: datetime


class TopologySemanticLinkRecord(ContractModel):
    link_id: str
    pattern_id: str
    observation_id: str
    description_id: str
    relation_kind: str
    link_context: dict[str, Any]
    created_at: datetime


class SemanticDescriptionWriteResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    created: bool
    description: SemanticDescriptionRecord
    links: list[TopologySemanticLinkRecord]


class SemanticDescriptionListResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
    items: list[SemanticDescriptionRecord]


class SemanticDescriptionDetailResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    description: SemanticDescriptionRecord
    patterns: list[TopologyPatternRecord]
    links: list[TopologySemanticLinkRecord]


class TopologyPatternDetail(ContractModel):
    pattern: TopologyPatternRecord
    observations: list[TopologyObservationRecord]
    descriptions: list[SemanticDescriptionRecord]
    links: list[TopologySemanticLinkRecord]


class TopologyPatternDetailResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    detail: TopologyPatternDetail


class TopologyPatternListResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
    items: list[TopologyPatternRecord]


class TopologyObservationDetailResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    observation: TopologyObservationRecord
    descriptions: list[SemanticDescriptionRecord]


class TopologyMatchRequest(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    knowledge_scope: str = Field(default="shenbian-transformer", min_length=1, max_length=200)
    fingerprint: TopologyFingerprint
    limit: int = Field(default=20, ge=1, le=200)


class TopologyMatchItem(ContractModel):
    match_kinds: list[Literal["metric_hash", "shape_hash", "graph_hash"]]
    detail: TopologyPatternDetail


class TopologyMatchResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    items: list[TopologyMatchItem]


class SemanticSearchItem(ContractModel):
    description: SemanticDescriptionRecord
    patterns: list[TopologyPatternRecord]


class SemanticSearchResponse(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    query: str
    total: int = Field(ge=0)
    items: list[SemanticSearchItem]


class TopologySemanticsErrorDetail(ContractModel):
    code: str
    message: str


class TopologySemanticsErrorResponse(ContractModel):
    detail: TopologySemanticsErrorDetail
