from __future__ import annotations

import asyncio
from time import perf_counter

from pydantic import BaseModel

from shenbian_api.application.ports import DependencyProbe


class DependencyStatus(BaseModel):
    name: str
    status: str
    latency_ms: float
    error_type: str | None = None


class ReadinessResult(BaseModel):
    status: str
    dependencies: list[DependencyStatus]


class ReadinessService:
    def __init__(self, probes: list[DependencyProbe], timeout_seconds: float = 5.0) -> None:
        self._probes = probes
        self._timeout_seconds = timeout_seconds

    async def check(self) -> ReadinessResult:
        dependencies = await asyncio.gather(*(self._check_one(probe) for probe in self._probes))
        ready = all(item.status == "ok" for item in dependencies)
        return ReadinessResult(
            status="ready" if ready else "not_ready",
            dependencies=dependencies,
        )

    async def close(self) -> None:
        await asyncio.gather(*(probe.close() for probe in self._probes))

    async def _check_one(self, probe: DependencyProbe) -> DependencyStatus:
        started = perf_counter()
        try:
            await asyncio.wait_for(probe.check(), timeout=self._timeout_seconds)
        except Exception as exc:  # boundary: expose only the exception type
            return DependencyStatus(
                name=probe.name,
                status="error",
                latency_ms=round((perf_counter() - started) * 1000, 2),
                error_type=type(exc).__name__,
            )
        return DependencyStatus(
            name=probe.name,
            status="ok",
            latency_ms=round((perf_counter() - started) * 1000, 2),
        )
