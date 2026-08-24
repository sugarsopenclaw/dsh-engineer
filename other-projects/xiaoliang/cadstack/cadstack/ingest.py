from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

from cadkernel.adapters.dxf import ConversionProvenance
from cadkernel.coverage import build_capability_report

from cadstack.layout import FactsLayout, drawing_artifact_key, validate_drawing_key
from cadstack.state import (
    atomic_write_json,
    atomic_write_text,
    read_project_state,
    save_project_state,
    state_lock,
    utc_now,
)
from cadstack.views import render_l1_markdown


MLIGHT_CONVERTER_VERSION = (
    "@mlightcad/data-model@1.12.5+dxfOut@16+utf8-header-v1"
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _conversion_provenance(
    logical_source: Path,
    dxf_path: Path,
    *,
    source_sha256: str,
    output_sha256: str,
) -> ConversionProvenance | None:
    same_file = logical_source.resolve() == dxf_path.resolve()
    if same_file:
        return None
    return ConversionProvenance(
        converter="mlightcad-dxfout",
        converter_version=MLIGHT_CONVERTER_VERSION,
        source_sha256=source_sha256,
        output_sha256=output_sha256,
        coordinate_decimal_places=16,
        command=("MLightCadSessionService.exportDxf",),
    )


def _known_capability_gaps(report: Mapping[str, Any]) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = [
        {
            "capability_id": "semantic.measured_value",
            "missing": "core.measured_value",
            "reason": (
                "The semantic layer registers measured values but does not yet produce "
                "them. Use cad_extract action=read for authoritative AutoCAD fields or "
                "cad_detail/cad_measure for a bounded local fallback."
            ),
        },
        {
            "capability_id": "schedule.bom_declared",
            "missing": "schedule.row_segmentation",
            "reason": (
                "BOM_DECLARED remains abstained until deterministic schedule row "
                "segmentation is available."
            ),
        },
    ]
    coverage = report.get("coverage", {})
    if isinstance(coverage, Mapping):
        diagnostics = coverage.get("diagnostics", [])
        if isinstance(diagnostics, list):
            aggregated: dict[tuple[str, str, str | None], dict[str, Any]] = {}
            for diagnostic in diagnostics:
                if not isinstance(diagnostic, Mapping):
                    continue
                missing = str(diagnostic.get("code", "coverage_unknown"))
                reason = str(
                    diagnostic.get("message", "Coverage is incomplete.")
                )
                action_value = diagnostic.get("required_action")
                required_action = (
                    None if action_value is None else str(action_value)
                )
                identity = (missing, reason, required_action)
                gap = aggregated.setdefault(
                    identity,
                    {
                        "capability_id": "cadkernel.coverage",
                        "missing": missing,
                        "reason": reason,
                        "required_action": required_action,
                        "occurrence_count": 0,
                    },
                )
                gap["occurrence_count"] += 1
            gaps.extend(
                aggregated[key]
                for key in sorted(
                    aggregated,
                    key=lambda value: (value[0], value[1], value[2] or ""),
                )
            )
    conformance = report.get("mlight_conformance")
    if isinstance(conformance, Mapping) and conformance.get("matches") is False:
        gaps.append(
            {
                "capability_id": "cadkernel.mlight_conformance",
                "missing": "mlight_conformance",
                "reason": (
                    "Unexplained differences remain between the DXF and MLight "
                    "authored surfaces."
                ),
            }
        )
    return gaps


def ingest_drawing(
    *,
    project_root: str | Path,
    drawing_key: str,
    dxf: str | Path,
    logical_source: str,
    mlight_index: str | Path | None = None,
) -> dict[str, Any]:
    layout = FactsLayout.from_project_root(project_root)
    layout.ensure()
    key = validate_drawing_key(drawing_key)
    logical_relative, logical_path = layout.resolve_project_path(
        logical_source,
        suffixes=frozenset({".dwg", ".dxf"}),
    )
    expected_key = drawing_artifact_key(Path(logical_relative).name, logical_relative)
    if key != expected_key:
        raise ValueError(
            f"drawing key {key!r} does not match the project source; expected {expected_key!r}"
        )
    dxf_path = layout.resolve_input_path(dxf, suffixes=frozenset({".dxf"}))
    mlight_path = (
        None
        if mlight_index is None
        else layout.resolve_input_path(mlight_index, suffixes=frozenset({".jsonl"}))
    )
    same_input = logical_path.resolve() == dxf_path.resolve()
    source_sha256_before = _sha256_file(logical_path)
    dxf_sha256_before = (
        source_sha256_before if same_input else _sha256_file(dxf_path)
    )
    mlight_sha256_before = (
        None if mlight_path is None else _sha256_file(mlight_path)
    )
    provenance = _conversion_provenance(
        logical_path,
        dxf_path,
        source_sha256=source_sha256_before,
        output_sha256=dxf_sha256_before,
    )
    report_value = build_capability_report(
        dxf_path,
        layout.snapshots_root,
        conversion_provenance=provenance,
        logical_source_path=logical_path,
        mlight_index=mlight_path,
    )
    report = json.loads(report_value.to_json(pretty=False))
    if not isinstance(report, dict):
        raise TypeError("cadkernel capability report must serialize to an object")
    source_sha256 = _sha256_file(logical_path)
    dxf_sha256 = source_sha256 if same_input else _sha256_file(dxf_path)
    mlight_sha256 = None if mlight_path is None else _sha256_file(mlight_path)
    if (
        source_sha256 != source_sha256_before
        or dxf_sha256 != dxf_sha256_before
        or mlight_sha256 != mlight_sha256_before
    ):
        raise RuntimeError(
            "CAD input changed while L1 facts were building; retry extraction"
        )
    gaps = _known_capability_gaps(report)
    snapshot_id = str(report["snapshot_id"])
    snapshot_path = layout.snapshots_root / snapshot_id
    if not snapshot_path.is_dir():
        raise RuntimeError("cadkernel report did not persist its declared snapshot")
    drawing_root = layout.drawing_root(key)
    drawing_root.mkdir(parents=True, exist_ok=True)
    atomic_write_json(layout.coverage_json(key), report)
    atomic_write_text(
        layout.l1_markdown(key),
        render_l1_markdown(key, logical_relative, report, gaps),
    )

    coverage = report.get("coverage", {})
    coverage_summary = {
        name: coverage.get(name)
        for name in (
            "execution_status",
            "total_source_entities",
            "parsed",
            "geometry_supported",
            "indexed",
            "topology_eligible",
            "unit_status",
            "parsed_ratio",
            "geometry_supported_ratio",
            "indexed_ratio",
            "topology_eligible_ratio",
        )
    } if isinstance(coverage, Mapping) else {}
    conformance = report.get("mlight_conformance")
    conformance_summary = (
        {
            "matches": conformance.get("matches"),
            "adapter_total": conformance.get("adapter_total"),
            "mlight_total": conformance.get("mlight_total"),
            "difference_count": len(conformance.get("differences", [])),
            "unexplained_difference_count": sum(
                1
                for item in conformance.get("differences", [])
                if isinstance(item, Mapping) and item.get("explanation") is None
            ),
        }
        if isinstance(conformance, Mapping)
        else None
    )
    with state_lock(layout):
        state = read_project_state(layout)
        drawings = state["drawings"]
        previous = drawings.get(key, {})
        same_snapshot = (
            isinstance(previous, Mapping)
            and previous.get("snapshot_id") == snapshot_id
        )
        previous_layers = previous.get("layers", {}) if isinstance(previous, Mapping) else {}
        previous_stores = previous.get("stores", {}) if isinstance(previous, Mapping) else {}
        layers = {
            "l1": "ready",
            "l2": previous_layers.get("l2", "missing") if same_snapshot else "missing",
            "l3": previous_layers.get("l3", "missing") if same_snapshot else "missing",
            "l4": previous_layers.get("l4", "missing") if same_snapshot else "missing",
        }
        stores: dict[str, Any] = {"snapshot": layout.relative(snapshot_path)}
        if same_snapshot and isinstance(previous_stores, Mapping):
            stores.update(
                {
                    name: previous_stores[name]
                    for name in ("pattern", "semantic")
                    if name in previous_stores
                }
            )
        drawings[key] = {
            "drawing_key": key,
            "logical_source": logical_relative,
            "source_sha256": source_sha256,
            "mlight_index_sha256": mlight_sha256,
            "dxf_path": layout.relative(dxf_path),
            "snapshot_id": snapshot_id,
            "stores": stores,
            "layers": layers,
            "coverage": coverage_summary,
            "conformance": conformance_summary,
            "capability_gaps": gaps,
            "facts_paths": {
                "l1": layout.relative(layout.l1_markdown(key)),
                "coverage": layout.relative(layout.coverage_json(key)),
                "semantic": layout.relative(layout.semantic_view_root(key)),
            },
            "updated_at": utc_now(),
        }
        save_project_state(layout, state)
    return {
        "drawing_key": key,
        "snapshot_id": snapshot_id,
        "source_sha256": source_sha256,
        "mlight_index_sha256": mlight_sha256,
        "layers": layers,
        "coverage": coverage_summary,
        "conformance": conformance_summary,
        "capability_gaps": gaps,
        "facts_paths": drawings[key]["facts_paths"],
    }
