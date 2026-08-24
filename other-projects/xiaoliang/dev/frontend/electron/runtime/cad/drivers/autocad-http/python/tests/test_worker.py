from __future__ import annotations

import asyncio
import threading

import pytest

from xiaoliang_cad_bridge.application import worker as worker_module
from xiaoliang_cad_bridge.application.worker import StaWorker, WorkControl
from xiaoliang_cad_bridge.api.app import await_worker
from xiaoliang_cad_bridge.errors import BridgeError, RPC_E_CALL_REJECTED


class BlockingBackend:
    def __init__(self, release: threading.Event) -> None:
        self.release = release
        self.calls: list[str] = []

    def execute(self, operation: str, params: dict[str, object]) -> dict[str, object]:
        self.calls.append(operation)
        self.release.wait(timeout=5)
        return {"operation": operation, "params": params}


class BusyError(Exception):
    hresult = RPC_E_CALL_REJECTED


class BusyBackend:
    def __init__(self) -> None:
        self.calls = 0

    def execute(self, _operation: str, _params: dict[str, object]) -> dict[str, object]:
        self.calls += 1
        raise BusyError("busy")


def test_queue_cancellation_and_sta_claim_are_atomic() -> None:
    cancelled = WorkControl()
    assert cancelled.cancel_if_queued() is True
    assert cancelled.claim() is False

    claimed = WorkControl()
    assert claimed.claim() is True
    assert claimed.cancel_if_queued() is False


def test_worker_is_bounded_serial_and_confined_to_one_sta_thread() -> None:
    release = threading.Event()
    factory_thread: list[int] = []
    execute_threads: list[int] = []
    backend = BlockingBackend(release)

    def factory() -> BlockingBackend:
        factory_thread.append(threading.get_ident())
        original = backend.execute

        def execute(operation: str, params: dict[str, object]) -> dict[str, object]:
            execute_threads.append(threading.get_ident())
            return original(operation, params)

        backend.execute = execute  # type: ignore[method-assign]
        return backend

    worker = StaWorker(factory, queue_size=1)
    worker.start()
    try:
        running = worker.submit("app.status", {})
        running.started.result(timeout=2)
        assert worker.snapshot()["state"] == "busy"
        queued = worker.submit("doc.list", {})
        with pytest.raises(BridgeError) as error:
            worker.submit("extract.read", {})
        assert error.value.code == "QUEUE_FULL"
        release.set()
        assert running.result.result(timeout=2).data["operation"] == "app.status"
        assert queued.result.result(timeout=2).data["operation"] == "doc.list"
        worker.queue.join()
        assert worker.snapshot()["state"] == "ready"
        assert factory_thread == execute_threads[:1]
        assert len(set(execute_threads)) == 1
        assert execute_threads[0] != threading.get_ident()
    finally:
        release.set()
        worker.stop()


def test_queued_work_can_expire_without_later_touching_com() -> None:
    release = threading.Event()
    backend = BlockingBackend(release)
    worker = StaWorker(lambda: backend, queue_size=2)
    worker.start()
    try:
        running = worker.submit("app.status", {})
        running.started.result(timeout=2)
        expired = worker.submit("doc.list", {})
        assert expired.cancel_if_queued() is True
        release.set()
        running.result.result(timeout=2)
        with pytest.raises(BridgeError) as error:
            expired.result.result(timeout=2)
        assert error.value.code == "QUEUE_TIMEOUT"
        assert backend.calls == ["app.status"]
    finally:
        release.set()
        worker.stop()


def test_queue_deadline_cancels_only_work_that_has_not_reached_sta() -> None:
    release = threading.Event()
    backend = BlockingBackend(release)
    worker = StaWorker(lambda: backend, queue_size=2)
    worker.start()
    try:
        running = worker.submit("app.status", {})
        running.started.result(timeout=2)
        queued = worker.submit("doc.list", {})
        with pytest.raises(BridgeError) as error:
            asyncio.run(await_worker(queued, 0.001, 1))
        assert error.value.code == "QUEUE_TIMEOUT"
        release.set()
        running.result.result(timeout=2)
        with pytest.raises(BridgeError):
            queued.result.result(timeout=2)
        assert backend.calls == ["app.status"]
    finally:
        release.set()
        worker.stop()


def test_response_deadline_does_not_kill_running_com_work() -> None:
    release = threading.Event()
    backend = BlockingBackend(release)
    worker = StaWorker(lambda: backend)
    worker.start()
    try:
        running = worker.submit("extract.read", {})
        with pytest.raises(BridgeError) as error:
            asyncio.run(await_worker(running, 1, 0.001))
        assert error.value.code == "RESPONSE_TIMEOUT"
        assert worker.snapshot()["state"] == "busy"
        release.set()
        assert running.result.result(timeout=2).data["operation"] == "extract.read"
    finally:
        release.set()
        worker.stop()


def test_busy_retry_is_three_times_500ms(monkeypatch: pytest.MonkeyPatch) -> None:
    backend = BusyBackend()
    sleeps: list[float] = []
    monkeypatch.setattr(worker_module.time, "sleep", sleeps.append)
    with pytest.raises(BridgeError) as error:
        StaWorker._execute_with_busy_retry(backend, "app.status", {})
    assert error.value.code == "CAD_BUSY"
    assert error.value.retryable is True
    assert backend.calls == 4
    assert sleeps == [0.5, 0.5, 0.5]
