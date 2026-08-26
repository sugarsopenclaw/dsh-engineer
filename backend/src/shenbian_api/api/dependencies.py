from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from shenbian_api.application.model_gateway import DeepSeekModelGateway
from shenbian_api.application.queries import DataCatalogQueryService, OntologyQueryService
from shenbian_api.application.readiness import ReadinessService


def get_ontology_service(request: Request) -> OntologyQueryService:
    return request.app.state.ontology_service


def get_catalog_service(request: Request) -> DataCatalogQueryService:
    return request.app.state.catalog_service


def get_readiness_service(request: Request) -> ReadinessService:
    return request.app.state.readiness_service


def get_deepseek_gateway(request: Request) -> DeepSeekModelGateway:
    return request.app.state.deepseek_gateway


OntologyServiceDep = Annotated[OntologyQueryService, Depends(get_ontology_service)]
CatalogServiceDep = Annotated[DataCatalogQueryService, Depends(get_catalog_service)]
ReadinessServiceDep = Annotated[ReadinessService, Depends(get_readiness_service)]
DeepSeekGatewayDep = Annotated[DeepSeekModelGateway, Depends(get_deepseek_gateway)]
