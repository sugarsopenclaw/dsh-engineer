"""唯一 STA worker 与有界 FIFO 队列。"""

from __future__ import annotations

import queue
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass, field
from typing import Protocol

try:
    import pythoncom
except ModuleNotFoundError:
    pythoncom = None

from xiaoliang_cad_bridge.errors import BridgeError, RPC_E_CALL_REJECTED, error_hresult, safe_error_message


MAX_BUSY_RETRIES = 3
BUSY_RETRY_SECONDS = 0.5


class OperationBackend(Protocol):
    def execute(self, operation: str, params: dict[str, object]) -> dict[str, object]: ...


@dataclass(frozen=True)
class WorkerResult:
    data: dict[str, object]
    queued_ms: int
    executed_ms: int


@dataclass
class WorkControl:
    lock: threading.Lock = field(default_factory=threading.Lock)
    claimed: bool = False
    cancelled: bool = False

    def cancel_if_queued(self) -> bool:
        with self.lock:
            if self.claimed:
                return False
            self.cancelled = True
            return True

    def claim(self) -> bool:
        with self.lock:
            if self.cancelled:
                return False
            self.claimed = True
            return True


@dataclass(frozen=True)
class WorkHandle:
    started: Future[None]
    result: Future[WorkerResult]
    control: WorkControl

    def cancel_if_queued(self) -> bool:
        return self.control.cancel_if_queued()


@dataclass
class WorkItem:
    operation: str
    params: dict[str, object]
    queued_at: float
    started: Future[None]
    result: Future[WorkerResult]
    control: WorkControl


class StaWorker:
    def __init__(self, backend_factory: Callable[[], OperationBackend], queue_size: int = 32) -> None:
        if queue_size < 1 or queue_size > 1024:
            raise ValueError("STA worker queue size must be between 1 and 1024")
        self.backend_factory = backend_factory
        self.queue: queue.Queue[WorkItem | None] = queue.Queue(maxsize=queue_size)
        self.thread: threading.Thread | None = None
        self.ready = threading.Event()
        self.stopping = threading.Event()
        self.executing = threading.Event()
        self.initialization_error: str | None = None

    @property
    def degraded(self) -> bool:
        return self.initialization_error is not None or (
            self.thread is not None and not self.thread.is_alive() and not self.stopping.is_set()
        )

    def start(self) -> None:
        if self.thread is not None and self.thread.is_alive():
            return
        self.stopping.clear()
        self.ready.clear()
        self.executing.clear()
        self.initialization_error = None
        self.thread = threading.Thread(target=self._run, name="xiaoliang-cad-bridge-sta", daemon=True)
        self.thread.start()
        if not self.ready.wait(timeout=10):
            raise RuntimeError("CAD STA worker did not initialize")
        if self.initialization_error:
            raise RuntimeError(self.initialization_error)

    def submit(self, operation: str, params: dict[str, object]) -> WorkHandle:
        if self.stopping.is_set():
            raise BridgeError("BRIDGE_STOPPING", "CAD bridge is stopping", status_code=409)
        if self.degraded or self.thread is None or not self.thread.is_alive():
            raise BridgeError("WORKER_UNAVAILABLE", "CAD STA worker is unavailable", status_code=503, retryable=True)
        started: Future[None] = Future()
        result: Future[WorkerResult] = Future()
        control = WorkControl()
        item = WorkItem(operation, params, time.monotonic(), started, result, control)
        try:
            self.queue.put_nowait(item)
        except queue.Full:
            raise BridgeError("QUEUE_FULL", "CAD operation queue is full", status_code=429, retryable=True) from None
        return WorkHandle(started, result, control)

    def stop(self, timeout: float = 10) -> None:
        thread = self.thread
        if thread is None:
            return
        self.stopping.set()
        stopping_error = BridgeError(
            "BRIDGE_STOPPING",
            "Bridge stopped before the queued operation ran",
            status_code=409,
        )
        while True:
            try:
                item = self.queue.get_nowait()
            except queue.Empty:
                break
            try:
                if item is not None:
                    if not item.started.done():
                        item.started.set_exception(stopping_error)
                    if not item.result.done():
                        item.result.set_exception(stopping_error)
            finally:
                self.queue.task_done()
        self.queue.put_nowait(None)
        thread.join(timeout=timeout)
        if thread.is_alive():
            self.initialization_error = "CAD STA worker did not stop before its deadline"
            return
        self.thread = None

    def snapshot(self) -> dict[str, object]:
        state = "degraded" if self.degraded else "busy" if self.executing.is_set() else "ready"
        return {
            "state": state,
            "queue_depth": self.queue.qsize(),
            "queue_capacity": self.queue.maxsize,
            "thread_alive": bool(self.thread and self.thread.is_alive()),
        }

    def _run(self) -> None:
        backend: OperationBackend | None = None
        initialized_com = False
        try:
            if pythoncom is not None:
                pythoncom.CoInitialize()
                initialized_com = True
            backend = self.backend_factory()
        except Exception as error:
            self.initialization_error = safe_error_message(error)
        finally:
            self.ready.set()
        if backend is None:
            if initialized_com:
                pythoncom.CoUninitialize()
            return
        try:
            while True:
                item = self.queue.get()
                try:
                    if item is None:
                        return
                    if not item.control.claim():
                        cancelled = BridgeError(
                            "QUEUE_TIMEOUT",
                            "CAD operation expired before leaving the queue",
                            status_code=504,
                        )
                        if not item.started.done():
                            item.started.set_exception(cancelled)
                        if not item.result.done():
                            item.result.set_exception(cancelled)
                        continue
                    self.executing.set()
                    if not item.started.done():
                        item.started.set_result(None)
                    started_at = time.monotonic()
                    queued_ms = max(0, round((started_at - item.queued_at) * 1000))
                    data = self._execute_with_busy_retry(backend, item.operation, item.params)
                    if not item.result.done():
                        item.result.set_result(
                            WorkerResult(
                                data=data,
                                queued_ms=queued_ms,
                                executed_ms=max(0, round((time.monotonic() - started_at) * 1000)),
                            )
                        )
                except Exception as error:
                    if item is not None and not item.result.done():
                        item.result.set_exception(error)
                finally:
                    self.executing.clear()
                    self.queue.task_done()
        finally:
            if initialized_com:
                pythoncom.CoUninitialize()

    @staticmethod
    def _execute_with_busy_retry(
        backend: OperationBackend,
        operation: str,
        params: dict[str, object],
    ) -> dict[str, object]:
        for attempt in range(MAX_BUSY_RETRIES + 1):
            try:
                return backend.execute(operation, params)
            except BridgeError:
                raise
            except Exception as error:
                if error_hresult(error) == RPC_E_CALL_REJECTED:
                    if attempt < MAX_BUSY_RETRIES:
                        time.sleep(BUSY_RETRY_SECONDS)
                        continue
                    raise BridgeError(
                        "CAD_BUSY",
                        "AutoCAD rejected the operation after three retries",
                        status_code=503,
                        retryable=True,
                    ) from None
                raise BridgeError(
                    "INTERNAL_ERROR",
                    "CAD bridge operation failed unexpectedly",
                    status_code=500,
                ) from None
        raise BridgeError("INTERNAL_ERROR", "unreachable worker state", status_code=500)
