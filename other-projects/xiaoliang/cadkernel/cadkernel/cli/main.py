from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from cadkernel._serialization import stable_json_dumps
from cadkernel.adapters.dxf import (
    AutoCADComConverter,
    CommandDwgConverter,
    ConversionProvenance,
    DxfAdapter,
    DwgConverter,
    convert_dwg,
)
from cadkernel.contracts import PrecisionModel, ToleranceProfile
from cadkernel.coverage import build_capability_report
from cadkernel.indexes import (
    SnapshotStore,
    query_endpoints,
    query_faces,
    query_region,
    search_text,
)
from cadkernel.topology import compile_topology, make_topology_payload


@dataclass(frozen=True, slots=True)
class BuildOutput:
    status: str
    snapshot_id: str
    snapshot_path: str
    snapshot_size_bytes: int
    source_path: str


@dataclass(frozen=True, slots=True)
class ConversionRequiredOutput:
    status: str
    source_path: str
    message: str
    supported_routes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ErrorOutput:
    status: str
    error_type: str
    message: str


@dataclass(frozen=True, slots=True)
class _PreparedDrawing:
    dxf_path: Path
    logical_source_path: Path
    provenance: ConversionProvenance | None


def _tolerance(args: argparse.Namespace) -> ToleranceProfile:
    return ToleranceProfile(
        endpoint_snap=args.endpoint_snap,
        curve_chord_error=args.chord_error,
        max_curve_segment_length=args.max_segment_length,
        profile_name=args.profile_name,
    )


def _precision(args: argparse.Namespace) -> PrecisionModel:
    return PrecisionModel(grid_size=args.grid_size, max_region_span=args.max_region_span)


def _converter(args: argparse.Namespace) -> DwgConverter | None:
    if args.autocad_com:
        return AutoCADComConverter(version=args.converter_version)
    if args.dwg_command_json:
        value = json.loads(args.dwg_command_json)
        if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
            raise ValueError("--dwg-command-json must be a non-empty JSON array of strings")
        return CommandDwgConverter(
            command=tuple(value),
            name=args.converter_name,
            version=args.converter_version,
            coordinate_decimal_places=args.coordinate_decimal_places,
        )
    return None


@contextmanager
def _prepared_drawing(path: Path, args: argparse.Namespace) -> Iterator[_PreparedDrawing | None]:
    if path.suffix.casefold() == ".dxf":
        yield _PreparedDrawing(path, path, None)
        return
    if path.suffix.casefold() != ".dwg":
        raise ValueError("Drawing must have a .dxf or .dwg suffix")
    converter = _converter(args)
    if converter is None:
        yield None
        return
    with tempfile.TemporaryDirectory(prefix="cadkernel-dwg-conversion-") as temporary:
        target = Path(temporary) / f"{path.stem}.dxf"
        result = convert_dwg(path, target, converter)
        yield _PreparedDrawing(target, path, result.provenance)


def _conversion_required(path: Path) -> ConversionRequiredOutput:
    return ConversionRequiredOutput(
        status="conversion_required",
        source_path=str(path.resolve()),
        message="DWG is not parsed implicitly. Select AutoCAD COM SaveAs or an explicit command converter.",
        supported_routes=("--autocad-com", "--dwg-command-json"),
    )


def _add_precision_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--grid-size", type=float, default=1e-3)
    parser.add_argument("--max-region-span", type=float, default=1e6)
    parser.add_argument("--endpoint-snap", type=float, default=1e-3)
    parser.add_argument("--chord-error", type=float, default=1e-2)
    parser.add_argument("--max-segment-length", type=float, default=100.0)
    parser.add_argument("--profile-name", default="normal")


def _add_converter_options(parser: argparse.ArgumentParser) -> None:
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--autocad-com", action="store_true")
    group.add_argument(
        "--dwg-command-json",
        help='JSON argv array with {source}/{target}, e.g. ["converter","{source}","{target}"]',
    )
    parser.add_argument("--converter-name", default="external-dwg-converter")
    parser.add_argument("--converter-version", default="unknown")
    parser.add_argument("--coordinate-decimal-places", type=int)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cadkernel")
    subcommands = parser.add_subparsers(dest="command", required=True)

    build = subcommands.add_parser("build", help="compile a drawing into an immutable snapshot")
    build.add_argument("drawing", type=Path)
    build.add_argument("--snapshot-root", type=Path, required=True)
    _add_precision_options(build)
    _add_converter_options(build)

    query = subcommands.add_parser("query", help="query an existing immutable snapshot")
    query.add_argument("snapshot", type=Path)
    mode = query.add_mutually_exclusive_group(required=True)
    mode.add_argument("--bbox", type=float, nargs=4, metavar=("MIN_X", "MIN_Y", "MAX_X", "MAX_Y"))
    mode.add_argument("--text")
    mode.add_argument("--endpoint", type=float, nargs=2, metavar=("X", "Y"))
    mode.add_argument(
        "--faces-bbox",
        type=float,
        nargs=4,
        metavar=("MIN_X", "MIN_Y", "MAX_X", "MAX_Y"),
    )
    query.add_argument("--radius", type=float)
    query.add_argument("--limit", type=int, default=50)
    query.add_argument("--pretty", action="store_true")

    report = subcommands.add_parser("report", help="emit cross-discipline atomic capability facts")
    report.add_argument("drawing", type=Path)
    report.add_argument("--snapshot-root", type=Path, required=True)
    report.add_argument("--mlight-index", type=Path)
    report.add_argument("--output", type=Path)
    report.add_argument("--pretty", action="store_true")
    _add_precision_options(report)
    _add_converter_options(report)
    return parser


def _write_output(payload: str, output: Path | None = None) -> None:
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(payload + "\n", encoding="utf-8", newline="\n")
    print(payload)


def _build(args: argparse.Namespace) -> int:
    with _prepared_drawing(args.drawing, args) as prepared:
        if prepared is None:
            _write_output(stable_json_dumps(_conversion_required(args.drawing), pretty=True))
            return 2
        adapter = DxfAdapter().build(
            prepared.dxf_path,
            tolerance=_tolerance(args),
            precision=_precision(args),
            conversion_provenance=prepared.provenance,
            logical_source_path=prepared.logical_source_path,
        )
        path = args.snapshot_root / adapter.snapshot.snapshot_id
        compilation = compile_topology(adapter.snapshot, tolerance=_tolerance(args))
        payload = make_topology_payload(adapter.snapshot, compilation)
        location = SnapshotStore.create(
            path,
            adapter.snapshot,
            derived_artifacts=(payload,),
        )
        _write_output(
            stable_json_dumps(
                BuildOutput(
                    "success",
                    location.snapshot_id,
                    location.path,
                    location.size_bytes,
                    adapter.snapshot.source_path,
                ),
                pretty=True,
            )
        )
    return 0


def _query(args: argparse.Namespace) -> int:
    snapshot = SnapshotStore.load(args.snapshot)
    if args.bbox is not None:
        result = query_region(args.snapshot, snapshot, tuple(args.bbox), limit=args.limit)
    elif args.text is not None:
        result = search_text(args.snapshot, snapshot, args.text, limit=args.limit)
    elif args.faces_bbox is not None:
        result = query_faces(
            args.snapshot,
            snapshot,
            tuple(args.faces_bbox),
            limit=args.limit,
        )
    else:
        result = query_endpoints(
            args.snapshot,
            snapshot,
            tuple(args.endpoint),
            radius=args.radius,
            limit=args.limit,
        )
    _write_output(result.to_json(pretty=args.pretty))
    return 0


def _report(args: argparse.Namespace) -> int:
    with _prepared_drawing(args.drawing, args) as prepared:
        if prepared is None:
            payload = stable_json_dumps(_conversion_required(args.drawing), pretty=args.pretty)
            _write_output(payload, args.output)
            return 2
        report = build_capability_report(
            prepared.dxf_path,
            args.snapshot_root,
            tolerance=_tolerance(args),
            precision=_precision(args),
            conversion_provenance=prepared.provenance,
            logical_source_path=prepared.logical_source_path,
            mlight_index=args.mlight_index,
        )
        _write_output(report.to_json(pretty=args.pretty), args.output)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "build":
            return _build(args)
        if args.command == "query":
            return _query(args)
        return _report(args)
    except (ValueError, RuntimeError, FileNotFoundError, FileExistsError, sqlite3.Error) as error:
        print(
            stable_json_dumps(
                ErrorOutput("failed", type(error).__name__, str(error)),
                pretty=True,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
