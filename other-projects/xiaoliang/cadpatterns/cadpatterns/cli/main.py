from __future__ import annotations

import argparse
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

from cadkernel.contracts import stable_json_dumps

from cadpatterns.contracts import PatternStatus
from cadpatterns.evaluation import candidate_distribution
from cadpatterns.ontology import load_specs
from cadpatterns.runtime import PatternRuntime
from cadpatterns.storage import PatternStore


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cadpatterns",
        description="Build and inspect deterministic generic PatternGraphs.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="build and persist a PatternGraph")
    build.add_argument("snapshot", type=Path)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--spec", action="append", type=Path)

    query = commands.add_parser("query", help="query persisted pattern instances")
    query.add_argument("store", type=Path)
    query.add_argument("--type", dest="pattern_type")
    query.add_argument("--status", choices=tuple(item.value for item in PatternStatus))
    query.add_argument("--bounds", nargs=4, type=float, metavar=("MIN_X", "MIN_Y", "MAX_X", "MAX_Y"))
    query.add_argument(
        "--signature-of",
        metavar="DETECTION_ID",
        help="return every instance with the selected detection's scale-free geometry signature",
    )
    query.add_argument("--pretty", action="store_true")

    report = commands.add_parser("report", help="emit an unlabelled candidate distribution")
    report.add_argument("store", type=Path)
    report.add_argument("--pretty", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "build":
        runtime = PatternRuntime(specs=load_specs(args.spec) if args.spec else None)
        result = runtime.build_and_store(args.snapshot, args.output)
        print(
            stable_json_dumps(
                {
                    "pattern_graph_id": result.graph.pattern_graph_id,
                    "path": result.location.path if result.location else None,
                    "snapshot_id": result.graph.snapshot_id,
                },
                pretty=True,
            )
        )
        return 0
    if args.command == "query":
        status = None if args.status is None else PatternStatus(args.status)
        if args.signature_of is not None:
            values = PatternStore.query_signature(args.store, args.signature_of)
        elif args.bounds is None:
            values = PatternStore.query(
                args.store,
                pattern_type=args.pattern_type,
                status=status,
            )
        else:
            values = PatternStore.query_region(
                args.store,
                tuple(args.bounds),
                pattern_type=args.pattern_type,
                status=status,
            )
        if args.signature_of is not None:
            values = tuple(
                item
                for item in values
                if (args.pattern_type is None or item.pattern_type == args.pattern_type)
                and (status is None or item.status is status)
                and (
                    args.bounds is None
                    or item.bounds is not None
                    and item.bounds[0] <= args.bounds[2]
                    and item.bounds[2] >= args.bounds[0]
                    and item.bounds[1] <= args.bounds[3]
                    and item.bounds[3] >= args.bounds[1]
                )
            )
        print(stable_json_dumps(values, pretty=args.pretty))
        return 0
    graph = PatternStore.load(args.store)
    distribution = candidate_distribution(graph)
    print(stable_json_dumps(asdict(distribution), pretty=args.pretty))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
