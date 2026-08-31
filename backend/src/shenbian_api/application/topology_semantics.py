from __future__ import annotations

from shenbian_api.application.ports import TopologySemanticsRepository
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


class TopologySemanticsService:
    def __init__(self, repository: TopologySemanticsRepository) -> None:
        self._repository = repository

    async def register_observation(
        self,
        request: TopologyObservationCreateRequest,
    ) -> TopologyObservationWriteResponse:
        return await self._repository.register_observation(request)

    async def append_description(
        self,
        request: SemanticDescriptionCreateRequest,
    ) -> SemanticDescriptionWriteResponse:
        return await self._repository.append_description(request)

    async def match(self, request: TopologyMatchRequest) -> TopologyMatchResponse:
        return await self._repository.match(request)

    async def list_descriptions(
        self,
        knowledge_scope: str,
        description_kind: str | None,
        limit: int,
        offset: int,
    ) -> SemanticDescriptionListResponse:
        return await self._repository.list_descriptions(
            knowledge_scope,
            description_kind,
            limit,
            offset,
        )

    async def description_detail(
        self,
        description_id: str,
    ) -> SemanticDescriptionDetailResponse:
        return await self._repository.description_detail(description_id)

    async def list_patterns(
        self,
        knowledge_scope: str,
        scope_kind: str | None,
        limit: int,
        offset: int,
    ) -> TopologyPatternListResponse:
        return await self._repository.list_patterns(
            knowledge_scope,
            scope_kind,
            limit,
            offset,
        )

    async def pattern_detail(self, pattern_id: str) -> TopologyPatternDetailResponse:
        return await self._repository.pattern_detail(pattern_id)

    async def observation_detail(
        self,
        observation_id: str,
    ) -> TopologyObservationDetailResponse:
        return await self._repository.observation_detail(observation_id)

    async def search_semantics(
        self,
        knowledge_scope: str,
        query: str,
        limit: int,
    ) -> SemanticSearchResponse:
        return await self._repository.search_semantics(knowledge_scope, query, limit)

    async def close(self) -> None:
        await self._repository.close()
