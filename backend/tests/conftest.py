from __future__ import annotations

from collections.abc import AsyncIterator, Mapping

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from shenbian_api.app_factory import create_app
from shenbian_api.application.model_gateway import ModelGatewayResponse
from shenbian_api.application.ports import DependencyProbe
from shenbian_api.core.config import Settings
from shenbian_api.domain.business_requirements import (
    BusinessRequirementDetailData,
    BusinessRequirementsGraphSnapshot,
)
from shenbian_api.domain.cad_capabilities import (
    CapabilityAtomDetailData,
    CapabilityAtomFilters,
    CapabilityAtomPageData,
    CapabilityFacetsData,
    CapabilityGraphAtomStreamData,
)
from shenbian_api.domain.topology_semantics import (
    SemanticDescriptionCreateRequest,
    SemanticDescriptionDetailResponse,
    SemanticDescriptionListResponse,
    SemanticDescriptionWriteResponse,
    SemanticSearchResponse,
    TopologyMatchRequest,
    TopologyMatchResponse,
    TopologyObservationCreateRequest,
    TopologyObservationDetailResponse,
    TopologyObservationWriteResponse,
    TopologyPatternDetailResponse,
    TopologyPatternListResponse,
)


class HealthyProbe(DependencyProbe):
    def __init__(self, name: str) -> None:
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    async def check(self) -> None:
        return None

    async def close(self) -> None:
        return None


class FakeModelGatewayResponse(ModelGatewayResponse):
    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: Mapping[str, str] | None = None,
        chunks: list[bytes] | None = None,
    ) -> None:
        self._status_code = status_code
        self._headers = dict(headers or {"content-type": "text/event-stream"})
        self._chunks = chunks or [b"data: [DONE]\\n\\n"]
        self.closed = False

    @property
    def status_code(self) -> int:
        return self._status_code

    @property
    def headers(self) -> Mapping[str, str]:
        return self._headers

    async def iter_raw(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk

    async def close(self) -> None:
        self.closed = True


class FakeDeepSeekGateway:
    def __init__(self) -> None:
        self.max_request_bytes = 1024 * 1024
        self.response = FakeModelGatewayResponse()
        self.received_body: bytes | None = None
        self.received_headers: dict[str, str] | None = None
        self.received_messages_body: bytes | None = None
        self.received_messages_headers: dict[str, str] | None = None
        self.closed = False

    async def chat_completions(
        self,
        body: bytes,
        headers: Mapping[str, str],
    ) -> FakeModelGatewayResponse:
        self.received_body = body
        self.received_headers = dict(headers)
        return self.response

    async def messages(
        self,
        body: bytes,
        headers: Mapping[str, str],
    ) -> FakeModelGatewayResponse:
        self.received_messages_body = body
        self.received_messages_headers = dict(headers)
        return self.response

    async def close(self) -> None:
        self.closed = True


class NoopBusinessRequirementsReader:
    async def get_graph(
        self,
        dataset_id: str,
        view_id: str,
    ) -> BusinessRequirementsGraphSnapshot:
        raise AssertionError(f"unexpected graph query: {dataset_id}/{view_id}")

    async def get_detail(
        self,
        dataset_id: str,
        requirement_id: str,
    ) -> BusinessRequirementDetailData:
        raise AssertionError(f"unexpected detail query: {dataset_id}/{requirement_id}")

    async def close(self) -> None:
        return None


class NoopCadCapabilitiesReader:
    async def list_atoms(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
        limit: int,
        offset: int,
    ) -> CapabilityAtomPageData:
        raise AssertionError(
            f"unexpected capability list query: {dataset_id}/{filters}/{limit}/{offset}"
        )

    async def get_atom(self, dataset_id: str, atom_id: str) -> CapabilityAtomDetailData:
        raise AssertionError(f"unexpected capability detail query: {dataset_id}/{atom_id}")

    async def get_facets(self, dataset_id: str) -> CapabilityFacetsData:
        raise AssertionError(f"unexpected capability facets query: {dataset_id}")

    async def prepare_graph_atom_stream(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
    ) -> CapabilityGraphAtomStreamData:
        raise AssertionError(
            f"unexpected capability graph-atoms query: {dataset_id}/{filters}"
        )

    async def close(self) -> None:
        return None


class NoopTopologySemanticsRepository:
    async def register_observation(
        self,
        request: TopologyObservationCreateRequest,
    ) -> TopologyObservationWriteResponse:
        raise AssertionError(f"unexpected topology observation write: {request.ingestion_key}")

    async def append_description(
        self,
        request: SemanticDescriptionCreateRequest,
    ) -> SemanticDescriptionWriteResponse:
        raise AssertionError(f"unexpected topology description write: {request.description_key}")

    async def match(self, request: TopologyMatchRequest) -> TopologyMatchResponse:
        raise AssertionError(f"unexpected topology match: {request.fingerprint.shape_hash}")

    async def list_descriptions(
        self,
        knowledge_scope: str,
        description_kind: str | None,
        limit: int,
        offset: int,
    ) -> SemanticDescriptionListResponse:
        raise AssertionError(
            "unexpected topology description list: "
            f"{knowledge_scope}/{description_kind}/{limit}/{offset}"
        )

    async def list_patterns(
        self,
        knowledge_scope: str,
        scope_kind: str | None,
        limit: int,
        offset: int,
    ) -> TopologyPatternListResponse:
        raise AssertionError(
            f"unexpected topology pattern list: {knowledge_scope}/{scope_kind}/{limit}/{offset}"
        )

    async def pattern_detail(self, pattern_id: str) -> TopologyPatternDetailResponse:
        raise AssertionError(f"unexpected topology pattern detail: {pattern_id}")

    async def description_detail(
        self,
        description_id: str,
    ) -> SemanticDescriptionDetailResponse:
        raise AssertionError(f"unexpected topology description detail: {description_id}")

    async def observation_detail(
        self,
        observation_id: str,
    ) -> TopologyObservationDetailResponse:
        raise AssertionError(f"unexpected topology observation detail: {observation_id}")

    async def search_semantics(
        self,
        knowledge_scope: str,
        query: str,
        limit: int,
    ) -> SemanticSearchResponse:
        raise AssertionError(
            f"unexpected topology semantic search: {knowledge_scope}/{query}/{limit}"
        )

    async def close(self) -> None:
        return None


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url=SecretStr("postgresql://test:test@127.0.0.1:5432/test"),
        redis_url=SecretStr("redis://127.0.0.1:6379/0"),
        alibaba_cloud_access_key_id=SecretStr("test"),
        alibaba_cloud_access_key_secret=SecretStr("test"),
        oss_bucket="test-bucket",
        oss_region="cn-beijing",
        # Never let a developer's real root .env influence gateway assertions.
        deepseek_api_key=None,
        deepseek_upstream_api_key=None,
        shenbian_gateway_api_key=None,
    )


@pytest.fixture
def deepseek_gateway() -> FakeDeepSeekGateway:
    return FakeDeepSeekGateway()


@pytest.fixture
def client(settings: Settings, deepseek_gateway: FakeDeepSeekGateway) -> TestClient:
    app = create_app(
        settings=settings,
        probes=[HealthyProbe("postgresql"), HealthyProbe("redis"), HealthyProbe("oss")],
        deepseek_gateway=deepseek_gateway,
        business_requirements_reader=NoopBusinessRequirementsReader(),
        cad_capabilities_reader=NoopCadCapabilitiesReader(),
        topology_semantics_repository=NoopTopologySemanticsRepository(),
    )
    with TestClient(app) as test_client:
        yield test_client
