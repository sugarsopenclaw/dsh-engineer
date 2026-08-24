from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cadkernel.adapters.dxf import DxfAdapterResult


DXF_TO_MLIGHT_TYPE = {
    "LINE": "line",
    "CIRCLE": "circle",
    "ARC": "arc",
    "ELLIPSE": "ellipse",
    "SPLINE": "spline",
    "LWPOLYLINE": "lwpolyline",
    "POLYLINE": "polyline",
    "ATTRIB": "attribute",
    "TEXT": "text",
    "MTEXT": "mtext",
    "DIMENSION": "dimension",
    "INSERT": "block_reference",
    "LEADER": "leader",
    "MLEADER": "mleader",
    "MULTILEADER": "mleader",
    "HATCH": "hatch",
    "ACAD_TABLE": "table",
}


@dataclass(frozen=True, slots=True)
class ConformanceDifference:
    axis: str
    key: str
    adapter_count: int
    mlight_count: int
    delta: int
    explanation: str | None = None


@dataclass(frozen=True, slots=True)
class MLightConformanceReport:
    matches: bool
    adapter_total: int
    mlight_total: int
    differences: tuple[ConformanceDifference, ...]
    invalid_json_lines: tuple[int, ...] = ()

    @property
    def unexplained_differences(self) -> tuple[ConformanceDifference, ...]:
        return tuple(item for item in self.differences if item.explanation is None)


def _read_index(path: Path) -> tuple[list[dict[str, Any]], tuple[int, ...]]:
    records: list[dict[str, Any]] = []
    invalid: list[int] = []
    with path.open("r", encoding="utf-8-sig") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                invalid.append(line_number)
                continue
            if isinstance(value, dict) and "type" in value:
                records.append(value)
    return records, tuple(invalid)


def _is_model_space_record(record: dict[str, Any]) -> bool:
    scope = record.get("owner_scope")
    # Records written before owner_scope existed came from a model-space-only
    # reader, so a missing or empty scope is model space by construction.
    if not isinstance(scope, str) or not scope:
        return True
    return scope == "model_space"


def compare_mlight_index(
    adapter_result: DxfAdapterResult,
    mlight_jsonl: str | Path,
) -> MLightConformanceReport:
    """Compare the authored ModelSpace surface, never expanded virtual occurrences."""

    path = Path(mlight_jsonl)
    records, invalid = _read_index(path)
    # The adapter side counts authored ModelSpace definitions only, while the
    # product index is captured with scope=database and also lists paper_space
    # and block_definition rows. Compare the same surface: keep model_space
    # records only, and drop DEFPOINTS rows exactly like the adapter does.
    records = [
        record
        for record in records
        if _is_model_space_record(record)
        and str(record.get("layer", "")).casefold() != "defpoints"
    ]
    mlight_types = Counter(str(record.get("type", "unknown")).casefold() for record in records)
    mlight_layers = Counter(str(record.get("layer", "")).casefold() for record in records)
    nested_attribute_count = sum(
        len(attributes)
        for record in records
        for attributes in (record.get("attributes"),)
        if isinstance(attributes, (dict, list, tuple))
    )

    definitions = adapter_result.snapshot.definitions
    adapter_types: Counter[str] = Counter()
    adapter_layers: Counter[str] = Counter()
    dxf_only_layers: Counter[str] = Counter()
    for index in range(len(definitions)):
        if definitions.layout_ids[index].casefold() != "model":
            continue
        layer = definitions.layers[index].casefold()
        # MLight extraction deliberately excludes DEFPOINTS before counting.
        if layer == "defpoints":
            continue
        dxf_type = definitions.dxf_types[index].upper()
        mapped_type = DXF_TO_MLIGHT_TYPE.get(dxf_type, dxf_type.casefold())
        adapter_types[mapped_type] += 1
        adapter_layers[layer] += 1
        # AutoCAD's DXF serializer exposes attached ATTRIB subentities and opaque
        # proxy records as separate ENTITIES records. The MLight ObjectARX iterator
        # represents the former inside block_reference.attributes and did not emit
        # the latter in the reference corpus. Track their per-layer contribution so
        # that a layer delta is explained only when the arithmetic closes exactly.
        if mapped_type in {"attribute", "acad_proxy_entity"}:
            dxf_only_layers[layer] += 1

    polyline_aliases = {"polyline", "2d_polyline", "3d_polyline"}
    polyline_alias_matches = sum(adapter_types[key] for key in polyline_aliases) == sum(
        mlight_types[key] for key in polyline_aliases
    )
    # Representation exceptions are accepted only when their independent
    # arithmetic closes: nested MLight attributes must equal the DXF ATTRIB
    # surplus, and every layer delta must equal the explicit ATTRIB/proxy rows
    # observed on that layer.  A merely one-sided count is not conformance.
    representation_layers_close = all(
        adapter_layers[key] - mlight_layers[key] == dxf_only_layers[key]
        for key in set(adapter_layers) | set(mlight_layers)
    )

    differences: list[ConformanceDifference] = []
    for axis, adapter_counts, mlight_counts in (
        ("type", adapter_types, mlight_types),
        ("layer", adapter_layers, mlight_layers),
    ):
        for key in sorted(set(adapter_counts) | set(mlight_counts)):
            left = adapter_counts[key]
            right = mlight_counts[key]
            if left == right:
                continue
            explanation = None
            if axis == "type" and key in polyline_aliases and polyline_alias_matches:
                explanation = (
                    "DXF POLYLINE is classified by MLight as 2d_polyline or 3d_polyline; "
                    "the combined alias-group count is identical."
                )
            elif (
                axis == "type"
                and key == "attribute"
                and left - right == nested_attribute_count
                and representation_layers_close
            ):
                explanation = (
                    "DXF exposes attached ATTRIB records separately; MLight nests their "
                    "tag/value pairs inside block_reference.attributes, and the exact counts agree."
                )
            elif (
                axis == "type"
                and key == "acad_proxy_entity"
                and right == 0
                and representation_layers_close
            ):
                explanation = (
                    "AutoCAD DXF SaveAs exposes opaque ACAD_PROXY_ENTITY records that the "
                    "MLight ModelSpace iterator did not emit; their exact per-layer deltas close."
                )
            elif axis == "layer" and left - right == dxf_only_layers[key]:
                explanation = (
                    "The layer delta equals its DXF-only attached ATTRIB and opaque proxy "
                    "records; all shared top-level entities match."
                )
            differences.append(
                ConformanceDifference(axis, key, left, right, left - right, explanation)
            )
    matches = not invalid and not any(item.explanation is None for item in differences)
    return MLightConformanceReport(
        matches=matches,
        adapter_total=sum(adapter_types.values()),
        mlight_total=len(records),
        differences=tuple(differences),
        invalid_json_lines=invalid,
    )
