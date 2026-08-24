#!/usr/bin/env python3
"""Quick diagnostics for CAD text-plus search.

Usage:
  python diagnose_find_plus.py --patterns DJP10 独立基础 做法示意
  python diagnose_find_plus.py --patterns DJP10 --plot-first
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import queue
from pathlib import Path
from typing import Any, Dict, List, Optional


THIS_DIR = Path(__file__).resolve().parent


def _safe_print(value: Any) -> None:
    text = str(value).encode("utf-8", "replace").decode("utf-8", "replace")
    sys.stdout.buffer.write(text.encode("utf-8", "replace") + b"\n")
    sys.stdout.buffer.flush()


class WorkerClient:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, "cad_worker.py"],
            cwd=str(THIS_DIR),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._queue: "queue.Queue[str]" = queue.Queue()
        self._next_id = 1
        threading.Thread(target=self._reader, daemon=True).start()
        self.ready = self._read(timeout=15)

    def _reader(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            self._queue.put(line)

    def _read(self, timeout: int) -> Optional[Dict[str, Any]]:
        try:
            line = self._queue.get(timeout=timeout).strip()
        except queue.Empty:
            return None
        return json.loads(line)

    def call(self, method: str, params: Dict[str, Any], timeout: int = 45) -> Dict[str, Any]:
        req_id = self._next_id
        self._next_id += 1
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps({
            "id": req_id,
            "method": method,
            "params": params,
        }, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        response = self._read(timeout=timeout)
        if response is None:
            raise TimeoutError(f"{method} timed out after {timeout}s")
        if "error" in response:
            raise RuntimeError(response["error"].get("message", response["error"]))
        return response.get("result") or {}

    def close(self) -> None:
        try:
            self.proc.kill()
        except Exception:
            pass


def _window_from_bbox(bbox: Optional[Dict[str, Any]], half_size: float = 4200.0) -> Optional[Dict[str, Any]]:
    if not bbox or not isinstance(bbox.get("min"), list) or not isinstance(bbox.get("max"), list):
        return None
    mn = bbox["min"]
    mx = bbox["max"]
    if len(mn) < 2 or len(mx) < 2:
        return None
    cx = (float(mn[0]) + float(mx[0])) / 2
    cy = (float(mn[1]) + float(mx[1])) / 2
    width = max(abs(float(mx[0]) - float(mn[0])) * 7.2, half_size * 10)
    height = max(abs(float(mx[1]) - float(mn[1])) * 36, half_size * 8.5)
    return {
        "min": {"x": round(cx - width / 2, 2), "y": round(cy - height / 2, 2)},
        "max": {"x": round(cx + width / 2, 2), "y": round(cy + height / 2, 2)},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--patterns", nargs="+", default=["DJP10", "独立基础", "做法示意"])
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--max-entities-scanned", type=int, default=5000)
    parser.add_argument("--plot-first", action="store_true")
    args = parser.parse_args()

    client = WorkerClient()
    try:
        summary: Dict[str, Any] = {
            "ready": client.ready,
            "connect": client.call("cad.session.connect", {}),
            "active": client.call("cad.document.getActive", {}),
            "patterns": [],
        }
        for pattern in args.patterns:
            result = client.call("cad.annotations.findTextPlus", {
                "pattern": pattern,
                "limit": args.limit,
                "max_entities_scanned": args.max_entities_scanned,
                "keywords": args.patterns,
            })
            matches = result.get("matches") or []
            compact_matches: List[Dict[str, Any]] = []
            for match in matches[: args.limit]:
                compact_matches.append({
                    "source": match.get("source"),
                    "handle": match.get("handle"),
                    "layer": match.get("layer"),
                    "text": str(match.get("content_clean", "")).replace("\n", " ")[:180],
                    "bbox": match.get("bbox"),
                    "window": _window_from_bbox(match.get("bbox")),
                })
            item: Dict[str, Any] = {
                "pattern": pattern,
                "count": result.get("count"),
                "scanned": result.get("scanned"),
                "source_counts": result.get("source_counts"),
                "matches": compact_matches,
            }
            if args.plot_first and compact_matches and compact_matches[0].get("window"):
                item["plot"] = client.call("cad.view.plotRegion", {
                    "window": compact_matches[0]["window"],
                    "width": 2400,
                    "height": 1600,
                    "dpi": 260,
                    "variant": "both",
                    "profile": "detail",
                    "fit_mode": "max",
                    "keep_diagnostics": True,
                }, timeout=90)
            summary["patterns"].append(item)
        _safe_print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
