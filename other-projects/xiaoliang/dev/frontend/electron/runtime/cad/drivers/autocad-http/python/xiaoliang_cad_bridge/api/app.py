"""Loopback-only authenticated HTTP envelope."""

from __future__ import annotations

import asyncio
import hmac
from collections.abc import AsyncIterator, Collection
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, JsonValue

from xiaoliang_cad_bridge import PROTOCOL_VERSION
from xiaoliang_cad_bridge.application.worker import StaWorker, WorkHandle, WorkerResult
from xiaoliang_cad_bridge.errors import BridgeError, safe_error_details, safe_public_message


MAX_REQUEST_BYTES = 1024 * 1024


class Deadlines(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queue_ms: int = Field(default=5000, ge=1, le=60_000)
    response_ms: int = Field(default=120_000, ge=1, le=1_800_000)


class ExecuteClient(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    child_run_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$",
    )
    agent_role: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$",
    )


class ExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: int
    request_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    operation: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^(?:app|doc|extract|capture)\.[a-z][a-z0-9_]*$",
    )
    params: dict[str, JsonValue] = Field(default_factory=dict)
    deadlines: Deadlines = Field(default_factory=Deadlines)
    client: ExecuteClient | None = None


def error_envelope(error: BridgeError) -> dict[str, object]:
    return {
        "ok": False,
        "protocol_version": PROTOCOL_VERSION,
        "error": {
            "code": error.code,
            "message": safe_public_message(error.message),
            "retryable": error.retryable,
            "details": safe_error_details(error.details),
        },
        "warnings": [],
    }


async def await_worker(handle: WorkHandle, queue_seconds: float, response_seconds: float) -> WorkerResult:
    try:
        await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(handle.started)), timeout=queue_seconds)
    except TimeoutError:
        handle.cancel_if_queued()
        raise BridgeError(
            "QUEUE_TIMEOUT",
            "CAD operation did not leave the queue before its deadline",
            status_code=504,
            retryable=True,
        ) from None
    except asyncio.CancelledError:
        handle.cancel_if_queued()
        raise
    try:
        return await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(handle.result)), timeout=response_seconds)
    except TimeoutError:
        raise BridgeError(
            "RESPONSE_TIMEOUT",
            "CAD operation is still running after the response deadline",
            status_code=504,
            retryable=True,
        ) from None


def create_app(
    token: str,
    worker: StaWorker,
    project_root: str,
    allowed_operations: Collection[str],
) -> FastAPI:
    if len(token) < 32:
        raise ValueError("launch token must contain at least 32 characters")
    allowed = frozenset(allowed_operations)
    if "app.status" not in allowed:
        raise ValueError("allowed operations must include app.status")

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        worker.start()
        try:
            yield
        finally:
            worker.stop()

    app = FastAPI(
        title="Xiaoliang CAD Bridge",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.worker = worker
    app.state.project_root = project_root

    @app.middleware("http")
    async def request_size_limit(request: Request, call_next):
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                content_length = int(raw_length)
            except ValueError:
                content_length = MAX_REQUEST_BYTES + 1
            if content_length > MAX_REQUEST_BYTES:
                error = BridgeError(
                    "REQUEST_TOO_LARGE",
                    "CAD bridge request exceeds the 1 MiB limit",
                    status_code=413,
                )
                return JSONResponse(status_code=error.status_code, content=error_envelope(error))
        return await call_next(request)

    def authenticate(authorization: str | None = Header(default=None)) -> None:
        prefix = "Bearer "
        candidate = authorization[len(prefix) :] if authorization and authorization.startswith(prefix) else ""
        if not candidate or not hmac.compare_digest(candidate, token):
            raise BridgeError("AUTH_REQUIRED", "A valid bridge launch token is required", status_code=401)

    @app.exception_handler(BridgeError)
    async def bridge_error_handler(_request: Request, error: BridgeError) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content=error_envelope(error))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _error: RequestValidationError) -> JSONResponse:
        error = BridgeError("INVALID_ARGUMENT", "CAD bridge request validation failed", status_code=400)
        return JSONResponse(status_code=error.status_code, content=error_envelope(error))

    @app.exception_handler(Exception)
    async def internal_error_handler(_request: Request, _error: Exception) -> JSONResponse:
        error = BridgeError("INTERNAL_ERROR", "CAD bridge encountered an internal error", status_code=500)
        return JSONResponse(status_code=error.status_code, content=error_envelope(error))

    @app.get("/healthz")
    def healthz() -> dict[str, object]:
        worker_state = worker.snapshot()["state"]
        return {
            "status": "degraded" if worker_state == "degraded" else "alive",
            "protocol_version": PROTOCOL_VERSION,
            "worker_state": worker_state,
        }

    @app.get("/v1/capabilities", dependencies=[Depends(authenticate)])
    def capabilities() -> dict[str, object]:
        stateful_operations = [
            operation
            for operation in ("app.start", "app.restart", "doc.open", "doc.switch")
            if operation in allowed
        ]
        return {
            "ok": True,
            "protocol_version": PROTOCOL_VERSION,
            "data": {
                "operations": sorted(allowed),
                "drawing_write_operations": [],
                "stateful_operations": stateful_operations,
            },
            "warnings": [],
        }

    @app.get("/v1/status", dependencies=[Depends(authenticate)])
    async def status() -> dict[str, object]:
        handle = worker.submit("app.status", {})
        result = await await_worker(handle, 5, 10)
        return {
            "ok": True,
            "protocol_version": PROTOCOL_VERSION,
            "worker": worker.snapshot(),
            "data": result.data,
            "warnings": [],
            "meta": {"queued_ms": result.queued_ms, "executed_ms": result.executed_ms},
        }

    @app.post("/v1/execute", dependencies=[Depends(authenticate)])
    async def execute(request: ExecuteRequest) -> dict[str, object]:
        if len(request.model_dump_json().encode("utf-8")) > MAX_REQUEST_BYTES:
            raise BridgeError(
                "REQUEST_TOO_LARGE",
                "CAD bridge request exceeds the 1 MiB limit",
                status_code=413,
            )
        if request.protocol_version != PROTOCOL_VERSION:
            raise BridgeError(
                "PROTOCOL_MISMATCH",
                "CAD bridge protocol does not match this client",
                status_code=409,
            )
        if request.operation not in allowed:
            raise BridgeError("OPERATION_NOT_FOUND", "Requested CAD operation is not available", status_code=404)
        handle = worker.submit(request.operation, dict(request.params))
        result = await await_worker(
            handle,
            request.deadlines.queue_ms / 1000,
            request.deadlines.response_ms / 1000,
        )
        data = dict(result.data)
        raw_warnings = data.pop("warnings", [])
        warnings = (
            [safe_public_message(item) for item in raw_warnings[:100] if isinstance(item, str)]
            if isinstance(raw_warnings, list)
            else []
        )
        return {
            "ok": True,
            "protocol_version": PROTOCOL_VERSION,
            "request_id": request.request_id,
            "data": data,
            "warnings": warnings,
            "meta": {"queued_ms": result.queued_ms, "executed_ms": result.executed_ms},
        }

    return app
