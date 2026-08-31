from __future__ import annotations

from typing import Protocol

from shenbian_api.domain.business_requirements import (
    BusinessRequirementDetailData,
    BusinessRequirementsGraphSnapshot,
)
from shenbian_api.domain.cad_capabilities import (
    CapabilityAtomDetailData,
    CapabilityAtomFilters,
    CapabilityAtomPageData,
    CapabilityFacetsData,
    CapabilityGraphAtomStreamData,
)
from shenbian_api.domain.catalog import DatasetCatalogEntry
from shenbian_api.domain.ontology import OntologyDefinition
from shenbian_api.domain.topology_semantics import (
    SemanticDescriptionCreateRequest,
    SemanticDescriptionDetailResponse,
    SemanticDescriptionListResponse,
    SemanticDescriptionWriteResponse,
    SemanticSearchResponse,
    TopologyMatchRequest,
    TopologyMatchResponse,
    TopologyObservationCreateRequest,
    TopologyObservationDetailResponse,
    TopologyObservationWriteResponse,
    TopologyPatternDetailResponse,
    TopologyPatternListResponse,
)


class OntologyReader(Protocol):
    def get(self) -> OntologyDefinition: ...


class DataCatalogReader(Protocol):
    def list_entries(self) -> list[DatasetCatalogEntry]: ...


class BusinessRequirementsReader(Protocol):
    async def get_graph(
        self,
        dataset_id: str,
        view_id: str,
    ) -> BusinessRequirementsGraphSnapshot: ...

    async def get_detail(
        self,
        dataset_id: str,
        requirement_id: str,
    ) -> BusinessRequirementDetailData: ...

    async def close(self) -> None: ...


class CadCapabilitiesReader(Protocol):
    async def list_atoms(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
        limit: int,
        offset: int,
    ) -> CapabilityAtomPageData: ...

    async def get_atom(self, dataset_id: str, atom_id: str) -> CapabilityAtomDetailData: ...

    async def get_facets(self, dataset_id: str) -> CapabilityFacetsData: ...

    async def prepare_graph_atom_stream(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
    ) -> CapabilityGraphAtomStreamData: ...

    async def close(self) -> None: ...


class TopologySemanticsRepository(Protocol):
    async def register_observation(
        self,
        request: TopologyObservationCreateRequest,
    ) -> TopologyObservationWriteResponse: ...

    async def append_description(
        self,
        request: SemanticDescriptionCreateRequest,
    ) -> SemanticDescriptionWriteResponse: ...

    async def match(self, request: TopologyMatchRequest) -> TopologyMatchResponse: ...

    async def list_descriptions(
        self,
        knowledge_scope: str,
        description_kind: str | None,
        limit: int,
        offset: int,
    ) -> SemanticDescriptionListResponse: ...

    async def description_detail(
        self,
        description_id: str,
    ) -> SemanticDescriptionDetailResponse: ...

    async def list_patterns(
        self,
        knowledge_scope: str,
        scope_kind: str | None,
        limit: int,
        offset: int,
    ) -> TopologyPatternListResponse: ...

    async def pattern_detail(self, pattern_id: str) -> TopologyPatternDetailResponse: ...

    async def observation_detail(
        self,
        observation_id: str,
    ) -> TopologyObservationDetailResponse: ...

    async def search_semantics(
        self,
        knowledge_scope: str,
        query: str,
        limit: int,
    ) -> SemanticSearchResponse: ...

    async def close(self) -> None: ...


class DependencyProbe(Protocol):
    @property
    def name(self) -> str: ...

    async def check(self) -> None: ...

    async def close(self) -> None: ...
