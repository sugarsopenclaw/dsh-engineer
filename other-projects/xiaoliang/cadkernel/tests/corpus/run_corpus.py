"""Build provenance-backed reports for the architecture/electrical corpus.

The DWG files and converted DXFs are deliberately not committed. ``manifest.json``
pins every input by SHA-256, and this runner refuses to report on a different file.

Run from the cadkernel project root::

    uv run python -m tests.corpus.run_corpus
    uv run python -m tests.corpus.run_corpus --verify-only
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from cadkernel._ids import sha256_file
from cadkernel._serialization import stable_json_dumps
from cadkernel.adapters.dxf import ConversionProvenance
from cadkernel.coverage import build_capability_report


PROJECT_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = PROJECT_ROOT.parent
MANIFEST_PATH = Path(__file__).with_name("manifest.json")


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema_version") != 1 or not isinstance(value.get("sources"), list):
        raise ValueError(f"Unsupported corpus manifest: {path}")
    return value


def resolve_source(record: dict[str, Any], project_root: Path = PROJECT_ROOT) -> Path:
    if record["origin"] == "autodesk_archive":
        return project_root / ".corpus-work" / "autodesk" / record["archive_member"]
    if record["origin"] == "workspace":
        return project_root.parent / record["workspace_path"]
    raise ValueError(f"Unknown corpus source origin: {record['origin']!r}")


def verify_hash(path: Path, expected: str, *, role: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Missing {role}: {path}")
    actual = sha256_file(str(path))
    if actual != expected:
        raise ValueError(
            f"{role} SHA-256 mismatch for {path}: expected {expected}, got {actual}"
        )


def verify_record(
    record: dict[str, Any],
    *,
    dxf_root: Path,
    project_root: Path = PROJECT_ROOT,
) -> tuple[Path, Path]:
    source = resolve_source(record, project_root)
    dxf = dxf_root / record["dxf_name"]
    verify_hash(source, record["source_sha256"], role="DWG source")
    verify_hash(dxf, record["reference_dxf_sha256"], role="converted DXF")
    return source, dxf


def _compact_report(record: dict[str, Any], report: Any, elapsed: float) -> dict[str, Any]:
    conformance = report.mlight_conformance
    return {
        "corpus_id": record["id"],
        "discipline": record["discipline"],
        "snapshot_id": report.snapshot_id,
        "execution_status": report.coverage.execution_status,
        "coverage": {
            "source": report.coverage.total_source_entities,
            "parsed": report.coverage.parsed,
            "geometry_supported": report.coverage.geometry_supported,
            "indexed": report.coverage.indexed,
            "topology_eligible": report.coverage.topology_eligible,
            "parsed_ratio": report.coverage.parsed_ratio,
            "geometry_supported_ratio": report.coverage.geometry_supported_ratio,
            "indexed_ratio": report.coverage.indexed_ratio,
            "topology_eligible_ratio": report.coverage.topology_eligible_ratio,
            "unsupported_by_type": report.coverage.unsupported_by_type,
            "unit_status": report.coverage.unit_status,
            "transform_failure_count": len(report.coverage.transform_failures),
            "approximation_count": report.coverage.approximation_count,
        },
        "topology": {
            "nodes": report.topology.node_count,
            "edges": report.topology.edge_count,
            "components": report.topology.connected_component_count,
            "isolated_nodes": report.topology.isolated_node_count,
            "dangling_nodes": report.topology.dangling_node_count,
            "bridges": report.topology.bridge_count,
            "articulation_points": report.topology.articulation_point_count,
            "cycles": report.topology.cycle_count,
            "minimum_cycle_basis": report.topology.minimum_cycle_basis_count,
            "details_truncated": report.topology.details_truncated,
        },
        "faces": {
            "closed": report.faces.closed_face_count,
            "with_holes": report.faces.faces_with_holes,
            "holes": report.faces.hole_count,
            "containment_max_depth": report.faces.containment_max_depth,
            "area_total": report.faces.area_distribution.total,
            "area_unit": report.faces.area_distribution.unit,
            "dcel_valid": report.faces.dcel_valid,
            "euler_left": report.faces.euler_left,
            "euler_right": report.faces.euler_right,
            "validation_diagnostics": report.faces.validation_diagnostics,
            "compilation_decision": report.faces.compilation_decision,
            "compilation_diagnostics": report.faces.compilation_diagnostics,
        },
        "text": {
            "records": report.text.text_record_count,
            "fts_terms": report.text.fts_term_count,
            "block_attributes": report.text.block_attribute_record_count,
            "block_attribute_coverage": report.text.block_attribute_coverage,
        },
        "annotation": {
            "records": report.annotation.annotation_record_count,
            "source_dimensions": report.annotation.source_dimension_count,
            "dimension_records": report.annotation.dimension_record_count,
            "dimension_measured": report.annotation.dimension_measured_count,
            "dimension_diagnostics": report.annotation.dimension_diagnostic_count,
            "dimension_fact_coverage": report.annotation.dimension_fact_coverage,
            "text_overrides": report.annotation.text_override_count,
            "target_refs": report.annotation.target_ref_count,
            "derived_geometry": report.annotation.annotation_derived_geometry_count,
        },
        "duplicates": {
            "repeated_definition_groups": report.duplicates.repeated_definition_count,
            "geometry_candidate_groups": report.duplicates.geometry_candidate_group_count,
            "details_truncated": report.duplicates.details_truncated,
        },
        "scale": {
            "definitions": report.scale.definition_count,
            "occurrences": report.scale.occurrence_count,
            "geometry": report.scale.geometry_count,
            "coordinates": report.scale.coordinate_count,
            "arrangement_vertices": report.scale.arrangement_vertex_count,
            "arrangement_edges": report.scale.arrangement_edge_count,
            "arrangement_support_fragments": report.scale.arrangement_support_fragment_count,
            "arrangement_unsupported_edges": report.scale.arrangement_unsupported_edge_count,
            "snapshot_size_bytes": report.scale.snapshot_size_bytes,
            "peak_memory_bytes": report.scale.peak_memory_bytes,
        },
        "timings_seconds": {item.stage: item.seconds for item in report.timings},
        "runner_elapsed_seconds": elapsed,
        "mlight_conformance": None
        if conformance is None
        else {
            "matches": conformance.matches,
            "adapter_total": conformance.adapter_total,
            "mlight_total": conformance.mlight_total,
            "difference_count": len(conformance.differences),
            "unexplained_difference_count": len(conformance.unexplained_differences),
            "invalid_json_lines": conformance.invalid_json_lines,
            "differences": conformance.differences,
        },
    }


def _discipline_aggregate(rows: list[dict[str, Any]], discipline: str) -> dict[str, Any]:
    selected = [row for row in rows if row["discipline"] == discipline]
    return {
        "drawing_count": len(selected),
        "source_entities": sum(row["coverage"]["source"] for row in selected),
        "geometry_supported": sum(
            row["coverage"]["geometry_supported"] for row in selected
        ),
        "topology_edges": sum(row["topology"]["edges"] for row in selected),
        "closed_faces": sum(row["faces"]["closed"] for row in selected),
        "arrangement_support_fragments": sum(
            row["scale"]["arrangement_support_fragments"] for row in selected
        ),
        "arrangement_unsupported_edges": sum(
            row["scale"]["arrangement_unsupported_edges"] for row in selected
        ),
        "text_records": sum(row["text"]["records"] for row in selected),
        "annotation_records": sum(
            row["annotation"]["records"] for row in selected
        ),
        "snapshot_size_bytes": sum(
            row["scale"]["snapshot_size_bytes"] for row in selected
        ),
        "valid_dcel_count": sum(bool(row["faces"]["dcel_valid"]) for row in selected),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("ids", nargs="*", help="optional corpus ids; default is every source")
    parser.add_argument(
        "--dxf-root", type=Path, default=PROJECT_ROOT / ".corpus-work" / "dxf"
    )
    parser.add_argument(
        "--snapshot-root",
        type=Path,
        default=PROJECT_ROOT / ".corpus-work" / "snapshots-v4",
    )
    parser.add_argument(
        "--output-root", type=Path, default=PROJECT_ROOT / "benchmarks" / "corpus"
    )
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args(argv)

    manifest = load_manifest()
    selected_ids = set(args.ids)
    known_ids = {record["id"] for record in manifest["sources"]}
    unknown = sorted(selected_ids - known_ids)
    if unknown:
        parser.error("unknown corpus ids: " + ", ".join(unknown))
    records = [
        record
        for record in manifest["sources"]
        if not selected_ids or record["id"] in selected_ids
    ]
    conversion = manifest["conversion"]
    compact_rows: list[dict[str, Any]] = []
    for record in records:
        source, dxf = verify_record(record, dxf_root=args.dxf_root)
        mlight = record.get("mlight_index")
        mlight_path = WORKSPACE_ROOT / mlight if mlight else None
        if mlight_path is not None and not mlight_path.is_file():
            raise FileNotFoundError(f"Missing MLight reference index: {mlight_path}")
        if mlight_path is not None:
            verify_hash(
                mlight_path,
                record["mlight_sha256"],
                role="MLight reference index",
            )
        if args.verify_only:
            print(stable_json_dumps({"corpus_id": record["id"], "verified": True}))
            continue
        provenance = ConversionProvenance(
            converter=conversion["converter"],
            converter_version=conversion["converter_version"],
            source_sha256=record["source_sha256"],
            output_sha256=record["reference_dxf_sha256"],
            coordinate_decimal_places=conversion["coordinate_decimal_places"],
            warnings=(f"AutoCAD AcSaveAsType={conversion['save_as_type']}",),
        )
        started = time.perf_counter()
        report = build_capability_report(
            dxf,
            args.snapshot_root,
            conversion_provenance=provenance,
            logical_source_path=source,
            mlight_index=mlight_path,
        )
        elapsed = time.perf_counter() - started
        args.output_root.mkdir(parents=True, exist_ok=True)
        full_path = args.output_root / f"{record['id']}.json"
        full_path.write_text(report.to_json(pretty=True) + "\n", encoding="utf-8", newline="\n")
        compact = _compact_report(record, report, elapsed)
        compact_rows.append(compact)
        print(
            stable_json_dumps(
                {
                    "corpus_id": record["id"],
                    "source_entities": report.coverage.total_source_entities,
                    "geometry_supported_ratio": report.coverage.geometry_supported_ratio,
                    "closed_faces": report.faces.closed_face_count,
                    "dcel_valid": report.faces.dcel_valid,
                    "elapsed_seconds": elapsed,
                    "report": str(full_path.resolve()),
                }
            )
        )

    if compact_rows:
        summary = {
            "schema_version": 3,
            "manifest": str(MANIFEST_PATH.relative_to(PROJECT_ROOT)),
            "drawings": compact_rows,
            "disciplines": {
                discipline: _discipline_aggregate(compact_rows, discipline)
                for discipline in sorted({row["discipline"] for row in compact_rows})
            },
        }
        (args.output_root / "summary.json").write_text(
            stable_json_dumps(summary, pretty=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
