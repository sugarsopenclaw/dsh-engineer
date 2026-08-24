from __future__ import annotations

from typing import Any, Mapping


def _percent(value: object) -> str:
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return "unknown"


def render_l1_markdown(
    drawing_key: str,
    logical_source: str,
    report: Mapping[str, Any],
    capability_gaps: list[Mapping[str, Any]],
) -> str:
    coverage = report.get("coverage", {})
    topology = report.get("topology", {})
    faces = report.get("faces", {})
    text = report.get("text", {})
    annotation = report.get("annotation", {})
    conformance = report.get("mlight_conformance")
    lines = [
        f"# L1 facts — {drawing_key}",
        "",
        f"- source: `{logical_source}`",
        f"- snapshot: `{report.get('snapshot_id', 'unknown')}`",
        f"- execution status: `{coverage.get('execution_status', 'unknown')}`",
        f"- units: `{coverage.get('unit_status', 'unknown')}`",
        "",
        "## Real coverage",
        "",
        "| Metric | Count | Ratio |",
        "| --- | ---: | ---: |",
        f"| authored source entities | {coverage.get('total_source_entities', 0)} | 100.00% |",
        f"| parsed | {coverage.get('parsed', 0)} | {_percent(coverage.get('parsed_ratio'))} |",
        f"| geometry supported | {coverage.get('geometry_supported', 0)} | "
        f"{_percent(coverage.get('geometry_supported_ratio'))} |",
        f"| indexed | {coverage.get('indexed', 0)} | {_percent(coverage.get('indexed_ratio'))} |",
        f"| topology eligible | {coverage.get('topology_eligible', 0)} | "
        f"{_percent(coverage.get('topology_eligible_ratio'))} |",
        "",
        "## Deterministic facts",
        "",
        f"- connected components: {topology.get('connected_component_count', 0)}",
        f"- dangling nodes: {topology.get('dangling_node_count', 0)}",
        f"- closed faces: {faces.get('closed_face_count', 0)}",
        f"- DCEL valid: {faces.get('dcel_valid', False)}",
        f"- text records: {text.get('text_record_count', 0)}",
        f"- annotation records: {annotation.get('annotation_record_count', 0)}",
        f"- measured dimensions: {annotation.get('dimension_measured_count', 0)} / "
        f"{annotation.get('source_dimension_count', 0)}",
        "",
        "## MLight conformance",
        "",
    ]
    if isinstance(conformance, Mapping):
        lines.extend(
            (
                "- matches after explicit representation exceptions: "
                f"`{conformance.get('matches', False)}`",
                f"- cadkernel authored total: {conformance.get('adapter_total', 0)}",
                f"- MLight total: {conformance.get('mlight_total', 0)}",
                "",
                "| Axis | Key | cadkernel | MLight | Delta | Explanation |",
                "| --- | --- | ---: | ---: | ---: | --- |",
            )
        )
        differences = conformance.get("differences", [])
        if isinstance(differences, list) and differences:
            for item in differences:
                if not isinstance(item, Mapping):
                    continue
                explanation = str(item.get("explanation") or "unexplained").replace("|", "\\|")
                lines.append(
                    f"| {item.get('axis', '')} | {item.get('key', '')} | "
                    f"{item.get('adapter_count', 0)} | {item.get('mlight_count', 0)} | "
                    f"{item.get('delta', 0)} | {explanation} |"
                )
        else:
            lines.append("| — | no differences | 0 | 0 | 0 | exact match |")
    else:
        lines.append("- MLight index was not supplied; cross-parser conformance is unavailable.")
    lines.extend(("", "## Capability gaps", ""))
    if capability_gaps:
        for gap in capability_gaps:
            count = gap.get("occurrence_count")
            occurrence = (
                f" ({count} occurrences)"
                if isinstance(count, int) and count > 1
                else ""
            )
            lines.append(
                f"- `{gap.get('missing', 'unknown')}`{occurrence}: "
                f"{gap.get('reason', 'unavailable')}"
            )
    else:
        lines.append("- none reported by L1")
    lines.extend(
        (
            "",
            "## Files",
            "",
            f"- full report: `.xiaoliang/cad/facts/drawings/{drawing_key}/coverage.json`",
            "- semantic view (after L3): "
            f"`.xiaoliang/cad/facts/drawings/{drawing_key}/semantic/index.txt`",
            "",
        )
    )
    return "\n".join(lines)
