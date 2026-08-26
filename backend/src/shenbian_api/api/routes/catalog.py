from fastapi import APIRouter

from shenbian_api.api.dependencies import CatalogServiceDep
from shenbian_api.domain.catalog import DataCatalogSummary

router = APIRouter()


@router.get("", response_model=DataCatalogSummary)
async def data_catalog(service: CatalogServiceDep) -> DataCatalogSummary:
    return service.summary()
