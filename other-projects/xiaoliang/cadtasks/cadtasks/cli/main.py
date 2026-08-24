from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any, Mapping

from cadkernel.contracts import stable_json_dumps, stable_json_loads

from cadtasks.agentview import export_task_store, highlights_payload, write_menu
from cadtasks.binding import ProjectBinding
from cadtasks.ports import StructuredTaskCompiler
from cadtasks.runtime import TaskRuntime
from cadtasks.storage import TaskStore


def _mapping(path: str | Path) -> Mapping[str, Any]:
    value = stable_json_loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, Mapping):
        raise TypeError(f"JSON root must be an object: {path}")
    return value


def _menu(args: argparse.Namespace) -> int:
    binding = ProjectBinding.load(args.binding)
    menu = write_menu(binding, args.out)
    print(menu.to_json(pretty=True))
    return 0


def _run(args: argparse.Namespace) -> int:
    binding = ProjectBinding.load(args.binding)
    compilation = StructuredTaskCompiler().compile(
        _mapping(args.request),
        default_project_id=binding.project_id,
    )
    if not compilation.complete or compilation.spec is None:
        print(
            stable_json_dumps(
                {
                    "status": "invalid_request",
                    "missing_slots": compilation.missing_slots,
                    "ambiguities": compilation.ambiguities,
                },
                pretty=True,
            ),
            file=sys.stderr,
        )
        return 2
    result = TaskRuntime().run(
        binding,
        compilation.spec,
        output_root=args.output,
    )
    print(
        stable_json_dumps(
            {
                "task_run_id": result.bundle.task_run_id,
                "status": result.bundle.status.value,
                "path": None if result.location is None else result.location.path,
                "claim_count": len(result.bundle.claims),
                "issue_count": len(result.bundle.issues),
                "gap_count": len(result.bundle.gaps),
            },
            pretty=True,
        )
    )
    return 0


def _export(args: argparse.Namespace) -> int:
    path = export_task_store(args.store, args.out)
    print(str(path))
    return 0


def _highlights(args: argparse.Namespace) -> int:
    bundle = TaskStore.load(args.store)
    print(stable_json_dumps(highlights_payload(bundle), pretty=args.pretty))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cadtasks",
        description="Compile and run deterministic evidence-grounded CAD tasks.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    menu = subparsers.add_parser("menu", help="Export project capability menu")
    menu.add_argument("binding")
    menu.add_argument("--out", required=True)
    menu.set_defaults(function=_menu)

    run = subparsers.add_parser("run", help="Run a structured task request")
    run.add_argument("binding")
    run.add_argument("request")
    run.add_argument("--output", required=True)
    run.set_defaults(function=_run)

    export = subparsers.add_parser("export", help="Export a TaskStore for agents")
    export.add_argument("store")
    export.add_argument("--out", required=True)
    export.set_defaults(function=_export)

    highlights = subparsers.add_parser(
        "highlights", help="Print source highlight payload"
    )
    highlights.add_argument("store")
    highlights.add_argument("--pretty", action="store_true")
    highlights.set_defaults(function=_highlights)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.function(args))
    except (KeyError, LookupError, OSError, TypeError, ValueError) as error:
        parser.exit(1, f"cadtasks: {error}\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

