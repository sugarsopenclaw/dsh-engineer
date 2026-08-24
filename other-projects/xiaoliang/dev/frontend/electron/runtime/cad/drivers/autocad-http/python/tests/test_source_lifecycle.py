from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from xiaoliang_cad_bridge import __main__ as bridge_main


def test_packaged_self_check_requires_plot_dependencies_and_operations(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        bridge_main,
        "inspect_plot_environment",
        lambda _acad: {
            "dependencies": {"pywin32": True, "pillow": True, "pdfium": True},
        },
    )
    assert bridge_main.self_check() is True
    report = json.loads(capsys.readouterr().out)
    assert report["ok"] is True
    assert report["operations_present"] == ["app.doctor", "app.status", "capture.plot"]

    monkeypatch.setattr(
        bridge_main,
        "inspect_plot_environment",
        lambda _acad: {
            "dependencies": {"pywin32": True, "pillow": False, "pdfium": True},
        },
    )
    assert bridge_main.self_check() is False


def test_source_bridge_publishes_and_cleans_owned_descriptor(tmp_path: Path) -> None:
    python_root = Path(__file__).resolve().parents[1]
    project_root = tmp_path / "project"
    project_root.mkdir()
    descriptor_path = tmp_path / "cad-bridge.json"
    lock_path = tmp_path / "cad-bridge.lock"
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(python_root)
    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "xiaoliang_cad_bridge",
            "--project-root",
            str(project_root),
            "--descriptor",
            str(descriptor_path),
            "--lock",
            str(lock_path),
        ],
        cwd=project_root,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=creation_flags,
    )
    try:
        deadline = time.monotonic() + 20
        descriptor: dict[str, object] | None = None
        health: dict[str, object] | None = None
        while time.monotonic() < deadline:
            if process.poll() is not None:
                stderr = process.stderr.read() if process.stderr else ""
                raise AssertionError(f"bridge exited during startup: {stderr[:1000]}")
            if descriptor_path.exists():
                try:
                    descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
                    port = int(descriptor["port"])
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=2) as response:
                        health = json.load(response)
                    if health["worker_state"] == "ready":
                        break
                except (OSError, ValueError, KeyError, json.JSONDecodeError):
                    pass
            time.sleep(0.05)
        assert descriptor is not None
        assert health is not None
        assert health["protocol_version"] == 1
        request = urllib.request.Request(
            f"http://127.0.0.1:{int(descriptor['port'])}/v1/capabilities",
            headers={"Authorization": "Bearer " + str(descriptor["token"])},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            capabilities = json.load(response)
        assert capabilities["data"]["drawing_write_operations"] == []
        assert capabilities["data"]["stateful_operations"] == [
            "app.start",
            "app.restart",
            "doc.open",
            "doc.switch",
        ]
    finally:
        if process.poll() is None:
            if os.name == "nt":
                process.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
    assert process.returncode == 0
    assert descriptor_path.exists() is False
