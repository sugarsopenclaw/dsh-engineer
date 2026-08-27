from __future__ import annotations

import gzip
import json

import httpx2 as httpx
import pytest
from conftest import FakeDeepSeekGateway, FakeModelGatewayResponse, HealthyProbe
from fastapi.testclient import TestClient
from pydantic import SecretStr

from shenbian_api.app_factory import create_app
from shenbian_api.core.config import Settings
from shenbian_api.infrastructure.deepseek_gateway import HttpxDeepSeekModelGateway


class StaticAsyncStream(httpx.AsyncByteStream):
    def __init__(self, content: bytes) -> None:
        self._content = content

    async def __aiter__(self):
        yield self._content


def test_chat_completions_preserves_stream_and_harness_headers(
    client: TestClient,
    deepseek_gateway: FakeDeepSeekGateway,
) -> None:
    deepseek_gateway.response = FakeModelGatewayResponse(
        headers={"content-type": "text/event-stream", "x-request-id": "request-1"},
        chunks=[
            b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
            b"data: [DONE]\n\n",
        ],
    )
    payload = {
        "model": "deepseek-v4-flash",
        "messages": [{"role": "user", "content": "ping"}],
        "stream": True,
    }

    response = client.post(
        "/api/v1/llm/deepseek/chat/completions",
        content=json.dumps(payload),
        headers={
            "authorization": "Bearer client-key",
            "content-type": "application/json",
            "accept": "text/event-stream",
            "x-deepseek-harness-session-id": "session-1",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["x-request-id"] == "request-1"
    assert response.headers["x-shenbian-model-gateway"] == "deepseek"
    assert '"content":"ok"' in response.text
    assert deepseek_gateway.received_body == json.dumps(payload).encode()
    assert deepseek_gateway.received_headers is not None
    assert deepseek_gateway.received_headers["x-deepseek-harness-session-id"] == "session-1"
    assert deepseek_gateway.response.closed is True


def test_chat_completions_preserves_vision_payload_byte_for_byte(
    client: TestClient,
    deepseek_gateway: FakeDeepSeekGateway,
) -> None:
    body = json.dumps(
        {
            "model": "deepseek-v4-flash-vision-exp",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "这张图片是什么颜色？"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
                                "detail": "original",
                            },
                        },
                    ],
                }
            ],
            "stream": True,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()

    response = client.post(
        "/api/v1/llm/deepseek/chat/completions",
        content=body,
        headers={
            "authorization": "Bearer client-key",
            "content-type": "application/json",
        },
    )

    assert response.status_code == 200
    assert deepseek_gateway.received_body == body


def test_chat_completions_rejects_oversized_request(
    settings: Settings,
    deepseek_gateway: FakeDeepSeekGateway,
) -> None:
    deepseek_gateway.max_request_bytes = 4
    app = create_app(
        settings=settings,
        probes=[HealthyProbe("postgresql")],
        deepseek_gateway=deepseek_gateway,
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/llm/deepseek/chat/completions",
            content=b"12345",
            headers={"authorization": "Bearer client-key"},
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
    assert deepseek_gateway.received_body is None


def test_chat_completions_preserves_upstream_error_status(
    client: TestClient,
    deepseek_gateway: FakeDeepSeekGateway,
) -> None:
    deepseek_gateway.response = FakeModelGatewayResponse(
        status_code=429,
        headers={"content-type": "application/json", "retry-after": "2"},
        chunks=[b'{"error":{"message":"busy","code":"rate_limit"}}'],
    )

    response = client.post(
        "/api/v1/llm/deepseek/chat/completions",
        content=b"{}",
        headers={"authorization": "Bearer client-key"},
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "2"
    assert response.json()["error"]["code"] == "rate_limit"


def test_anthropic_messages_route_is_available_to_harness_search(
    client: TestClient,
    deepseek_gateway: FakeDeepSeekGateway,
) -> None:
    payload = {
        "model": "deepseek-v4-flash",
        "messages": [{"role": "user", "content": "search"}],
        "tools": [{"type": "web_search_20250305", "name": "web_search"}],
    }
    deepseek_gateway.response = FakeModelGatewayResponse(
        headers={"content-type": "application/json"},
        chunks=[b'{"content":[]}'],
    )

    response = client.post(
        "/api/v1/llm/deepseek/anthropic/v1/messages",
        content=json.dumps(payload),
        headers={
            "authorization": "Bearer client-key",
            "x-api-key": "client-key",
            "anthropic-version": "2023-06-01",
        },
    )

    assert response.status_code == 200
    assert response.headers["x-shenbian-model-gateway"] == "deepseek-search"
    assert response.json() == {"content": []}
    assert deepseek_gateway.received_messages_body == json.dumps(payload).encode()
    assert deepseek_gateway.received_messages_headers is not None
    assert deepseek_gateway.received_messages_headers["anthropic-version"] == "2023-06-01"


@pytest.mark.asyncio
async def test_httpx_gateway_forwards_client_bearer_to_upstream(settings: Settings) -> None:
    seen: dict[str, str | bytes] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers["authorization"]
        seen["session"] = request.headers["x-deepseek-harness-session-id"]
        seen["body"] = request.content
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream", "x-request-id": "upstream-1"},
            stream=StaticAsyncStream(b"data: [DONE]\n\n"),
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = HttpxDeepSeekModelGateway(settings, client=client)
    response = await gateway.chat_completions(
        b'{"stream":true}',
        {
            "authorization": "Bearer actual-deepseek-key",
            "content-type": "application/json",
            "x-deepseek-harness-session-id": "session-2",
        },
    )
    chunks = [chunk async for chunk in response.iter_raw()]
    await response.close()
    await client.aclose()

    assert seen == {
        "url": "https://api.deepseek.com/chat/completions",
        "authorization": "Bearer actual-deepseek-key",
        "session": "session-2",
        "body": b'{"stream":true}',
    }
    assert chunks == [b"data: [DONE]\n\n"]
    assert response.headers["x-request-id"] == "upstream-1"


@pytest.mark.asyncio
async def test_httpx_gateway_uses_root_deepseek_key_as_server_default(
    settings: Settings,
) -> None:
    server_settings = settings.model_copy(
        update={"deepseek_api_key": SecretStr("root-server-key")}
    )
    seen_authorization: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_authorization.append(request.headers["authorization"])
        return httpx.Response(200, content=b"data: [DONE]\n\n")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = HttpxDeepSeekModelGateway(server_settings, client=client)
    response = await gateway.chat_completions(
        b"{}",
        {"authorization": "Bearer dsh-client-key"},
    )
    await response.close()
    await client.aclose()

    assert seen_authorization == ["Bearer root-server-key"]


@pytest.mark.asyncio
async def test_httpx_gateway_explicit_upstream_key_overrides_root_key(
    settings: Settings,
) -> None:
    server_settings = settings.model_copy(
        update={
            "deepseek_api_key": SecretStr("root-server-key"),
            "deepseek_upstream_api_key": SecretStr("deployment-override-key"),
        }
    )
    seen_authorization: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_authorization.append(request.headers["authorization"])
        return httpx.Response(200, content=b"data: [DONE]\n\n")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = HttpxDeepSeekModelGateway(server_settings, client=client)
    response = await gateway.chat_completions(
        b"{}",
        {"authorization": "Bearer dsh-client-key"},
    )
    await response.close()
    await client.aclose()

    assert seen_authorization == ["Bearer deployment-override-key"]


@pytest.mark.asyncio
async def test_httpx_gateway_can_separate_gateway_and_upstream_credentials(
    settings: Settings,
) -> None:
    secured_settings = settings.model_copy(
        update={
            "shenbian_gateway_api_key": SecretStr("local-gateway-key"),
            "deepseek_upstream_api_key": SecretStr("server-owned-upstream-key"),
        }
    )
    seen_authorization: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_authorization.append(request.headers["authorization"])
        return httpx.Response(200, content=b"data: [DONE]\n\n")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = HttpxDeepSeekModelGateway(secured_settings, client=client)
    response = await gateway.chat_completions(
        b"{}",
        {"authorization": "Bearer local-gateway-key"},
    )
    await response.close()
    await client.aclose()

    assert seen_authorization == ["Bearer server-owned-upstream-key"]


@pytest.mark.asyncio
async def test_httpx_gateway_decodes_upstream_content_encoding(settings: Settings) -> None:
    sse = b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'

    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream", "content-encoding": "gzip"},
            stream=StaticAsyncStream(gzip.compress(sse)),
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = HttpxDeepSeekModelGateway(settings, client=client)
    response = await gateway.chat_completions(
        b"{}",
        {"authorization": "Bearer actual-deepseek-key"},
    )
    content = b"".join([chunk async for chunk in response.iter_raw()])
    await response.close()
    await client.aclose()

    assert content == sse
    assert "content-encoding" not in response.headers


@pytest.mark.asyncio
async def test_httpx_gateway_forwards_anthropic_messages_auth(settings: Settings) -> None:
    seen: dict[str, str] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers["authorization"]
        seen["x-api-key"] = request.headers["x-api-key"]
        seen["anthropic-version"] = request.headers["anthropic-version"]
        return httpx.Response(200, content=b'{"content":[]}')

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = HttpxDeepSeekModelGateway(settings, client=client)
    response = await gateway.messages(
        b"{}",
        {
            "authorization": "Bearer actual-deepseek-key",
            "x-api-key": "actual-deepseek-key",
            "anthropic-version": "2023-06-01",
        },
    )
    await response.close()
    await client.aclose()

    assert seen == {
        "url": "https://api.deepseek.com/anthropic/v1/messages",
        "authorization": "Bearer actual-deepseek-key",
        "x-api-key": "actual-deepseek-key",
        "anthropic-version": "2023-06-01",
    }
