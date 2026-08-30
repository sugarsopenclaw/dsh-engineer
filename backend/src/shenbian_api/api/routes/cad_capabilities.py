from __future__ import annotations

import zlib
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response, status
from fastapi.responses import StreamingResponse

from shenbian_api.api.dependencies import CadCapabilitiesServiceDep
from shenbian_api.application.cad_capabilities import DEFAULT_CAD_CAPABILITIES_DATASET_ID
from shenbian_api.application.cad_capability_errors import (
    CadCapabilitiesQueryError,
    CadCapabilitiesUnavailableError,
)
from shenbian_api.domain.cad_capabilities import (
    CadCapabilitiesErrorResponse,
    CapabilityAtomDetailResponse,
    CapabilityAtomFilters,
    CapabilityAtomListResponse,
    CapabilityFacetsResponse,
    CapabilityGraphAtom,
)

router = APIRouter()

ERROR_RESPONSES = {
    status.HTTP_404_NOT_FOUND: {"model": CadCapabilitiesErrorResponse},
    status.HTTP_503_SERVICE_UNAVAILABLE: {"model": CadCapabilitiesErrorResponse},
}


def _raise_http_error(error: CadCapabilitiesQueryError) -> None:
    status_code = (
        status.HTTP_503_SERVICE_UNAVAILABLE
        if isinstance(error, CadCapabilitiesUnavailableError)
        else status.HTTP_404_NOT_FOUND
    )
    raise HTTPException(
        status_code=status_code,
        detail={"code": error.code, "message": error.safe_message},
    ) from None


@router.get(
    "/atoms",
    response_model=CapabilityAtomListResponse,
    responses=ERROR_RESPONSES,
)
async def list_capability_atoms(
    service: CadCapabilitiesServiceDep,
    dataset_id: Annotated[str, Query(min_length=1, max_length=200)] = (
        DEFAULT_CAD_CAPABILITIES_DATASET_ID
    ),
    surface: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    observed_host_id: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    atom_kind: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    classification_status: Annotated[
        str | None, Query(min_length=1, max_length=100)
    ] = None,
    operation_kind: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    domain_tag: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    query: Annotated[
        str | None,
        Query(alias="q", min_length=1, max_length=300),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> CapabilityAtomListResponse:
    filters = CapabilityAtomFilters(
        surface=surface,
        observed_host_id=observed_host_id,
        atom_kind=atom_kind,
        classification_status=classification_status,
        operation_kind=operation_kind,
        domain_tag=domain_tag,
        query=query,
    )
    try:
        return await service.list_atoms(dataset_id, filters, limit, offset)
    except CadCapabilitiesQueryError as error:
        _raise_http_error(error)


def _graph_atom_filters(
    surface: str | None,
    observed_host_id: str | None,
    atom_kind: str | None,
    classification_status: str | None,
    operation_kind: str | None,
    domain_tag: str | None,
    query: str | None,
) -> CapabilityAtomFilters:
    return CapabilityAtomFilters(
        surface=surface,
        observed_host_id=observed_host_id,
        atom_kind=atom_kind,
        classification_status=classification_status,
        operation_kind=operation_kind,
        domain_tag=domain_tag,
        query=query,
    )


async def _ndjson_lines(
    stream: AsyncIterator[CapabilityGraphAtom],
) -> AsyncIterator[bytes]:
    async for atom in stream:
        yield atom.model_dump_json().encode() + b"\n"


@router.get(
    "/graph-atoms",
    responses=ERROR_RESPONSES,
)
async def capability_graph_atoms(
    service: CadCapabilitiesServiceDep,
    request: Request,
    dataset_id: Annotated[str, Query(min_length=1, max_length=200)] = (
        DEFAULT_CAD_CAPABILITIES_DATASET_ID
    ),
    surface: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    observed_host_id: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    atom_kind: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    classification_status: Annotated[
        str | None, Query(min_length=1, max_length=100)
    ] = None,
    operation_kind: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    domain_tag: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    query: Annotated[
        str | None,
        Query(alias="q", min_length=1, max_length=300),
    ] = None,
) -> Response:
    """
    图谱专用批量通道：NDJSON 流、最小投影、按 atom_id 稳定排序。
    ETag 绑定 dataset 内容哈希与筛选条件；命中 If-None-Match 返回 304。
    gzip 只在本路由内按需压缩，避免影响模型网关的 SSE 透传。
    """
    filters = _graph_atom_filters(
        surface,
        observed_host_id,
        atom_kind,
        classification_status,
        operation_kind,
        domain_tag,
        query,
    )
    try:
        prepared, etag = await service.prepare_graph_atom_stream(dataset_id, filters)
    except CadCapabilitiesQueryError as error:
        _raise_http_error(error)

    headers = {
        "X-Total-Count": str(prepared.total),
        "X-Dataset-Sha256": prepared.dataset.content_sha256,
        "ETag": etag,
        # no-cache = 允许存储但必须重新验证；配合 ETag 命中时只花一次 304 往返。
        # 不用 immutable：同一 dataset_id 重导入后内容会变，immutable 会发陈旧数据。
        "Cache-Control": "private, no-cache",
    }
    if request.headers.get("if-none-match") == etag:
        # 预准备的流持有只读连接，304 不消费它，显式关闭归还连接。
        await prepared.stream.aclose()
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)

    if "gzip" in request.headers.get("accept-encoding", ""):
        compressor = zlib.compressobj(level=6, wbits=31)

        async def gzip_lines() -> AsyncIterator[bytes]:
            async for chunk in _ndjson_lines(prepared.stream):
                data = compressor.compress(chunk) + compressor.flush(zlib.Z_SYNC_FLUSH)
                if data:
                    yield data
            tail = compressor.flush(zlib.Z_FINISH)
            if tail:
                yield tail

        return StreamingResponse(
            gzip_lines(),
            media_type="application/x-ndjson",
            headers={**headers, "Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
        )

    return StreamingResponse(
        _ndjson_lines(prepared.stream),
        media_type="application/x-ndjson",
        headers={**headers, "Vary": "Accept-Encoding"},
    )



@router.get(
    "/facets",
    response_model=CapabilityFacetsResponse,
    responses=ERROR_RESPONSES,
)
async def capability_facets(
    service: CadCapabilitiesServiceDep,
    dataset_id: Annotated[str, Query(min_length=1, max_length=200)] = (
        DEFAULT_CAD_CAPABILITIES_DATASET_ID
    ),
) -> CapabilityFacetsResponse:
    try:
        return await service.facets(dataset_id)
    except CadCapabilitiesQueryError as error:
        _raise_http_error(error)


@router.get(
    "/atoms/{atom_id}",
    response_model=CapabilityAtomDetailResponse,
    responses=ERROR_RESPONSES,
)
async def capability_atom_detail(
    service: CadCapabilitiesServiceDep,
    atom_id: Annotated[str, Path(min_length=1, max_length=200)],
    dataset_id: Annotated[str, Query(min_length=1, max_length=200)] = (
        DEFAULT_CAD_CAPABILITIES_DATASET_ID
    ),
) -> CapabilityAtomDetailResponse:
    try:
        return await service.detail(dataset_id, atom_id)
    except CadCapabilitiesQueryError as error:
        _raise_http_error(error)
