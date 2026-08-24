from __future__ import annotations

import os
import stat
import threading
from pathlib import Path

from fastapi.testclient import TestClient

from xiaoliang_cad_bridge import PROTOCOL_VERSION
from xiaoliang_cad_bridge.api.app import create_app
from xiaoliang_cad_bridge.application.worker import StaWorker
from xiaoliang_cad_bridge.descriptor import (
    BridgeDescriptor,
    SingleInstanceLock,
    read_descriptor,
    write_descriptor,
)


class FakeBackend:
    def execute(self, operation: str, params: dict[str, object]) -> dict[str, object]:
        if operation == "app.status":
            return {"running": False}
        return {
            "operation": operation,
            "params": params,
            "warnings": [r"C:\private\drawing.dwg token=must-not-escape"],
        }


class BlockingBackend:
    def __init__(self, release: threading.Event) -> None:
        self.release = release

    def execute(self, operation: str, _params: dict[str, object]) -> dict[str, object]:
        self.release.wait(timeout=5)
        return {"operation": operation}


def test_descriptor_is_atomic_private_and_single_instance_is_exclusive(tmp_path: Path) -> None:
    descriptor_path = tmp_path / "cad-bridge.json"
    descriptor = BridgeDescriptor.create(49152, tmp_path)
    write_descriptor(descriptor_path, descriptor)

    assert read_descriptor(descriptor_path) == descriptor
    if os.name != "nt":
        assert stat.S_IMODE(descriptor_path.stat().st_mode) == 0o600

    first = SingleInstanceLock(tmp_path / "cad-bridge.lock")
    second = SingleInstanceLock(tmp_path / "cad-bridge.lock")
    first.acquire()
    try:
        try:
            second.acquire()
        except RuntimeError as error:
            assert "single-instance lock" in str(error)
        else:
            raise AssertionError("second lock acquisition should fail")
    finally:
        first.release()


def test_public_health_and_authenticated_v1_envelopes(tmp_path: Path) -> None:
    token = "fixture-token-" * 4
    worker = StaWorker(FakeBackend)
    app = create_app(token, worker, str(tmp_path), {"app.status", "extract.read"})

    with TestClient(app) as client:
        assert client.get("/healthz").json() == {
            "status": "alive",
            "protocol_version": PROTOCOL_VERSION,
            "worker_state": "ready",
        }
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
        unauthorized = client.get("/v1/status")
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"]["code"] == "AUTH_REQUIRED"
        assert token not in unauthorized.text

        headers = {"Authorization": f"Bearer {token}"}
        status_response = client.get("/v1/status", headers=headers)
        assert status_response.status_code == 200
        assert status_response.json()["data"] == {"running": False}

        capabilities = client.get("/v1/capabilities", headers=headers).json()
        assert capabilities["data"] == {
            "operations": ["app.status", "extract.read"],
            "drawing_write_operations": [],
            "stateful_operations": [],
        }

        execute_response = client.post(
            "/v1/execute",
            headers=headers,
            json={
                "protocol_version": PROTOCOL_VERSION,
                "request_id": "fixture-1",
                "operation": "extract.read",
                "params": {"handles": ["A1"]},
                "client": {
                    "kind": "xiaoliang-desktop",
                    "child_run_id": "child-fixture-1",
                    "agent_role": "cad-analyst",
                },
            },
        )
        assert execute_response.status_code == 200
        payload = execute_response.json()
        assert payload["protocol_version"] == PROTOCOL_VERSION
        assert payload["request_id"] == "fixture-1"
        assert payload["data"]["params"] == {"handles": ["A1"]}
        assert "C:\\private" not in payload["warnings"][0]
        assert "must-not-escape" not in payload["warnings"][0]

        unknown = client.post(
            "/v1/execute",
            headers=headers,
            json={
                "protocol_version": PROTOCOL_VERSION,
                "request_id": "unknown-1",
                "operation": "capture.plot",
                "params": {},
            },
        )
        assert unknown.status_code == 404
        assert unknown.json()["error"]["code"] == "OPERATION_NOT_FOUND"

        mismatch = client.post(
            "/v1/execute",
            headers=headers,
            json={
                "protocol_version": PROTOCOL_VERSION + 1,
                "request_id": "mismatch-1",
                "operation": "extract.read",
                "params": {},
            },
        )
        assert mismatch.status_code == 409
        assert mismatch.json()["error"]["code"] == "PROTOCOL_MISMATCH"

        invalid = client.post(
            "/v1/execute",
            headers=headers,
            json={
                "protocol_version": PROTOCOL_VERSION,
                "request_id": "invalid-1",
                "operation": "extract.read",
                "params": {},
                "unexpected": True,
            },
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["code"] == "INVALID_ARGUMENT"

        oversized = client.post(
            "/v1/execute",
            headers={**headers, "Content-Length": str(2 * 1024 * 1024)},
            content=b"{}",
        )
        assert oversized.status_code == 413
        assert oversized.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_health_reports_busy_without_waiting_for_sta(tmp_path: Path) -> None:
    token = "fixture-token-" * 4
    release = threading.Event()
    worker = StaWorker(lambda: BlockingBackend(release))
    app = create_app(token, worker, str(tmp_path), {"app.status"})

    with TestClient(app) as client:
        handle = worker.submit("app.status", {})
        handle.started.result(timeout=2)
        try:
            response = client.get("/healthz")
            assert response.status_code == 200
            assert response.json()["worker_state"] == "busy"
        finally:
            release.set()
        assert handle.result.result(timeout=2).data == {"operation": "app.status"}
