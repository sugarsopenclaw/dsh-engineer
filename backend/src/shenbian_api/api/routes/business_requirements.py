from __future__ import annotations

from typing import Annotated, Literal, cast

from fastapi import APIRouter, HTTPException, Path, Query, status

from shenbian_api.api.dependencies import BusinessRequirementsServiceDep
from shenbian_api.application.business_requirement_errors import (
    BusinessRequirementsQueryError,
    BusinessRequirementsUnavailableError,
)
from shenbian_api.application.business_requirements import (
    DEFAULT_BUSINESS_REQUIREMENTS_DATASET_ID,
    DEFAULT_BUSINESS_REQUIREMENTS_VIEW_ID,
    INITIAL_LAYOUT_VERSION,
)
from shenbian_api.domain.business_requirements import (
    BusinessRequirementDetailResponse,
    BusinessRequirementsErrorResponse,
    BusinessRequirementsGraphResponse,
    GraphDimensions,
)

router = APIRouter()

ERROR_RESPONSES = {
    status.HTTP_404_NOT_FOUND: {"model": BusinessRequirementsErrorResponse},
    status.HTTP_503_SERVICE_UNAVAILABLE: {"model": BusinessRequirementsErrorResponse},
}


def _raise_http_error(error: BusinessRequirementsQueryError) -> None:
    status_code = (
        status.HTTP_503_SERVICE_UNAVAILABLE
        if isinstance(error, BusinessRequirementsUnavailableError)
        else status.HTTP_404_NOT_FOUND
    )
    raise HTTPException(
        status_code=status_code,
        detail={"code": error.code, "message": error.safe_message},
    ) from None


@router.get(
    "/graph",
    response_model=BusinessRequirementsGraphResponse,
    responses=ERROR_RESPONSES,
)
async def business_requirements_graph(
    service: BusinessRequirementsServiceDep,
    dataset_id: Annotated[str, Query(min_length=1, max_length=200)] = (
        DEFAULT_BUSINESS_REQUIREMENTS_DATASET_ID
    ),
    view_id: Annotated[str, Query(min_length=1, max_length=200)] = (
        DEFAULT_BUSINESS_REQUIREMENTS_VIEW_ID
    ),
    dimensions: Annotated[int, Query(ge=2, le=3)] = 2,
    layout_version: Annotated[Literal["initial-semantic-v1"], Query()] = INITIAL_LAYOUT_VERSION,
) -> BusinessRequirementsGraphResponse:
    del layout_version  # The Literal validates the only supported public version.
    try:
        return await service.graph(dataset_id, view_id, cast(GraphDimensions, dimensions))
    except BusinessRequirementsQueryError as error:
        _raise_http_error(error)


@router.get(
    "/{requirement_id}",
    response_model=BusinessRequirementDetailResponse,
    responses=ERROR_RESPONSES,
)
async def business_requirement_detail(
    service: BusinessRequirementsServiceDep,
    requirement_id: Annotated[str, Path(min_length=1, max_length=200)],
    dataset_id: Annotated[str, Query(min_length=1, max_length=200)] = (
        DEFAULT_BUSINESS_REQUIREMENTS_DATASET_ID
    ),
) -> BusinessRequirementDetailResponse:
    try:
        return await service.detail(dataset_id, requirement_id)
    except BusinessRequirementsQueryError as error:
        _raise_http_error(error)
