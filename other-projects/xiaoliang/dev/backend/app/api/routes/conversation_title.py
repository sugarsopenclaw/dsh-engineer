from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_conversation_title_service, get_current_user
from app.models.common import ApiResponse
from app.models.conversation_title import ConversationTitleRequest, ConversationTitleResult
from app.models.user import CurrentUserData
from app.services.conversation_title_service import ConversationTitleService

router = APIRouter(prefix="/agent/v1", tags=["agent-conversation-title"])


@router.post(
    "/conversation-title",
    response_model=ApiResponse[ConversationTitleResult],
)
def generate_conversation_title(
    payload: ConversationTitleRequest,
    _current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ConversationTitleService, Depends(get_conversation_title_service)],
) -> ApiResponse[ConversationTitleResult]:
    return ApiResponse(
        data=ConversationTitleResult(title=service.generate(payload.first_user_message))
    )
