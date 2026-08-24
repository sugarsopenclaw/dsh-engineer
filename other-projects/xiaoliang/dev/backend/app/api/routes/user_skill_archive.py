from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, get_user_skill_archive_service
from app.models.common import ApiResponse
from app.models.user import CurrentUserData
from app.models.user_skill_archive import (
    UserSkillArchiveFilesConfirmData,
    UserSkillArchiveFilesConfirmRequest,
    UserSkillArchiveFilesPrepareData,
    UserSkillArchiveFilesPrepareRequest,
    UserSkillArchiveSnapshotCompleteData,
    UserSkillArchiveSnapshotCompleteRequest,
    UserSkillArchiveSnapshotStartData,
    UserSkillArchiveSnapshotStartRequest,
)
from app.services.user_skill_archive_service import UserSkillArchiveService

router = APIRouter(prefix="/user-skills/archive", tags=["user-skill-archive"])


@router.post("/snapshots/start", response_model=ApiResponse[UserSkillArchiveSnapshotStartData])
def start_user_skill_archive_snapshot(
    payload: UserSkillArchiveSnapshotStartRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[UserSkillArchiveService, Depends(get_user_skill_archive_service)],
) -> ApiResponse[UserSkillArchiveSnapshotStartData]:
    return ApiResponse(data=service.start_snapshot(current_user, payload))


@router.post("/files/prepare", response_model=ApiResponse[UserSkillArchiveFilesPrepareData])
def prepare_user_skill_archive_files(
    payload: UserSkillArchiveFilesPrepareRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[UserSkillArchiveService, Depends(get_user_skill_archive_service)],
) -> ApiResponse[UserSkillArchiveFilesPrepareData]:
    return ApiResponse(data=service.prepare_files(current_user, payload))


@router.post("/files/confirm", response_model=ApiResponse[UserSkillArchiveFilesConfirmData])
def confirm_user_skill_archive_files(
    payload: UserSkillArchiveFilesConfirmRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[UserSkillArchiveService, Depends(get_user_skill_archive_service)],
) -> ApiResponse[UserSkillArchiveFilesConfirmData]:
    return ApiResponse(data=service.confirm_files(current_user, payload))


@router.post(
    "/snapshots/{snapshot_id}/complete",
    response_model=ApiResponse[UserSkillArchiveSnapshotCompleteData],
)
def complete_user_skill_archive_snapshot(
    snapshot_id: str,
    payload: UserSkillArchiveSnapshotCompleteRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[UserSkillArchiveService, Depends(get_user_skill_archive_service)],
) -> ApiResponse[UserSkillArchiveSnapshotCompleteData]:
    return ApiResponse(data=service.complete_snapshot(current_user, snapshot_id, payload))
