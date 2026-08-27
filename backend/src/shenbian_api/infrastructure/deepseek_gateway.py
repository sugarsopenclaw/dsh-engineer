from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from secrets import compare_digest

import httpx2 as httpx
from pydantic import SecretStr

from shenbian_api.application.model_gateway import (
    ModelGatewayAuthenticationError,
    ModelGatewayConfigurationError,
    ModelGatewayTransportError,
)
from shenbian_api.core.config import Settings

_REQUEST_HEADERS = (
    "accept",
    "content-type",
    "user-agent",
    "x-deepseek-harness-compact",
    "x-deepseek-harness-session-id",
    "x-deepseek-harness-user-id",
)
_ANTHROPIC_REQUEST_HEADERS = (
    "accept",
    "anthropic-version",
    "content-type",
    "user-agent",
)
_RESPONSE_HEADERS = (
    "cache-control",
    "content-type",
    "retry-after",
    "x-deepseek-request-id",
    "x-request-id",
)


def _secret_value(secret: SecretStr | None) -> str | None:
    if secret is None:
        return None
    value = secret.get_secret_value().strip()
    return value or None


def _bearer_token(header: str | None) -> str | None:
    if header is None:
        return None
    scheme, separator, token = header.partition(" ")
    if separator == "" or scheme.lower() != "bearer":
        return None
    normalized = token.strip()
    return normalized or None


class HttpxModelGatewayResponse:
    def __init__(self, response: httpx.Response) -> None:
        self._response = response

    @property
    def status_code(self) -> int:
        return self._response.status_code

    @property
    def headers(self) -> Mapping[str, str]:
        return {
            name: value
            for name in _RESPONSE_HEADERS
            if (value := self._response.headers.get(name)) is not None
        }

    async def iter_raw(self) -> AsyncIterator[bytes]:
        # Decode HTTP content encoding here; downstream receives ordinary SSE bytes
        # and therefore must not inherit an upstream gzip/br header.
        async for chunk in self._response.aiter_bytes():
            yield chunk

    async def close(self) -> None:
        await self._response.aclose()


class HttpxDeepSeekModelGateway:
    """Transparent DeepSeek chat-completions proxy used by the local Harness runtime."""

    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        base_url = settings.deepseek_upstream_base_url.rstrip("/")
        parsed = httpx.URL(base_url)
        if parsed.scheme not in {"http", "https"} or parsed.host is None:
            raise ModelGatewayConfigurationError("invalid_deepseek_upstream_base_url")

        search_base_url = settings.deepseek_search_upstream_base_url.rstrip("/")
        parsed_search = httpx.URL(search_base_url)
        if parsed_search.scheme not in {"http", "https"} or parsed_search.host is None:
            raise ModelGatewayConfigurationError("invalid_deepseek_search_upstream_base_url")

        self._endpoint = f"{base_url}/chat/completions"
        self._messages_endpoint = f"{search_base_url}/messages"
        # The repository-level DEEPSEEK_API_KEY is the default server-owned
        # upstream credential. The gateway-specific name remains an explicit
        # deployment override, and an empty override must not mask the default.
        self._upstream_api_key = (
            _secret_value(settings.deepseek_upstream_api_key)
            or _secret_value(settings.deepseek_api_key)
        )
        self._gateway_api_key = _secret_value(settings.shenbian_gateway_api_key)
        self._max_request_bytes = settings.deepseek_gateway_max_request_bytes
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=None, write=60.0, pool=10.0),
            follow_redirects=False,
        )

    @property
    def max_request_bytes(self) -> int:
        return self._max_request_bytes

    def _resolve_upstream_token(self, authorization: str | None) -> str:
        incoming_token = _bearer_token(authorization)
        if self._gateway_api_key is not None:
            if incoming_token is None or not compare_digest(incoming_token, self._gateway_api_key):
                raise ModelGatewayAuthenticationError("invalid_gateway_credential")
            if self._upstream_api_key is None:
                raise ModelGatewayConfigurationError("missing_deepseek_upstream_credential")
            return self._upstream_api_key

        if self._upstream_api_key is not None:
            return self._upstream_api_key
        if incoming_token is not None:
            return incoming_token
        raise ModelGatewayAuthenticationError("missing_deepseek_credential")

    async def chat_completions(
        self,
        body: bytes,
        headers: Mapping[str, str],
    ) -> HttpxModelGatewayResponse:
        normalized_headers = {name.lower(): value for name, value in headers.items()}
        upstream_headers = {
            name: normalized_headers[name]
            for name in _REQUEST_HEADERS
            if name in normalized_headers
        }
        upstream_headers.setdefault("accept", "text/event-stream")
        upstream_headers.setdefault("content-type", "application/json")
        upstream_headers["authorization"] = (
            f"Bearer {self._resolve_upstream_token(normalized_headers.get('authorization'))}"
        )

        return await self._send(self._endpoint, body, upstream_headers)

    async def messages(
        self,
        body: bytes,
        headers: Mapping[str, str],
    ) -> HttpxModelGatewayResponse:
        normalized_headers = {name.lower(): value for name, value in headers.items()}
        upstream_headers = {
            name: normalized_headers[name]
            for name in _ANTHROPIC_REQUEST_HEADERS
            if name in normalized_headers
        }
        upstream_headers.setdefault("accept", "application/json")
        upstream_headers.setdefault("anthropic-version", "2023-06-01")
        upstream_headers.setdefault("content-type", "application/json")
        token = self._resolve_upstream_token(normalized_headers.get("authorization"))
        upstream_headers["authorization"] = f"Bearer {token}"
        upstream_headers["x-api-key"] = token
        return await self._send(self._messages_endpoint, body, upstream_headers)

    async def _send(
        self,
        endpoint: str,
        body: bytes,
        headers: Mapping[str, str],
    ) -> HttpxModelGatewayResponse:
        request = self._client.build_request(
            "POST",
            endpoint,
            headers=headers,
            content=body,
        )
        try:
            response = await self._client.send(request, stream=True)
        except httpx.RequestError as error:
            raise ModelGatewayTransportError("deepseek_upstream_unreachable") from error
        return HttpxModelGatewayResponse(response)

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()
