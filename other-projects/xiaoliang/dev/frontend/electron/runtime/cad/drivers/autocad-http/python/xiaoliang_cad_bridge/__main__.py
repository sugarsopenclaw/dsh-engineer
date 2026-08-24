"""xiaoliang-cad-bridge 进程入口。"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import socket
from pathlib import Path

import uvicorn

from xiaoliang_cad_bridge.api.app import create_app
from xiaoliang_cad_bridge.application.worker import StaWorker
from xiaoliang_cad_bridge.descriptor import (
    BridgeDescriptor,
    SingleInstanceLock,
    default_descriptor_path,
    default_lock_path,
    remove_owned_descriptor,
    write_descriptor,
)
from xiaoliang_cad_bridge.infrastructure.autocad import AutoCadOperations, PUBLIC_OPERATIONS
from xiaoliang_cad_bridge.infrastructure.autocad.plot import inspect_plot_environment
from xiaoliang_cad_bridge.paths import resolved_project_root


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the authenticated Xiaoliang AutoCAD bridge")
    parser.add_argument("--project-root")
    parser.add_argument("--descriptor", type=Path, default=default_descriptor_path())
    parser.add_argument("--lock", type=Path, default=default_lock_path())
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--self-check", action="store_true")
    return parser.parse_args()


def self_check() -> bool:
    plot = inspect_plot_environment(None)
    dependencies = plot["dependencies"]
    assert isinstance(dependencies, dict)
    required_operations = {"app.doctor", "app.status", "capture.plot"}
    report = {
        "ok": all(dependencies.values()) and required_operations.issubset(PUBLIC_OPERATIONS),
        "dependencies": dependencies,
        "required_operations": sorted(required_operations),
        "operations_present": sorted(required_operations.intersection(PUBLIC_OPERATIONS)),
    }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    return bool(report["ok"])


async def serve(project_root: Path, descriptor_path: Path, lock_path: Path, port: int) -> None:
    with SingleInstanceLock(lock_path):
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", port))
        listener.listen(128)
        selected_port = listener.getsockname()[1]
        descriptor = BridgeDescriptor.create(selected_port, project_root)
        worker = StaWorker(lambda: AutoCadOperations(project_root), queue_size=32)
        app = create_app(descriptor.token, worker, str(project_root), PUBLIC_OPERATIONS)
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=selected_port,
            workers=1,
            log_level="warning",
            access_log=False,
        )
        server = uvicorn.Server(config)
        handled_signals = [signal.SIGINT, signal.SIGTERM]
        if hasattr(signal, "SIGBREAK"):
            handled_signals.append(signal.SIGBREAK)
        previous_handlers: dict[int, object] = {}

        def preserve_outer_cleanup(_signum: int, _frame: object) -> None:
            # Uvicorn re-emits captured signals after restoring the previous
            # handler. A non-terminating outer handler lets our descriptor
            # cleanup run before the OS default handler is restored.
            server.should_exit = True

        for handled_signal in handled_signals:
            previous_handlers[int(handled_signal)] = signal.signal(
                handled_signal,
                preserve_outer_cleanup,
            )
        write_descriptor(descriptor_path, descriptor)
        try:
            await server.serve(sockets=[listener])
        finally:
            listener.close()
            remove_owned_descriptor(descriptor_path, os.getpid())
            for handled_signal in handled_signals:
                signal.signal(handled_signal, previous_handlers[int(handled_signal)])


def main() -> None:
    options = arguments()
    if options.self_check:
        raise SystemExit(0 if self_check() else 2)
    if not options.project_root:
        raise SystemExit("--project-root is required unless --self-check is used")
    project_root = resolved_project_root(options.project_root)
    if not 0 <= options.port <= 65535:
        raise SystemExit("--port must be between 0 and 65535")
    asyncio.run(
        serve(
            project_root,
            options.descriptor.expanduser(),
            options.lock.expanduser(),
            options.port,
        )
    )


if __name__ == "__main__":
    main()
