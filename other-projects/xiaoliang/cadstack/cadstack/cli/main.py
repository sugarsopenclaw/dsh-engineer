from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Callable, Sequence

from cadstack.ask import ask_project
from cadstack.bind import bind_project
from cadstack.build import build_drawing
from cadstack.ingest import ingest_drawing
from cadstack.layout import FactsLayout
from cadstack.lookup import lookup_drawing, probe_drawing
from cadstack.state import record_failure
from cadstack.status import project_status


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cadstack",
        description="Build and query the project-local four-layer CAD facts interface.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    ingest = commands.add_parser("ingest", help="DXF to persisted L1 facts")
    ingest.add_argument("--project-root", type=Path, required=True)
    ingest.add_argument("--drawing-key", required=True)
    ingest.add_argument("--dxf", type=Path, required=True)
    ingest.add_argument("--logical-source", required=True)
    ingest.add_argument("--mlight-index", type=Path)

    build = commands.add_parser("build", help="build persisted L2 and L3 facts")
    build.add_argument("--project-root", type=Path, required=True)
    build.add_argument("--drawing-key", required=True)

    bind = commands.add_parser("bind", help="refresh ProjectBinding and task menu")
    bind.add_argument("--project-root", type=Path, required=True)

    status = commands.add_parser("status", help="verify project/drawing facts status")
    status.add_argument("--project-root", type=Path, required=True)
    status.add_argument("--drawing-key")

    ask = commands.add_parser("ask", help="compile and run a structured task request")
    ask.add_argument("--project-root", type=Path, required=True)
    ask.add_argument("--request", type=Path, required=True)

    lookup = commands.add_parser("lookup", help="query L3 and supporting L1 evidence")
    lookup.add_argument("--project-root", type=Path, required=True)
    lookup.add_argument("--drawing-key", required=True)
    lookup.add_argument("--class", dest="class_id")
    lookup.add_argument(
        "--bounds",
        type=float,
        nargs=4,
        metavar=("MIN_X", "MIN_Y", "MAX_X", "MAX_Y"),
    )
    lookup.add_argument("--representation")
    lookup.add_argument("--text")
    lookup.add_argument("--limit", type=int, default=50)

    probe = commands.add_parser("probe", help="query one direct L1 index")
    probe.add_argument("--project-root", type=Path, required=True)
    probe.add_argument("--drawing-key", required=True)
    modes = probe.add_mutually_exclusive_group(required=True)
    modes.add_argument("--bbox", type=float, nargs=4, metavar=("MIN_X", "MIN_Y", "MAX_X", "MAX_Y"))
    modes.add_argument("--text")
    modes.add_argument("--faces", type=float, nargs=4, metavar=("MIN_X", "MIN_Y", "MAX_X", "MAX_Y"))
    modes.add_argument("--endpoint", type=float, nargs=2, metavar=("X", "Y"))
    probe.add_argument("--radius", type=float)
    probe.add_argument("--limit", type=int, default=50)
    return parser


def _execute(args: argparse.Namespace) -> dict[str, Any]:
    common = {"project_root": args.project_root}
    if args.command == "ingest":
        return ingest_drawing(
            **common,
            drawing_key=args.drawing_key,
            dxf=args.dxf,
            logical_source=args.logical_source,
            mlight_index=args.mlight_index,
        )
    if args.command == "build":
        return build_drawing(**common, drawing_key=args.drawing_key)
    if args.command == "bind":
        return bind_project(**common)
    if args.command == "status":
        return project_status(**common, drawing_key=args.drawing_key)
    if args.command == "ask":
        return ask_project(**common, request_path=args.request)
    if args.command == "lookup":
        return lookup_drawing(
            **common,
            drawing_key=args.drawing_key,
            class_id=args.class_id,
            bounds=None if args.bounds is None else tuple(args.bounds),
            representation=args.representation,
            text=args.text,
            limit=args.limit,
        )
    return probe_drawing(
        **common,
        drawing_key=args.drawing_key,
        bbox=None if args.bbox is None else tuple(args.bbox),
        text=args.text,
        faces=None if args.faces is None else tuple(args.faces),
        endpoint=None if args.endpoint is None else tuple(args.endpoint),
        radius=args.radius,
        limit=args.limit,
    )


def _failure_stage(command: str) -> str | None:
    return {
        "ingest": "l1",
    }.get(command)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = _execute(args)
        payload = {"ok": True, "command": args.command, **result}
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 0
    except Exception as error:
        stage = _failure_stage(args.command)
        drawing_key = getattr(args, "drawing_key", None)
        if stage is not None and isinstance(drawing_key, str):
            try:
                layout = FactsLayout.from_project_root(args.project_root)
                record_failure(layout, drawing_key, stage, error)
            except Exception:
                pass
        payload = {
            "ok": False,
            "command": args.command,
            "error": {
                "type": type(error).__name__,
                "message": str(error),
            },
        }
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
