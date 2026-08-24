from __future__ import annotations

import argparse
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

from cadkernel.contracts import stable_json_dumps

from cadsemantics.agentview import (
    export_text_tree,
    semantic_evidence_packet,
    similar_representations,
)
from cadsemantics.contracts import RepresentationMode, SemanticStatus
from cadsemantics.coverage import semantic_coverage_report
from cadsemantics.runtime import SemanticRuntime
from cadsemantics.storage import SemanticStore


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cadsemantics",
        description="Build and inspect evidence-grounded semantic graphs.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="build and persist drawing/project semantic graphs")
    build.add_argument("snapshot", type=Path)
    build.add_argument("patterns", type=Path)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--project-id")

    query = commands.add_parser("query", help="query persisted semantic representations")
    query.add_argument("store", type=Path)
    query.add_argument("--class", dest="class_id")
    query.add_argument("--status", choices=tuple(item.value for item in SemanticStatus))
    query.add_argument("--mode", choices=tuple(item.value for item in RepresentationMode))
    query.add_argument("--bounds", nargs=4, type=float, metavar=("MIN_X", "MIN_Y", "MAX_X", "MAX_Y"))
    query.add_argument("--pretty", action="store_true")

    report = commands.add_parser("report", help="emit SemanticCoverageReport")
    report.add_argument("store", type=Path)
    report.add_argument("--pretty", action="store_true")

    export = commands.add_parser("export", help="write a grep-friendly semantic text tree")
    export.add_argument("store", type=Path)
    export.add_argument("--out", type=Path, required=True)

    packet = commands.add_parser("packet", help="emit one Semantic Evidence Packet")
    packet.add_argument("store", type=Path)
    packet.add_argument("--representation", required=True)
    packet.add_argument("--pretty", action="store_true")

    similar = commands.add_parser("similar", help="query same-signature representations")
    similar.add_argument("store", type=Path)
    similar.add_argument("--representation", required=True)
    similar.add_argument("--pretty", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "build":
        result = SemanticRuntime().build_and_store(
            args.snapshot,
            args.patterns,
            args.output,
            project_id=args.project_id,
        )
        print(
            stable_json_dumps(
                {
                    "drawing_semantic_graph_id": result.drawing_graph.drawing_semantic_graph_id,
                    "project_semantic_graph_id": result.project_graph.project_semantic_graph_id,
                    "path": result.location.path if result.location is not None else None,
                    "snapshot_id": result.drawing_graph.snapshot_id,
                    "pattern_graph_id": result.drawing_graph.pattern_graph_id,
                },
                pretty=True,
            )
        )
        return 0
    if args.command == "query":
        values = SemanticStore.query(
            args.store,
            class_id=args.class_id,
            status=None if args.status is None else SemanticStatus(args.status),
            representation_mode=None if args.mode is None else RepresentationMode(args.mode),
            bounds=None if args.bounds is None else tuple(args.bounds),
        )
        print(stable_json_dumps(values, pretty=args.pretty))
        return 0
    bundle = SemanticStore.load(args.store)
    if args.command == "report":
        print(
            stable_json_dumps(
                asdict(semantic_coverage_report(bundle.drawing_graph, bundle.project_graph)),
                pretty=args.pretty,
            )
        )
        return 0
    if args.command == "export":
        path = export_text_tree(bundle, args.out)
        print(stable_json_dumps({"path": str(path.resolve())}, pretty=True))
        return 0
    if args.command == "packet":
        print(stable_json_dumps(semantic_evidence_packet(bundle, args.representation), pretty=args.pretty))
        return 0
    print(stable_json_dumps(similar_representations(bundle, args.representation), pretty=args.pretty))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
