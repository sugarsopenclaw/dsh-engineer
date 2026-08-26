from fastapi import APIRouter, Response, status

from shenbian_api.api.dependencies import ReadinessServiceDep
from shenbian_api.application.readiness import ReadinessResult

router = APIRouter()


@router.get("/live")
async def live() -> dict[str, str]:
    return {"status": "alive"}


@router.get("/ready", response_model=ReadinessResult)
async def ready(service: ReadinessServiceDep, response: Response) -> ReadinessResult:
    result = await service.check()
    if result.status != "ready":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result
