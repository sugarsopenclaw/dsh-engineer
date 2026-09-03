from fastapi import APIRouter

from shenbian_api.api.routes import (
    business_requirements,
    cad_capabilities,
    catalog,
    health,
    ontology,
    topology_semantics,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(ontology.router, prefix="/ontology", tags=["ontology"])
api_router.include_router(catalog.router, prefix="/data-catalog", tags=["data-catalog"])
api_router.include_router(
    business_requirements.router,
    prefix="/business-requirements",
    tags=["business-requirements"],
)
api_router.include_router(
    cad_capabilities.router,
    prefix="/cad-capabilities",
    tags=["cad-capabilities"],
)
api_router.include_router(
    topology_semantics.router,
    prefix="/topology-semantics",
    tags=["topology-semantics"],
)
