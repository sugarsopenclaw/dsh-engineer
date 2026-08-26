from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from shenbian_api.api.dependencies import DeepSeekGatewayDep
from shenbian_api.application.model_gateway import (
    ModelGatewayAuthenticationError,
    ModelGatewayConfigurationError,
    ModelGatewayResponse,
    ModelGatewayTransportError,
)

router = APIRouter()


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "message": message,
                "type": "shenbian_model_gateway_error",
                "code": code,
            }
        },
    )


async def _read_body(request: Request, max_bytes: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > max_bytes:
                raise ValueError("request_too_large")
        except ValueError as error:
            raise ValueError("request_too_large") from error

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise ValueError("request_too_large")
    return bytes(body)


async def _stream_and_close(upstream: ModelGatewayResponse) -> AsyncIterator[bytes]:
    try:
        async for chunk in upstream.iter_raw():
            yield chunk
    finally:
        await upstream.close()


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    gateway: DeepSeekGatewayDep,
) -> Response:
    try:
        body = await _read_body(request, gateway.max_request_bytes)
    except ValueError:
        return _error(413, "request_too_large", "Model request exceeds the gateway limit.")

    try:
        upstream = await gateway.chat_completions(body, request.headers)
    except ModelGatewayAuthenticationError:
        return _error(401, "authentication_failed", "Model gateway authentication failed.")
    except ModelGatewayConfigurationError:
        return _error(503, "gateway_not_configured", "Model gateway is not configured.")
    except ModelGatewayTransportError:
        return _error(502, "upstream_unreachable", "DeepSeek upstream is unreachable.")

    headers = dict(upstream.headers)
    headers["x-shenbian-model-gateway"] = "deepseek"
    return StreamingResponse(
        _stream_and_close(upstream),
        status_code=upstream.status_code,
        headers=headers,
    )


@router.post("/anthropic/v1/messages")
async def anthropic_messages(
    request: Request,
    gateway: DeepSeekGatewayDep,
) -> Response:
    try:
        body = await _read_body(request, gateway.max_request_bytes)
    except ValueError:
        return _error(413, "request_too_large", "Model request exceeds the gateway limit.")

    try:
        upstream = await gateway.messages(body, request.headers)
    except ModelGatewayAuthenticationError:
        return _error(401, "authentication_failed", "Model gateway authentication failed.")
    except ModelGatewayConfigurationError:
        return _error(503, "gateway_not_configured", "Model gateway is not configured.")
    except ModelGatewayTransportError:
        return _error(502, "upstream_unreachable", "DeepSeek upstream is unreachable.")

    headers = dict(upstream.headers)
    headers["x-shenbian-model-gateway"] = "deepseek-search"
    return StreamingResponse(
        _stream_and_close(upstream),
        status_code=upstream.status_code,
        headers=headers,
    )
