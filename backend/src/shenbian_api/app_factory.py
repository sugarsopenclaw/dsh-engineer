from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from shenbian_api.api.router import api_router
from shenbian_api.application.business_requirements import BusinessRequirementsQueryService
from shenbian_api.application.cad_capabilities import CadCapabilitiesQueryService
from shenbian_api.application.ports import (
    BusinessRequirementsReader,
    CadCapabilitiesReader,
    DependencyProbe,
    TopologySemanticsRepository,
)
from shenbian_api.application.queries import DataCatalogQueryService, OntologyQueryService
from shenbian_api.application.readiness import ReadinessService
from shenbian_api.application.topology_semantics import TopologySemanticsService
from shenbian_api.core.config import Settings, get_settings
from shenbian_api.infrastructure.probes import build_dependency_probes
from shenbian_api.infrastructure.sqlite_business_requirements import (
    SqliteBusinessRequirementsReader,
)
from shenbian_api.infrastructure.sqlite_cad_capabilities import SqliteCadCapabilitiesReader
from shenbian_api.infrastructure.sqlite_topology_semantics import (
    SqliteTopologySemanticsRepository,
)
from shenbian_api.infrastructure.yaml_registry import (
    YamlDataCatalogRegistry,
    YamlOntologyRegistry,
)

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    probes: list[DependencyProbe] | None = None,
    business_requirements_reader: BusinessRequirementsReader | None = None,
    cad_capabilities_reader: CadCapabilitiesReader | None = None,
    topology_semantics_repository: TopologySemanticsRepository | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    ontology_registry = YamlOntologyRegistry(resolved_settings.ontology_path)
    catalog_registry = YamlDataCatalogRegistry(resolved_settings.catalog_directory)
    readiness_service = ReadinessService(
        probes if probes is not None else build_dependency_probes(resolved_settings)
    )
    resolved_business_requirements_reader = (
        business_requirements_reader or SqliteBusinessRequirementsReader(resolved_settings)
    )
    business_requirements_service = BusinessRequirementsQueryService(
        resolved_business_requirements_reader
    )
    resolved_cad_capabilities_reader = (
        cad_capabilities_reader or SqliteCadCapabilitiesReader(resolved_settings)
    )
    cad_capabilities_service = CadCapabilitiesQueryService(resolved_cad_capabilities_reader)
    resolved_topology_semantics_repository = (
        topology_semantics_repository
        or SqliteTopologySemanticsRepository(resolved_settings)
    )
    topology_semantics_service = TopologySemanticsService(
        resolved_topology_semantics_repository
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            results = await asyncio.gather(
                business_requirements_service.close(),
                cad_capabilities_service.close(),
                topology_semantics_service.close(),
                readiness_service.close(),
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, BaseException):
                    logger.error("application resource close failed: %s", type(result).__name__)

    application = FastAPI(
        title="沈变共享 API",
        version="0.4.0",
        description="为本地 Pi Agent 提供 SQLite 拓扑语义存储和共享接口。",
        lifespan=lifespan,
    )
    application.state.ontology_service = OntologyQueryService(ontology_registry)
    application.state.catalog_service = DataCatalogQueryService(catalog_registry)
    application.state.readiness_service = readiness_service
    application.state.business_requirements_service = business_requirements_service
    application.state.cad_capabilities_service = cad_capabilities_service
    application.state.topology_semantics_service = topology_semantics_service
    application.include_router(api_router)
    return application
