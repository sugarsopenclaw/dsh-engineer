from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from shenbian_api.api.router import api_router
from shenbian_api.application.model_gateway import DeepSeekModelGateway
from shenbian_api.application.ports import DependencyProbe
from shenbian_api.application.queries import DataCatalogQueryService, OntologyQueryService
from shenbian_api.application.readiness import ReadinessService
from shenbian_api.core.config import Settings, get_settings
from shenbian_api.infrastructure.deepseek_gateway import HttpxDeepSeekModelGateway
from shenbian_api.infrastructure.probes import build_dependency_probes
from shenbian_api.infrastructure.yaml_registry import (
    YamlDataCatalogRegistry,
    YamlOntologyRegistry,
)


def create_app(
    settings: Settings | None = None,
    probes: list[DependencyProbe] | None = None,
    deepseek_gateway: DeepSeekModelGateway | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    ontology_registry = YamlOntologyRegistry(resolved_settings.ontology_path)
    catalog_registry = YamlDataCatalogRegistry(resolved_settings.catalog_directory)
    readiness_service = ReadinessService(
        probes if probes is not None else build_dependency_probes(resolved_settings)
    )
    resolved_deepseek_gateway = deepseek_gateway or HttpxDeepSeekModelGateway(resolved_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await resolved_deepseek_gateway.close()
            await readiness_service.close()

    application = FastAPI(
        title="沈变 Harness Agent API",
        version="0.1.0",
        description="为本地 DeepSeek Harness Agent 提供模型网关和共享业务接口。",
        lifespan=lifespan,
    )
    application.state.ontology_service = OntologyQueryService(ontology_registry)
    application.state.catalog_service = DataCatalogQueryService(catalog_registry)
    application.state.readiness_service = readiness_service
    application.state.deepseek_gateway = resolved_deepseek_gateway
    application.include_router(api_router)
    return application
