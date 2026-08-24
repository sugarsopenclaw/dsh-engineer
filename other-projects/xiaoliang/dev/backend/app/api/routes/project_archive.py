from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, get_project_archive_service
from app.models.common import ApiResponse
from app.models.project_archive import (
    ProjectArchiveConversationSyncData,
    ProjectArchiveConversationSyncRequest,
    ProjectArchiveFilesConfirmData,
    ProjectArchiveFilesConfirmRequest,
    ProjectArchiveFilesPrepareData,
    ProjectArchiveFilesPrepareRequest,
    ProjectArchiveMessageAttachmentsConfirmData,
    ProjectArchiveMessageAttachmentsConfirmRequest,
    ProjectArchiveProjectData,
    ProjectArchiveSnapshotCompleteData,
    ProjectArchiveSnapshotCompleteRequest,
    ProjectArchiveSnapshotStartData,
    ProjectArchiveSnapshotStartRequest,
    ProjectArchiveUpsertRequest,
    PiSessionArchiveConfirmData,
    PiSessionArchiveConfirmRequest,
    PiSessionArchivePrepareData,
    PiSessionArchivePrepareRequest,
    ProjectDocumentAnalyzeData,
    ProjectDocumentAnalyzeRequest,
)
from app.models.user import CurrentUserData
from app.services.project_archive_service import ProjectArchiveService

router = APIRouter(prefix="/project-archive", tags=["project-archive"])


@router.post("/projects", response_model=ApiResponse[ProjectArchiveProjectData])
def upsert_project_archive(
    payload: ProjectArchiveUpsertRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[ProjectArchiveProjectData]:
    return ApiResponse(data=service.upsert_project(current_user, payload))


@router.post("/snapshots/start", response_model=ApiResponse[ProjectArchiveSnapshotStartData])
def start_project_archive_snapshot(
    payload: ProjectArchiveSnapshotStartRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[ProjectArchiveSnapshotStartData]:
    return ApiResponse(data=service.start_snapshot(current_user, payload))


@router.post("/files/prepare", response_model=ApiResponse[ProjectArchiveFilesPrepareData])
def prepare_project_archive_files(
    payload: ProjectArchiveFilesPrepareRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[ProjectArchiveFilesPrepareData]:
    return ApiResponse(data=service.prepare_files(current_user, payload))


@router.post("/files/confirm", response_model=ApiResponse[ProjectArchiveFilesConfirmData])
def confirm_project_archive_files(
    payload: ProjectArchiveFilesConfirmRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[ProjectArchiveFilesConfirmData]:
    return ApiResponse(data=service.confirm_files(current_user, payload))


@router.post(
    "/snapshots/{snapshot_id}/complete",
    response_model=ApiResponse[ProjectArchiveSnapshotCompleteData],
)
def complete_project_archive_snapshot(
    snapshot_id: str,
    payload: ProjectArchiveSnapshotCompleteRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[ProjectArchiveSnapshotCompleteData]:
    return ApiResponse(data=service.complete_snapshot(current_user, snapshot_id, payload))


@router.post(
    "/conversations/sync",
    response_model=ApiResponse[ProjectArchiveConversationSyncData],
)
def sync_project_conversation(
    payload: ProjectArchiveConversationSyncRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[ProjectArchiveConversationSyncData]:
    return ApiResponse(data=service.sync_conversation(current_user, payload))


@router.post(
    "/pi-sessions/prepare",
    response_model=ApiResponse[PiSessionArchivePrepareData],
)
def prepare_pi_session_archive(
    payload: PiSessionArchivePrepareRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[PiSessionArchivePrepareData]:
    return ApiResponse(data=service.prepare_pi_session_archive(current_user, payload))


@router.post(
    "/pi-sessions/confirm",
    response_model=ApiResponse[PiSessionArchiveConfirmData],
)
def confirm_pi_session_archive(
    payload: PiSessionArchiveConfirmRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[PiSessionArchiveConfirmData]:
    return ApiResponse(data=service.confirm_pi_session_archive(current_user, payload))


@router.post(
    "/message-attachments/confirm",
    response_model=ApiResponse[ProjectArchiveMessageAttachmentsConfirmData],
)
def confirm_project_message_attachments(
    payload: ProjectArchiveMessageAttachmentsConfirmRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[ProjectArchiveMessageAttachmentsConfirmData]:
    return ApiResponse(data=service.confirm_message_attachments(current_user, payload))


@router.post("/documents/analyze", response_model=ApiResponse[ProjectDocumentAnalyzeData])
def analyze_project_document(
    payload: ProjectDocumentAnalyzeRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user)],
    service: Annotated[ProjectArchiveService, Depends(get_project_archive_service)],
) -> ApiResponse[ProjectDocumentAnalyzeData]:
    return ApiResponse(data=service.analyze_document(current_user, payload))
