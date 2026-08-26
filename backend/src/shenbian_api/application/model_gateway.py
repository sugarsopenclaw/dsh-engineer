from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Protocol


class ModelGatewayAuthenticationError(Exception):
    """The client did not provide a usable gateway or upstream credential."""


class ModelGatewayConfigurationError(Exception):
    """The gateway cannot construct a valid upstream request from its configuration."""


class ModelGatewayTransportError(Exception):
    """The gateway could not establish an upstream response."""


class ModelGatewayResponse(Protocol):
    @property
    def status_code(self) -> int: ...

    @property
    def headers(self) -> Mapping[str, str]: ...

    def iter_raw(self) -> AsyncIterator[bytes]: ...

    async def close(self) -> None: ...


class DeepSeekModelGateway(Protocol):
    @property
    def max_request_bytes(self) -> int: ...

    async def chat_completions(
        self,
        body: bytes,
        headers: Mapping[str, str],
    ) -> ModelGatewayResponse: ...

    async def messages(
        self,
        body: bytes,
        headers: Mapping[str, str],
    ) -> ModelGatewayResponse: ...

    async def close(self) -> None: ...
