from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_agent_feedback_service, get_current_user
from app.models.agent_feedback import AgentMessageFeedbackUpsertRequest, AgentMessageFeedbackView
from app.models.common import ApiResponse, OperationStatus
from app.models.user import CurrentUserData
from app.services.agent_feedback_service import AgentFeedbackService

router = APIRouter(prefix="/users/me", tags=["agent-feedback"])


@router.get("/agent-feedback", response_model=ApiResponse[list[AgentMessageFeedbackView]])
def list_agent_feedback(
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    agent_feedback_service: Annotated[AgentFeedbackService, Depends(get_agent_feedback_service)],
    local_conversation_id: Annotated[str, Query(min_length=1, max_length=128)],
) -> ApiResponse[list[AgentMessageFeedbackView]]:
    return ApiResponse(
        data=agent_feedback_service.list_for_conversation(current_user, local_conversation_id.strip()),
    )


@router.put("/agent-feedback", response_model=ApiResponse[AgentMessageFeedbackView])
def upsert_agent_feedback(
    payload: AgentMessageFeedbackUpsertRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    agent_feedback_service: Annotated[AgentFeedbackService, Depends(get_agent_feedback_service)],
) -> ApiResponse[AgentMessageFeedbackView]:
    return ApiResponse(data=agent_feedback_service.upsert(current_user, payload))


@router.delete("/agent-feedback", response_model=ApiResponse[OperationStatus])
def delete_agent_feedback(
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    agent_feedback_service: Annotated[AgentFeedbackService, Depends(get_agent_feedback_service)],
    local_conversation_id: Annotated[str, Query(min_length=1, max_length=128)],
    local_message_id: Annotated[str, Query(min_length=1, max_length=128)],
) -> ApiResponse[OperationStatus]:
    return ApiResponse(
        data=agent_feedback_service.delete(
            current_user,
            local_conversation_id=local_conversation_id.strip(),
            local_message_id=local_message_id.strip(),
        )
    )
