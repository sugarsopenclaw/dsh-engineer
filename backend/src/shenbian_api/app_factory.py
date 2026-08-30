from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from shenbian_api.api.router import api_router
from shenbian_api.application.business_requirements import BusinessRequirementsQueryService
from shenbian_api.application.cad_capabilities import CadCapabilitiesQueryService
from shenbian_api.application.model_gateway import DeepSeekModelGateway
from shenbian_api.application.ports import (
    BusinessRequirementsReader,
    CadCapabilitiesReader,
    DependencyProbe,
)
from shenbian_api.application.queries import DataCatalogQueryService, OntologyQueryService
from shenbian_api.application.readiness import ReadinessService
from shenbian_api.core.config import Settings, get_settings
from shenbian_api.infrastructure.deepseek_gateway import HttpxDeepSeekModelGateway
from shenbian_api.infrastructure.postgres_business_requirements import (
    PostgresBusinessRequirementsReader,
)
from shenbian_api.infrastructure.postgres_cad_capabilities import PostgresCadCapabilitiesReader
from shenbian_api.infrastructure.probes import build_dependency_probes
from shenbian_api.infrastructure.yaml_registry import (
    YamlDataCatalogRegistry,
    YamlOntologyRegistry,
)

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    probes: list[DependencyProbe] | None = None,
    deepseek_gateway: DeepSeekModelGateway | None = None,
    business_requirements_reader: BusinessRequirementsReader | None = None,
    cad_capabilities_reader: CadCapabilitiesReader | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    ontology_registry = YamlOntologyRegistry(resolved_settings.ontology_path)
    catalog_registry = YamlDataCatalogRegistry(resolved_settings.catalog_directory)
    readiness_service = ReadinessService(
        probes if probes is not None else build_dependency_probes(resolved_settings)
    )
    resolved_deepseek_gateway = deepseek_gateway or HttpxDeepSeekModelGateway(resolved_settings)
    resolved_business_requirements_reader = (
        business_requirements_reader or PostgresBusinessRequirementsReader(resolved_settings)
    )
    business_requirements_service = BusinessRequirementsQueryService(
        resolved_business_requirements_reader
    )
    resolved_cad_capabilities_reader = (
        cad_capabilities_reader or PostgresCadCapabilitiesReader(resolved_settings)
    )
    cad_capabilities_service = CadCapabilitiesQueryService(resolved_cad_capabilities_reader)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            results = await asyncio.gather(
                resolved_deepseek_gateway.close(),
                business_requirements_service.close(),
                cad_capabilities_service.close(),
                readiness_service.close(),
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, BaseException):
                    logger.error("application resource close failed: %s", type(result).__name__)

    application = FastAPI(
        title="沈变 Harness Agent API",
        version="0.3.0",
        description="为本地 DeepSeek Harness Agent 提供模型网关和共享业务接口。",
        lifespan=lifespan,
    )
    application.state.ontology_service = OntologyQueryService(ontology_registry)
    application.state.catalog_service = DataCatalogQueryService(catalog_registry)
    application.state.readiness_service = readiness_service
    application.state.deepseek_gateway = resolved_deepseek_gateway
    application.state.business_requirements_service = business_requirements_service
    application.state.cad_capabilities_service = cad_capabilities_service
    application.include_router(api_router)
    return application
