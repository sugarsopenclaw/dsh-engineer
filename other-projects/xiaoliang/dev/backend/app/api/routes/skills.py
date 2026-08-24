from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_current_user, get_skill_service
from app.models.common import ApiResponse
from app.models.skill_release import SkillPackView, SkillReleaseCheckView
from app.services.skill_service import SkillService

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get(
    "/releases/check",
    response_model=ApiResponse[SkillReleaseCheckView],
    dependencies=[Depends(get_current_user)],
)
def check_skill_release(
    skill_service: Annotated[SkillService, Depends(get_skill_service)],
    release_channel: Annotated[str, Query(min_length=1)] = "stable",
    electron_version: Annotated[str | None, Query()] = None,
    current_skill_pack_version: Annotated[str | None, Query()] = None,
    current_skill_pack_checksum: Annotated[str | None, Query()] = None,
) -> ApiResponse[SkillReleaseCheckView]:
    return ApiResponse(
        data=skill_service.check_skill_release(
            release_channel=release_channel,
            electron_version=electron_version,
            current_skill_pack_version=current_skill_pack_version,
            current_skill_pack_checksum=current_skill_pack_checksum,
        )
    )


@router.get(
    "/releases/pack",
    response_model=ApiResponse[SkillPackView],
    dependencies=[Depends(get_current_user)],
)
def get_skill_release_pack(
    skill_service: Annotated[SkillService, Depends(get_skill_service)],
    release_channel: Annotated[str, Query(min_length=1)] = "stable",
    skill_pack_version: Annotated[str | None, Query()] = None,
) -> ApiResponse[SkillPackView]:
    return ApiResponse(
        data=skill_service.get_skill_pack(
            release_channel=release_channel,
            skill_pack_version=skill_pack_version,
        )
    )
