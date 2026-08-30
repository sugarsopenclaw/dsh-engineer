from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def capability_graph_scope_key(
    surface: str | None,
    observed_host_id: str | None,
) -> str:
    return f"surface={surface or '*'}|host={observed_host_id or '*'}"


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CapabilityDatasetMetadata(ContractModel):
    dataset_id: str
    schema_version: str
    imported_at: datetime
    content_sha256: str


class CapabilitySourceArtifact(ContractModel):
    artifact_id: str
    kind: str
    name: str
    version: str | None
    sha256: str | None


class CapabilityDeclaringSymbol(ContractModel):
    symbol_id: str
    full_name: str
    kind: str


class CapabilityParameter(ContractModel):
    position: int = Field(ge=0)
    name: str
    type: str
    direction: str
    optional: bool
    default_value: Any | None = None


class CapabilityMember(ContractModel):
    name: str
    signature: str
    return_type: str | None
    parameters: list[CapabilityParameter]
    is_static: bool


class CapabilityProvenance(ContractModel):
    extractor: str
    extractor_version: str
    source_locator: dict[str, Any]


class CapabilitySemanticCandidate(ContractModel):
    semantic_capability_id: str
    label: str
    confidence: float = Field(ge=0, le=1)
    status: str
    basis: str


class CapabilityEvidence(ContractModel):
    kind: str
    ref: str
    claim: str


class CapabilityProcessor(ContractModel):
    kind: str
    name: str
    run_id: str


class CapabilityAtomListItem(ContractModel):
    atom_id: str
    inventory_id: str
    surface: str
    atom_kind: str
    observed_host_ids: list[str]
    declaring_symbol_full_name: str | None
    member_name: str
    member_signature: str
    return_type: str | None
    is_static: bool
    classification_status: str
    operation_kinds: list[str]
    domain_tags: list[str]
    summary: str | None
    classification_confidence: float | None


class CapabilityGraphAtom(ContractModel):
    """graph-atoms 批量流的最小投影：签名、参数、证据仍走 /atoms/{atom_id} 详情。"""

    atom_id: str
    surface: str
    atom_kind: str
    observed_host_ids: list[str]
    member_name: str
    declaring_symbol_full_name: str | None
    classification_status: str
    operation_kinds: list[str]
    domain_tags: list[str]


class CapabilityAtomDetail(CapabilityAtomListItem):
    schema_version: str
    canonical_key: str
    source_artifact: CapabilitySourceArtifact
    declaring_symbol: CapabilityDeclaringSymbol | None
    member: CapabilityMember
    provenance: CapabilityProvenance
    surface_metadata: dict[str, Any]
    semantic_candidates: list[CapabilitySemanticCandidate]
    evidence: list[CapabilityEvidence]
    processor: CapabilityProcessor | None
    processed_at: datetime | None
    notes: str | None


class CapabilityAtomFilters(ContractModel):
    surface: str | None = None
    observed_host_id: str | None = None
    atom_kind: str | None = None
    classification_status: str | None = None
    operation_kind: str | None = None
    domain_tag: str | None = None
    query: str | None = None


class CapabilityAtomPageData(ContractModel):
    dataset: CapabilityDatasetMetadata
    total: int = Field(ge=0)
    items: list[CapabilityAtomListItem]


class CapabilityGraphAtomStreamData(ContractModel):
    """一次 graph-atoms 批量流：元数据先行（响应头需要），行数据异步迭代。"""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    dataset: CapabilityDatasetMetadata
    total: int = Field(ge=0)
    stream: AsyncIterator[CapabilityGraphAtom]


class CapabilityAtomListResponse(CapabilityAtomPageData):
    schema_version: Literal["1.0"] = "1.0"
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)


class CapabilityAtomDetailData(ContractModel):
    dataset_id: str
    atom: CapabilityAtomDetail


class CapabilityAtomDetailResponse(CapabilityAtomDetailData):
    schema_version: Literal["1.0"] = "1.0"


class CapabilityFacetValue(ContractModel):
    value: str
    count: int = Field(ge=0)


class CapabilityFacetsData(ContractModel):
    dataset_id: str
    total_atoms: int = Field(ge=0)
    surfaces: list[CapabilityFacetValue]
    observed_host_ids: list[CapabilityFacetValue]
    atom_kinds: list[CapabilityFacetValue]
    classification_statuses: list[CapabilityFacetValue]
    operation_kinds: list[CapabilityFacetValue]
    domain_tags: list[CapabilityFacetValue]


class CapabilityFacetsResponse(CapabilityFacetsData):
    schema_version: Literal["1.0"] = "1.0"


class CadCapabilitiesErrorDetail(ContractModel):
    code: str
    message: str


class CadCapabilitiesErrorResponse(ContractModel):
    detail: CadCapabilitiesErrorDetail
