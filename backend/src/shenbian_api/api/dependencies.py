from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from shenbian_api.application.business_requirements import BusinessRequirementsQueryService
from shenbian_api.application.cad_capabilities import CadCapabilitiesQueryService
from shenbian_api.application.queries import DataCatalogQueryService, OntologyQueryService
from shenbian_api.application.readiness import ReadinessService
from shenbian_api.application.topology_semantics import TopologySemanticsService


def get_ontology_service(request: Request) -> OntologyQueryService:
    return request.app.state.ontology_service


def get_catalog_service(request: Request) -> DataCatalogQueryService:
    return request.app.state.catalog_service


def get_readiness_service(request: Request) -> ReadinessService:
    return request.app.state.readiness_service


def get_business_requirements_service(request: Request) -> BusinessRequirementsQueryService:
    return request.app.state.business_requirements_service


def get_cad_capabilities_service(request: Request) -> CadCapabilitiesQueryService:
    return request.app.state.cad_capabilities_service


def get_topology_semantics_service(request: Request) -> TopologySemanticsService:
    return request.app.state.topology_semantics_service


OntologyServiceDep = Annotated[OntologyQueryService, Depends(get_ontology_service)]
CatalogServiceDep = Annotated[DataCatalogQueryService, Depends(get_catalog_service)]
ReadinessServiceDep = Annotated[ReadinessService, Depends(get_readiness_service)]
BusinessRequirementsServiceDep = Annotated[
    BusinessRequirementsQueryService,
    Depends(get_business_requirements_service),
]
CadCapabilitiesServiceDep = Annotated[
    CadCapabilitiesQueryService,
    Depends(get_cad_capabilities_service),
]
TopologySemanticsServiceDep = Annotated[
    TopologySemanticsService,
    Depends(get_topology_semantics_service),
]
