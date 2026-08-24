"""CAD worker entrypoint with selectable backend.

Backends:
  - billnova (default): adapter over CADClaw BillNova cad-bridge snapshot
  - legacy            : existing in-file COM implementation (rollback only)
"""

from __future__ import annotations

import os
import sys


def _resolve_backend() -> str:
    raw = os.environ.get("CAD_BRIDGE_BACKEND", "billnova").strip().lower()
    if raw in ("legacy", "billnova"):
        return raw
    return "billnova"


def main() -> None:
    backend = _resolve_backend()
    if backend == "billnova":
        from cad_worker_billnova import main as backend_main
    else:
        from cad_worker_legacy import main as backend_main
    backend_main()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - process-level guard
        sys.stderr.write(f"[cad-worker] fatal: {exc}\n")
        raise
