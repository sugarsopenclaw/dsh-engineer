from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Generator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import get_agent_gateway_service, get_auth_service
from app.core.config import get_settings
from app.core.database import session_scope
from app.core.errors import AppError
from app.models.agent_model import ManagedAgentModelCatalogView
from app.models.common import ApiResponse
from app.services.agent_gateway_service import AgentGatewayService
from app.services.agent_usage_service import AgentUsageService
from app.services.auth_service import AuthService

router = APIRouter(tags=["agent-gateway"])
bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)

MANAGED_KEY_PREFIX = "xl."
INTERNAL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
INTERNAL_CHILD_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
CALL_PURPOSES = {"main", "subagent", "cad_query", "visual_index", "schema_repair", "compaction"}
CHILD_CALL_PURPOSES = {"subagent", "cad_query", "visual_index", "schema_repair"}
GATEWAY_FINISH_RETRY_DELAYS_SECONDS = (0.5, 2.0)


def parse_gateway_credentials(
    credentials: HTTPAuthorizationCredentials | None,
    run_id_header: str | None,
) -> tuple[str, str | None]:
    """Return (access_token, client_run_id).

    Supported forms:
    - Bearer <jwt> + header X-Xiaoliang-Agent-Run-Id
    - Bearer xl.<client_run_id>.<jwt>
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "缺少访问令牌。", error_code="missing_token")

    raw = (credentials.credentials or "").strip()
    if not raw:
        raise AppError(401, "缺少访问令牌。", error_code="missing_token")

    header_run = (run_id_header or "").strip() or None
    if raw.startswith(MANAGED_KEY_PREFIX):
        parts = raw.split(".", 2)
        if len(parts) != 3 or not parts[1].strip() or not parts[2].strip():
            raise AppError(401, "托管模型凭证格式无效。", error_code="invalid_managed_credential")
        return parts[2].strip(), parts[1].strip()

    return raw, header_run


def extract_gateway_call_metadata(
    payload: dict[str, Any],
    credential_run_id: str | None,
) -> tuple[str, str | None]:
    declared_run_id = payload.pop("xiaoliang_client_run_id", None)
    child_run_id = payload.pop("xiaoliang_child_run_id", None)
    call_purpose = payload.pop("xiaoliang_call_purpose", None)

    if declared_run_id is not None:
        declared = str(declared_run_id).strip()
        if not INTERNAL_ID_PATTERN.fullmatch(declared) or declared != credential_run_id:
            raise AppError(403, "模型调用与 agent run 绑定不一致。", error_code="agent_run_mismatch")
    purpose = str(call_purpose or "main").strip()
    if purpose not in CALL_PURPOSES:
        raise AppError(422, "模型调用用途无效。", error_code="invalid_call_purpose")
    child = str(child_run_id or "").strip() or None
    if child is not None and not INTERNAL_CHILD_ID_PATTERN.fullmatch(child):
        raise AppError(422, "模型调用 child run id 无效。", error_code="invalid_child_run_id")
    if purpose in CHILD_CALL_PURPOSES and child is None:
        raise AppError(422, "该模型调用用途需要 child run id。", error_code="child_run_id_required")
    if purpose in {"main", "compaction"} and child is not None:
        raise AppError(422, "该模型调用用途不接受 child run id。", error_code="unexpected_child_run_id")
    return purpose, child


def count_request_images(payload: dict[str, Any]) -> int:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return 0
    count = 0
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") in {"image", "image_url", "input_image"}:
                count += 1
    return count


def stream_chunk_metadata(chunk: str) -> tuple[dict[str, Any] | None, str | None]:
    latest_usage: dict[str, Any] | None = None
    error_code: str | None = None
    for line in chunk.splitlines():
        if not line.startswith("data:"):
            continue
        raw = line.removeprefix("data:").strip()
        if not raw or raw == "[DONE]":
            continue
        try:
            event = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if not isinstance(event, dict):
            continue
        usage = event.get("usage")
        if isinstance(usage, dict):
            latest_usage = usage
        error = event.get("error")
        if isinstance(error, dict):
            candidate = error.get("code")
            error_code = str(candidate or "model_stream_failed")[:128]
    return latest_usage, error_code


def finish_gateway_call_durably(
    call_id: str,
    *,
    status: str,
    usage: dict[str, Any] | None = None,
    error_code: str | None = None,
) -> None:
    """Closes and charges a finished call, retrying only a lost pool checkout.

    Token usage becomes billable in this write, and it now needs a connection of its own
    because the request stops holding one across the model I/O. Pool pressure is exactly
    when a long stream ends, so surrendering the checkout on the first timeout would leave
    the call at ``started`` and hand out the tokens for free. Blocking sleeps are safe here:
    every caller runs this in a worker thread.
    """
    for delay in (*GATEWAY_FINISH_RETRY_DELAYS_SECONDS, None):
        try:
            with session_scope() as session:
                AgentUsageService(session).finish_gateway_call(
                    call_id,
                    status=status,
                    usage=usage,
                    error_code=error_code,
                )
            return
        except SQLAlchemyTimeoutError:
            if delay is None:
                logger.exception("gave up finishing agent usage call id=%s", call_id)
                return
            time.sleep(delay)
        except Exception:
            logger.exception("failed to finish agent usage call id=%s", call_id)
            return


def tracked_gateway_stream(
    source: Generator[str, None, None],
    call_id: str,
) -> Generator[str, None, None]:
    usage: dict[str, Any] | None = None
    error_code: str | None = None
    exhausted = False
    try:
        for chunk in source:
            chunk_usage, chunk_error = stream_chunk_metadata(chunk)
            if chunk_usage is not None:
                usage = chunk_usage
            if chunk_error is not None:
                error_code = chunk_error
            yield chunk
        exhausted = True
    except GeneratorExit:
        error_code = error_code or "client_disconnected"
        raise
    except BaseException:
        error_code = error_code or "model_stream_interrupted"
        raise
    finally:
        status = "failed" if error_code and error_code != "client_disconnected" else (
            "completed" if exhausted else "stopped"
        )
        finish_gateway_call_durably(
            call_id,
            status=status,
            usage=usage,
            error_code=error_code,
        )


@router.get("/agent/v1/models", response_model=ApiResponse[ManagedAgentModelCatalogView])
def agent_model_catalog(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    gateway: Annotated[AgentGatewayService, Depends(get_agent_gateway_service)],
) -> ApiResponse[ManagedAgentModelCatalogView]:
    access_token, _client_run_id = parse_gateway_credentials(credentials, None)
    auth_service.resolve_current_user(access_token)
    return ApiResponse(data=gateway.model_catalog())


@router.post("/agent/v1/chat/completions", response_model=None)
async def agent_chat_completions(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    gateway: Annotated[AgentGatewayService, Depends(get_agent_gateway_service)],
) -> dict[str, Any] | StreamingResponse:
    try:
        payload = await request.json()
    except Exception as exc:
        raise AppError(422, "Request body must be a JSON object.", error_code="invalid_agent_request") from exc
    if not isinstance(payload, dict):
        raise AppError(422, "Request body must be a JSON object.", error_code="invalid_agent_request")

    access_token, client_run_id = parse_gateway_credentials(
        credentials,
        request.headers.get("X-Xiaoliang-Agent-Run-Id"),
    )
    settings = get_settings()
    call_id: str | None = None
    call_purpose: str
    with session_scope() as session:
        auth_service = AuthService(session)
        agent_usage_service = AgentUsageService(session)
        current_user = auth_service.resolve_current_user(access_token)

        bound_run = None
        if settings.agent_gateway_require_run_id:
            if not client_run_id:
                raise AppError(
                    403,
                    "模型网关要求绑定 agent run（请从晓量客户端发送消息）。",
                    error_code="agent_run_required",
                )
            bound_run = agent_usage_service.assert_active_run(
                current_user.organization.id,
                client_run_id,
            )
        elif client_run_id:
            bound_run = agent_usage_service.get_started_run(
                current_user.organization.id,
                client_run_id,
            )
        if bound_run is not None and bound_run.user_id != current_user.user.id:
            raise AppError(403, "Agent run 不属于当前用户。", error_code="agent_run_required")

        # Post-paid billing: authorize on a positive balance, charge the real token
        # cost afterwards. A run whose balance runs dry mid-way stops here.
        agent_usage_service.ledger.assert_can_spend(current_user.organization.id)
        call_purpose, child_run_id = extract_gateway_call_metadata(payload, client_run_id)
        model_alias = str(payload.get("model") or "").strip()[:128]
        provider_model = gateway.resolve_provider_model(model_alias)
        if bound_run is not None:
            usage_call = agent_usage_service.start_gateway_call(
                bound_run,
                child_run_id=child_run_id,
                call_purpose=call_purpose,
                model_alias=model_alias,
                provider_model=provider_model,
                image_count=count_request_images(payload),
            )
            call_id = str(usage_call.id)

    if bool(payload.get("stream")):
        stream = gateway.stream(payload, call_purpose)
        if call_id is not None:
            stream = tracked_gateway_stream(stream, call_id)
        return StreamingResponse(stream, media_type="text/event-stream")
    try:
        result = await run_in_threadpool(gateway.complete, payload, call_purpose)
    except AppError as exc:
        if call_id is not None:
            await run_in_threadpool(
                finish_gateway_call_durably,
                call_id,
                status="failed",
                error_code=exc.error_code or "model_request_failed",
            )
        raise
    except Exception:
        if call_id is not None:
            await run_in_threadpool(
                finish_gateway_call_durably,
                call_id,
                status="failed",
                error_code="model_request_failed",
            )
        raise
    if call_id is not None:
        await run_in_threadpool(
            finish_gateway_call_durably,
            call_id,
            status="completed",
            usage=result.get("usage"),
        )
    return result
