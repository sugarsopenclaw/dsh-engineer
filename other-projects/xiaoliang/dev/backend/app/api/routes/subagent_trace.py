from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, get_subagent_trace_service
from app.models.common import ApiResponse
from app.models.subagent_trace import (
    SubagentTraceConfirmData,
    SubagentTraceConfirmRequest,
    SubagentTracePrepareData,
    SubagentTracePrepareRequest,
)
from app.models.user import CurrentUserData
from app.services.subagent_trace_service import SubagentTraceService

router = APIRouter(prefix="/subagent-traces", tags=["subagent-traces"])


@router.post("/prepare", response_model=ApiResponse[SubagentTracePrepareData])
def prepare_subagent_trace(
    payload: SubagentTracePrepareRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[SubagentTraceService, Depends(get_subagent_trace_service)],
) -> ApiResponse[SubagentTracePrepareData]:
    return ApiResponse(data=service.prepare(current_user, payload))


@router.post("/confirm", response_model=ApiResponse[SubagentTraceConfirmData])
def confirm_subagent_trace(
    payload: SubagentTraceConfirmRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[SubagentTraceService, Depends(get_subagent_trace_service)],
) -> ApiResponse[SubagentTraceConfirmData]:
    return ApiResponse(data=service.confirm(current_user, payload))

