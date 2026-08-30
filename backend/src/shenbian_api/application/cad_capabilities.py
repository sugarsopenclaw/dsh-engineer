from __future__ import annotations

import hashlib

from shenbian_api.application.ports import CadCapabilitiesReader
from shenbian_api.domain.cad_capabilities import (
    CapabilityAtomDetailResponse,
    CapabilityAtomFilters,
    CapabilityAtomListResponse,
    CapabilityFacetsResponse,
    CapabilityGraphAtomStreamData,
)

DEFAULT_CAD_CAPABILITIES_DATASET_ID = "cad.capabilities.curated.v2"


def graph_atoms_etag(
    dataset_id: str,
    content_sha256: str,
    filters: CapabilityAtomFilters,
) -> str:
    """ETag 绑定数据集内容哈希 + 完整筛选条件：内容或条件变化则缓存失效。"""
    canonical = "|".join(
        f"{key}={value}"
        for key, value in sorted(filters.model_dump().items())
        if value is not None
    )
    digest = hashlib.sha256(f"{dataset_id}|{content_sha256}|{canonical}".encode()).hexdigest()
    return f'"graph-atoms-{digest[:32]}"'


class CadCapabilitiesQueryService:
    def __init__(self, reader: CadCapabilitiesReader) -> None:
        self._reader = reader

    async def list_atoms(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
        limit: int,
        offset: int,
    ) -> CapabilityAtomListResponse:
        data = await self._reader.list_atoms(dataset_id, filters, limit, offset)
        return CapabilityAtomListResponse(
            dataset=data.dataset,
            total=data.total,
            items=data.items,
            limit=limit,
            offset=offset,
        )

    async def detail(self, dataset_id: str, atom_id: str) -> CapabilityAtomDetailResponse:
        data = await self._reader.get_atom(dataset_id, atom_id)
        return CapabilityAtomDetailResponse(dataset_id=data.dataset_id, atom=data.atom)

    async def facets(self, dataset_id: str) -> CapabilityFacetsResponse:
        data = await self._reader.get_facets(dataset_id)
        return CapabilityFacetsResponse.model_validate(data.model_dump())

    async def prepare_graph_atom_stream(
        self,
        dataset_id: str,
        filters: CapabilityAtomFilters,
    ) -> tuple[CapabilityGraphAtomStreamData, str]:
        data = await self._reader.prepare_graph_atom_stream(dataset_id, filters)
        etag = graph_atoms_etag(dataset_id, data.dataset.content_sha256, filters)
        return data, etag

    async def close(self) -> None:
        await self._reader.close()
