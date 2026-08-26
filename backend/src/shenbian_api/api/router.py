from fastapi import APIRouter

from shenbian_api.api.routes import catalog, health, model_gateway, ontology

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(ontology.router, prefix="/ontology", tags=["ontology"])
api_router.include_router(catalog.router, prefix="/data-catalog", tags=["data-catalog"])
api_router.include_router(
    model_gateway.router,
    prefix="/llm/deepseek",
    tags=["model-gateway"],
)
