from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import RedirectResponse

from app.api.dependencies import get_desktop_update_service
from app.models.client_release import ClientReleaseView
from app.models.common import ApiResponse
from app.services.desktop_update_service import DesktopUpdateService

router = APIRouter(prefix="/client-releases", tags=["client-releases"])


def _request_headers(request: Request) -> dict[str, str]:
    return {key.lower(): value for key, value in request.headers.items()}


@router.get("/latest", response_model=ApiResponse[ClientReleaseView])
def get_latest_client_release(
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
) -> ApiResponse[ClientReleaseView]:
    return ApiResponse(data=service.get_client_release_view())


@router.api_route("/download/{platform}", methods=["GET", "HEAD"])
def download_client_release(
    request: Request,
    platform: Annotated[str, Path(min_length=1)],
    service: Annotated[DesktopUpdateService, Depends(get_desktop_update_service)],
    source: Annotated[str | None, Query(max_length=64)] = None,
) -> RedirectResponse:
    location = service.redirect_latest_installer(
        platform_key=platform,
        source=source,
        request_headers=_request_headers(request),
        client_host=request.client.host if request.client else None,
        record_event=request.method == "GET",
        http_method=request.method,
    )
    return RedirectResponse(url=location, status_code=302)
