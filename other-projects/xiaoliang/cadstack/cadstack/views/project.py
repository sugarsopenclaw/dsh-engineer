from __future__ import annotations

from typing import Any, Mapping


def _ratio(record: Mapping[str, Any]) -> str:
    coverage = record.get("coverage")
    if not isinstance(coverage, Mapping):
        return "unknown"
    value = coverage.get("indexed_ratio")
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return "unknown"


def render_project_index(state: Mapping[str, Any]) -> str:
    drawings = state.get("drawings", {})
    rows = drawings if isinstance(drawings, Mapping) else {}
    lines = [
        "# CAD facts",
        "",
        f"- project: `{state.get('project_id', 'unknown')}`",
        f"- updated: `{state.get('updated_at', 'unknown')}`",
        "",
        "## Drawings",
        "",
        "| Drawing | Source | L1 | L2 | L3 | L4 | Indexed coverage | Conformance |",
        "| --- | --- | --- | --- | --- | --- | ---: | --- |",
    ]
    for key in sorted(rows):
        value = rows[key]
        if not isinstance(value, Mapping):
            continue
        layers = value.get("layers", {})
        layers = layers if isinstance(layers, Mapping) else {}
        conformance = value.get("conformance", {})
        conformance = conformance if isinstance(conformance, Mapping) else {}
        conformance_label = (
            "match" if conformance.get("matches") is True
            else "diff" if conformance.get("matches") is False
            else "unknown"
        )
        lines.append(
            f"| [{key}](drawings/{key}/L1.md) | `{value.get('logical_source', 'unknown')}` | "
            f"{layers.get('l1', 'missing')} | {layers.get('l2', 'missing')} | "
            f"{layers.get('l3', 'missing')} | {layers.get('l4', 'missing')} | "
            f"{_ratio(value)} | {conformance_label} |"
        )
    if not rows:
        lines.append("| — | no drawings ingested | missing | missing | missing | missing | — | — |")
    all_gaps: dict[str, str] = {}
    for value in rows.values():
        if not isinstance(value, Mapping):
            continue
        gaps = value.get("capability_gaps", [])
        if not isinstance(gaps, list):
            continue
        for gap in gaps:
            if isinstance(gap, Mapping):
                all_gaps[str(gap.get("missing", "unknown"))] = str(
                    gap.get("reason", "unavailable")
                )
    lines.extend(("", "## What can be asked", ""))
    if any(
        isinstance(value, Mapping)
        and isinstance(value.get("layers"), Mapping)
        and value["layers"].get("l4") == "ready"
        for value in rows.values()
    ):
        lines.extend(
            (
                "- Use `menu/index.txt` for the exact task and quantity readiness menu.",
                "- Use `cad_ask` for structured count/measure/locate/identify/"
                "describe/check/audit/reconcile/trace tasks.",
                "- Use `cad_lookup` for bounded semantic, text, and representation evidence.",
            )
        )
    else:
        lines.append("- L4 binding/menu is not ready yet; L1 facts remain directly inspectable.")
    lines.extend(("", "## Known capability gaps", ""))
    if all_gaps:
        lines.extend(f"- `{key}`: {all_gaps[key]}" for key in sorted(all_gaps))
    else:
        lines.append("- none recorded")
    lines.append("")
    return "\n".join(lines)
