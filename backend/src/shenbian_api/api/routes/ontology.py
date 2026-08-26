from fastapi import APIRouter

from shenbian_api.api.dependencies import OntologyServiceDep
from shenbian_api.domain.ontology import ActionTypeDefinition, OntologySummary

router = APIRouter()


@router.get("", response_model=OntologySummary)
async def ontology_summary(service: OntologyServiceDep) -> OntologySummary:
    return service.summary()


@router.get("/actions", response_model=list[ActionTypeDefinition])
async def ontology_actions(service: OntologyServiceDep) -> list[ActionTypeDefinition]:
    return service.actions()
