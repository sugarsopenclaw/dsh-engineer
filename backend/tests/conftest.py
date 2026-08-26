from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from shenbian_api.app_factory import create_app
from shenbian_api.application.ports import DependencyProbe
from shenbian_api.core.config import Settings


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


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url=SecretStr("postgresql://test:test@127.0.0.1:5432/test"),
        redis_url=SecretStr("redis://127.0.0.1:6379/0"),
        alibaba_cloud_access_key_id=SecretStr("test"),
        alibaba_cloud_access_key_secret=SecretStr("test"),
        oss_bucket="test-bucket",
        oss_region="cn-beijing",
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    app = create_app(
        settings=settings,
        probes=[HealthyProbe("postgresql"), HealthyProbe("redis"), HealthyProbe("oss")],
    )
    with TestClient(app) as test_client:
        yield test_client
