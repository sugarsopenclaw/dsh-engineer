from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from app.api.dependencies import get_agent_usage_service, get_current_user
from app.models.agent_usage import (
    AgentUsageRunFinishRequest,
    AgentUsageRunDetailView,
    AgentUsageRunStartRequest,
    AgentUsageRunView,
)
from app.models.common import ApiResponse
from app.models.user import CurrentUserData
from app.services.agent_usage_service import AgentUsageService

router = APIRouter(prefix="/users/me", tags=["agent-usage"])


@router.post("/agent-runs", response_model=ApiResponse[AgentUsageRunView])
def start_agent_run(
    payload: AgentUsageRunStartRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    agent_usage_service: Annotated[AgentUsageService, Depends(get_agent_usage_service)],
) -> ApiResponse[AgentUsageRunView]:
    return ApiResponse(data=agent_usage_service.start_run(current_user, payload))


@router.patch("/agent-runs/{client_run_id}", response_model=ApiResponse[AgentUsageRunView])
def finish_agent_run(
    payload: AgentUsageRunFinishRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    agent_usage_service: Annotated[AgentUsageService, Depends(get_agent_usage_service)],
    client_run_id: Annotated[str, Path(min_length=1, max_length=128)],
) -> ApiResponse[AgentUsageRunView]:
    return ApiResponse(
        data=agent_usage_service.finish_run(current_user, client_run_id, payload),
    )


@router.get(
    "/agent-runs/{client_run_id}/usage",
    response_model=ApiResponse[AgentUsageRunDetailView],
)
def get_agent_run_usage(
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    agent_usage_service: Annotated[AgentUsageService, Depends(get_agent_usage_service)],
    client_run_id: Annotated[str, Path(min_length=1, max_length=128)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> ApiResponse[AgentUsageRunDetailView]:
    return ApiResponse(
        data=agent_usage_service.get_run_detail(current_user, client_run_id, limit=limit),
    )
