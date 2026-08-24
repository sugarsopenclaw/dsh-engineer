from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.api.dependencies import get_current_user, get_prompt_template_service
from app.models.common import ApiResponse, OperationStatus
from app.models.prompt_template import (
    PromptTemplateCreateRequest,
    PromptTemplateUpdateRequest,
    PromptTemplateView,
)
from app.models.user import CurrentUserData
from app.services.prompt_template_service import PromptTemplateService

router = APIRouter(prefix="/users/me/prompt-templates", tags=["prompt-templates"])


@router.get("", response_model=ApiResponse[list[PromptTemplateView]])
def list_prompt_templates(
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[PromptTemplateService, Depends(get_prompt_template_service)],
) -> ApiResponse[list[PromptTemplateView]]:
    return ApiResponse(data=service.list_for_user(current_user))


@router.post(
    "",
    response_model=ApiResponse[PromptTemplateView],
    status_code=status.HTTP_201_CREATED,
)
def create_prompt_template(
    payload: PromptTemplateCreateRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[PromptTemplateService, Depends(get_prompt_template_service)],
) -> ApiResponse[PromptTemplateView]:
    return ApiResponse(data=service.create(current_user, payload))


@router.put("/{template_id}", response_model=ApiResponse[PromptTemplateView])
def update_prompt_template(
    payload: PromptTemplateUpdateRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[PromptTemplateService, Depends(get_prompt_template_service)],
    template_id: Annotated[str, Path(min_length=1, max_length=64)],
) -> ApiResponse[PromptTemplateView]:
    return ApiResponse(data=service.update(current_user, template_id, payload))


@router.delete("/{template_id}", response_model=ApiResponse[OperationStatus])
def delete_prompt_template(
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[PromptTemplateService, Depends(get_prompt_template_service)],
    template_id: Annotated[str, Path(min_length=1, max_length=64)],
) -> ApiResponse[OperationStatus]:
    return ApiResponse(data=service.delete(current_user, template_id))
