from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, status

from shenbian_api.api.dependencies import TopologySemanticsServiceDep
from shenbian_api.application.topology_semantic_errors import (
    TopologySemanticConflictError,
    TopologySemanticNotFoundError,
    TopologySemanticsError,
    TopologySemanticsUnavailableError,
)
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
    TopologySemanticsErrorResponse,
)

router = APIRouter()

ERROR_RESPONSES = {
    status.HTTP_404_NOT_FOUND: {"model": TopologySemanticsErrorResponse},
    status.HTTP_409_CONFLICT: {"model": TopologySemanticsErrorResponse},
    status.HTTP_503_SERVICE_UNAVAILABLE: {"model": TopologySemanticsErrorResponse},
}


def _raise_http_error(error: TopologySemanticsError) -> None:
    if isinstance(error, TopologySemanticsUnavailableError):
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    elif isinstance(error, TopologySemanticConflictError):
        status_code = status.HTTP_409_CONFLICT
    elif isinstance(error, TopologySemanticNotFoundError):
        status_code = status.HTTP_404_NOT_FOUND
    else:
        status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    raise HTTPException(
        status_code=status_code,
        detail={"code": error.code, "message": error.safe_message},
    ) from None


@router.post(
    "/observations",
    response_model=TopologyObservationWriteResponse,
    responses=ERROR_RESPONSES,
)
async def register_topology_observation(
    request: TopologyObservationCreateRequest,
    service: TopologySemanticsServiceDep,
) -> TopologyObservationWriteResponse:
    try:
        return await service.register_observation(request)
    except TopologySemanticsError as error:
        _raise_http_error(error)


@router.post(
    "/descriptions",
    response_model=SemanticDescriptionWriteResponse,
    responses=ERROR_RESPONSES,
)
async def append_semantic_description(
    request: SemanticDescriptionCreateRequest,
    service: TopologySemanticsServiceDep,
) -> SemanticDescriptionWriteResponse:
    try:
        return await service.append_description(request)
    except TopologySemanticsError as error:
        _raise_http_error(error)


@router.post(
    "/match",
    response_model=TopologyMatchResponse,
    responses=ERROR_RESPONSES,
)
async def match_topology(
    request: TopologyMatchRequest,
    service: TopologySemanticsServiceDep,
) -> TopologyMatchResponse:
    try:
        return await service.match(request)
    except TopologySemanticsError as error:
        _raise_http_error(error)


@router.get(
    "/semantics",
    response_model=SemanticDescriptionListResponse,
    responses=ERROR_RESPONSES,
)
async def list_semantic_descriptions(
    service: TopologySemanticsServiceDep,
    knowledge_scope: Annotated[str, Query(min_length=1, max_length=200)] = (
        "shenbian-transformer"
    ),
    description_kind: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SemanticDescriptionListResponse:
    try:
        return await service.list_descriptions(
            knowledge_scope,
            description_kind,
            limit,
            offset,
        )
    except TopologySemanticsError as error:
        _raise_http_error(error)


@router.get(
    "/patterns",
    response_model=TopologyPatternListResponse,
    responses=ERROR_RESPONSES,
)
async def list_topology_patterns(
    service: TopologySemanticsServiceDep,
    knowledge_scope: Annotated[str, Query(min_length=1, max_length=200)] = (
        "shenbian-transformer"
    ),
    scope_kind: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TopologyPatternListResponse:
    try:
        return await service.list_patterns(knowledge_scope, scope_kind, limit, offset)
    except TopologySemanticsError as error:
        _raise_http_error(error)


@router.get(
    "/patterns/{pattern_id}",
    response_model=TopologyPatternDetailResponse,
    responses=ERROR_RESPONSES,
)
async def topology_pattern_detail(
    service: TopologySemanticsServiceDep,
    pattern_id: Annotated[str, Path(min_length=1, max_length=100)],
) -> TopologyPatternDetailResponse:
    try:
        return await service.pattern_detail(pattern_id)
    except TopologySemanticsError as error:
        _raise_http_error(error)


@router.get(
    "/observations/{observation_id}",
    response_model=TopologyObservationDetailResponse,
    responses=ERROR_RESPONSES,
)
async def topology_observation_detail(
    service: TopologySemanticsServiceDep,
    observation_id: Annotated[str, Path(min_length=1, max_length=100)],
) -> TopologyObservationDetailResponse:
    try:
        return await service.observation_detail(observation_id)
    except TopologySemanticsError as error:
        _raise_http_error(error)


@router.get(
    "/semantics/search",
    response_model=SemanticSearchResponse,
    responses=ERROR_RESPONSES,
)
async def search_topology_semantics(
    service: TopologySemanticsServiceDep,
    query: Annotated[str, Query(min_length=1, max_length=1000)],
    knowledge_scope: Annotated[str, Query(min_length=1, max_length=200)] = (
        "shenbian-transformer"
    ),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> SemanticSearchResponse:
    try:
        return await service.search_semantics(knowledge_scope, query, limit)
    except TopologySemanticsError as error:
        _raise_http_error(error)


@router.get(
    "/semantics/{description_id}",
    response_model=SemanticDescriptionDetailResponse,
    responses=ERROR_RESPONSES,
)
async def semantic_description_detail(
    service: TopologySemanticsServiceDep,
    description_id: Annotated[str, Path(min_length=1, max_length=100)],
) -> SemanticDescriptionDetailResponse:
    try:
        return await service.description_detail(description_id)
    except TopologySemanticsError as error:
        _raise_http_error(error)
