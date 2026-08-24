from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import PlainTextResponse, RedirectResponse

from app.api.dependencies import get_desktop_update_service
from app.core.config import get_settings
from app.core.errors import AppError
from app.models.desktop_update import (
    DesktopReleaseIn,
    DesktopReleaseOut,
    DesktopReleasePatchIn,
    DesktopUpdatePolicyCheckIn,
    DesktopUpdatePolicyCheckOut,
    DesktopUpdatePolicyIn,
    DesktopUpdatePolicyOut,
)
from app.services.desktop_update_service import (
    PAUSED_STATUS,
    PUBLISHED_STATUS,
    YANKED_STATUS,
    DesktopUpdateService,
)

router = APIRouter(prefix="/desktop-updates", tags=["desktop-updates"])


def require_release_admin(
    x_release_admin_token: Annotated[str | None, Header(alias="X-Release-Admin-Token")] = None,
) -> None:
    expected = (get_settings().release_admin_token or "").strip()
    supplied = (x_release_admin_token or "").strip()
    if not expected or not hmac.compare_digest(supplied, expected):
        raise AppError(403, "Release admin access denied.", error_code="release_admin_forbidden")


def request_headers(request: Request) -> dict[str, str]:
    return {key.lower(): value for key, value in request.headers.items()}


@router.get("/windows/x64/latest.yml", response_class=PlainTextResponse)
def get_latest_yml(
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> PlainTextResponse:
    content = service.latest_feed(platform="windows", arch="x64", channel="stable")
    return PlainTextResponse(content=content, media_type="text/yaml")


@router.get("/windows/x64/beta.yml", response_class=PlainTextResponse)
def get_beta_yml(
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> PlainTextResponse:
    content = service.latest_feed(platform="windows", arch="x64", channel="beta")
    return PlainTextResponse(content=content, media_type="text/yaml")


@router.api_route("/windows/x64/{file_name}", methods=["GET", "HEAD"])
def download_desktop_update_file(
    file_name: str,
    request: Request,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
    source: str | None = Query(default=None),
) -> RedirectResponse:
    location = service.redirect_desktop_artifact(
        platform="windows",
        arch="x64",
        file_name=file_name,
        source=source,
        request_headers=request_headers(request),
        client_host=request.client.host if request.client else None,
        record_event=request.method == "GET",
        http_method=request.method,
    )
    return RedirectResponse(url=location, status_code=302)


@router.post("/policy", response_model=DesktopUpdatePolicyCheckOut)
def get_update_policy(
    payload: DesktopUpdatePolicyCheckIn,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> DesktopUpdatePolicyCheckOut:
    return service.evaluate_policy(payload)


@router.post(
    "/admin/releases",
    response_model=DesktopReleaseOut,
    dependencies=[Depends(require_release_admin)],
)
def create_desktop_release(
    payload: DesktopReleaseIn,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> DesktopReleaseOut:
    return service.create_desktop_release(payload)


@router.patch(
    "/admin/releases/{release_id}",
    response_model=DesktopReleaseOut,
    dependencies=[Depends(require_release_admin)],
)
def patch_desktop_release(
    release_id: int,
    payload: DesktopReleasePatchIn,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> DesktopReleaseOut:
    return service.update_desktop_release(release_id, payload)


@router.post(
    "/admin/releases/{release_id}/publish",
    response_model=DesktopReleaseOut,
    dependencies=[Depends(require_release_admin)],
)
def publish_desktop_release(
    release_id: int,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> DesktopReleaseOut:
    return service.set_release_status(release_id, PUBLISHED_STATUS)


@router.post(
    "/admin/releases/{release_id}/pause",
    response_model=DesktopReleaseOut,
    dependencies=[Depends(require_release_admin)],
)
def pause_desktop_release(
    release_id: int,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> DesktopReleaseOut:
    return service.set_release_status(release_id, PAUSED_STATUS)


@router.post(
    "/admin/releases/{release_id}/resume",
    response_model=DesktopReleaseOut,
    dependencies=[Depends(require_release_admin)],
)
def resume_desktop_release(
    release_id: int,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> DesktopReleaseOut:
    return service.set_release_status(release_id, PUBLISHED_STATUS)


@router.post(
    "/admin/releases/{release_id}/yank",
    response_model=DesktopReleaseOut,
    dependencies=[Depends(require_release_admin)],
)
def yank_desktop_release(
    release_id: int,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> DesktopReleaseOut:
    return service.set_release_status(release_id, YANKED_STATUS)


@router.put(
    "/admin/policies/windows/x64/{channel}",
    response_model=DesktopUpdatePolicyOut,
    dependencies=[Depends(require_release_admin)],
)
def put_windows_policy(
    channel: str,
    payload: DesktopUpdatePolicyIn,
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> DesktopUpdatePolicyOut:
    if channel not in {"stable", "beta"}:
        raise AppError(422, "更新通道无效。", error_code="desktop_update_channel_invalid")
    return service.upsert_policy(
        platform="windows",
        arch="x64",
        channel=channel,
        payload=payload,
    )
