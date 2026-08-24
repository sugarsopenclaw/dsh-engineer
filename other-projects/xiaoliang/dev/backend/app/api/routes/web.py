from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import (
    get_bocha_search_service,
    get_current_user_detached,
    get_web_search_service,
)
from app.core.ttl_cache import TTLCache
from app.models.common import ApiResponse
from app.models.user import CurrentUserData
from app.models.web import WebFetchRequest, WebGroundedData, WebSearchRequest
from app.services.bocha_search_service import BochaSearchService, BochaSearchUnavailable
from app.services.web_search_service import WebSearchService


router = APIRouter(prefix="/web", tags=["web"])
logger = logging.getLogger(__name__)
_SEARCH_CACHE: TTLCache[tuple[object, ...], WebGroundedData] = TTLCache(
    maxsize=128,
    ttl_seconds=15 * 60,
)


def _normalize_cache_text(value: str | None) -> str:
    return " ".join((value or "").split()).strip().casefold()


def _search_cache_key(
    payload: WebSearchRequest,
    *,
    bocha_configured: bool,
) -> tuple[object, ...]:
    return (
        _normalize_cache_text(payload.query),
        payload.limit,
        _normalize_cache_text(payload.region),
        payload.freshness or "noLimit",
        tuple(sorted(payload.allowed_domains)),
        tuple(sorted(payload.blocked_domains)),
        bocha_configured,
    )


def _finalize_search_result(
    result: WebGroundedData,
    *,
    provider: str,
    fallback_reason: str | None = None,
) -> WebGroundedData:
    # Search is a hit-discovery operation. Never expose upstream model prose as a hit.
    result.answer = ""
    result.content = ""
    result.provider = provider
    result.fallback_reason = fallback_reason
    result.status = "ok" if result.sources else "empty"
    result.final_url = None
    result.content_type = None
    result.truncated = None
    if fallback_reason:
        notice = f"Bocha 首选通道已降级（{fallback_reason}）。"
        result.warning = f"{result.warning} {notice}".strip() if result.warning else notice
    return result


@router.post("/search", response_model=ApiResponse[WebGroundedData])
def search_web(
    payload: WebSearchRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user_detached)],
    web_search_service: Annotated[WebSearchService, Depends(get_web_search_service)],
    bocha_search_service: Annotated[BochaSearchService, Depends(get_bocha_search_service)],
) -> ApiResponse[WebGroundedData]:
    del current_user
    cache_key = _search_cache_key(
        payload,
        bocha_configured=bocha_search_service.is_configured,
    )
    cached = _SEARCH_CACHE.get(cache_key)
    if cached is not None:
        return ApiResponse(data=cached.model_copy(deep=True))

    fallback_reason: str
    if bocha_search_service.is_configured:
        try:
            bocha_result = bocha_search_service.search(
                query=payload.query,
                limit=payload.limit,
                region=payload.region,
                freshness=payload.freshness or "noLimit",
                allowed_domains=payload.allowed_domains,
                blocked_domains=payload.blocked_domains,
            )
            if bocha_result.sources:
                result = _finalize_search_result(bocha_result, provider="bocha")
                _SEARCH_CACHE.set(cache_key, result.model_copy(deep=True))
                return ApiResponse(data=result)
            fallback_reason = "bocha_empty"
        except BochaSearchUnavailable as exc:
            logger.warning("bocha search unavailable, falling back to qwen: %s", exc)
            fallback_reason = "bocha_error"
        except Exception:
            # The preferred channel must not take the main Agent's only search capability
            # offline because of an unexpected provider payload or client-library failure.
            logger.exception("unexpected bocha search failure; falling back to qwen")
            fallback_reason = "bocha_error"
    else:
        fallback_reason = "bocha_unconfigured"

    qwen_result = web_search_service.search(
        query=payload.query,
        limit=payload.limit,
        region=payload.region,
        freshness=payload.freshness or "noLimit",
        allowed_domains=payload.allowed_domains,
        blocked_domains=payload.blocked_domains,
    )
    result = _finalize_search_result(
        qwen_result,
        provider="qwen",
        fallback_reason=fallback_reason,
    )
    # A transient Bocha failure must not hide recovery behind a 15-minute Qwen cache entry.
    if fallback_reason != "bocha_error":
        _SEARCH_CACHE.set(cache_key, result.model_copy(deep=True))
    return ApiResponse(data=result)


@router.post("/fetch", response_model=ApiResponse[WebGroundedData])
def fetch_web(
    payload: WebFetchRequest,
    current_user: Annotated[CurrentUserData, Depends(get_current_user_detached)],
    web_search_service: Annotated[WebSearchService, Depends(get_web_search_service)],
) -> ApiResponse[WebGroundedData]:
    del current_user
    result = web_search_service.fetch(
        url=payload.url,
        prompt=payload.prompt,
        region=payload.region,
    )
    return ApiResponse(data=result)


def clear_web_search_cache() -> None:
    """Test/operations hook for deterministic process-local cache invalidation."""

    _SEARCH_CACHE.clear()
