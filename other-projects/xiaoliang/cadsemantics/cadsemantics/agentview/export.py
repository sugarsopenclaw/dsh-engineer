from __future__ import annotations

from pathlib import Path
import re

from cadsemantics.coverage import semantic_coverage_report
from cadsemantics.graph import SemanticGraphBundle


def _component(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
    return normalized or "unknown"


def _record(representation) -> str:
    lines = [
        f"representation_id: {representation.resolution_id}",
        f"representation_key: {representation.representation_key}",
        f"semantic_class: {representation.semantic_class or 'unresolved'}",
        f"status: {representation.status.value}",
        f"representation_mode: {representation.representation_mode.value}",
        f"context_id: {representation.context_id}",
        f"domain_pack: {representation.domain_pack_id}@{representation.domain_pack_version}",
        "source_pattern_keys: " + ", ".join(representation.source_pattern_keys),
        "source_detection_ids: " + ", ".join(representation.source_detection_ids),
        "bounds: " + ("unknown" if representation.bounds is None else ", ".join(str(value) for value in representation.bounds)),
        "geometry_signature: " + (representation.geometry_signature or "none"),
        "evidence:",
    ]
    evidence = {
        item.evidence_id: item
        for assertion in (*representation.class_assertions, *representation.properties)
        for item in assertion.evidence.all_refs
    }
    lines.extend(
        f"  - {item.kind.value}:{item.ref_id} feature={item.feature_key or '-'} proof={item.geometry_proof_grade or '-'} literal={item.literal or '-'}"
        for item in sorted(evidence.values(), key=lambda value: value.evidence_id)
    )
    lines.append("properties:")
    lines.extend(
        f"  - {item.property_id}={item.normalized_value!r} unit={item.normalized_unit or '-'} scope={item.applies_to_scope.value} status={item.status.value}"
        for item in representation.properties
    )
    lines.append("relations: " + ", ".join(representation.relation_ids))
    return "\n".join(lines) + "\n"


def export_text_tree(bundle: SemanticGraphBundle, output: str | Path) -> Path:
    root = Path(output)
    root.mkdir(parents=True, exist_ok=True)
    index_lines = [
        f"drawing_semantic_graph_id: {bundle.drawing_graph.drawing_semantic_graph_id}",
        f"project_semantic_graph_id: {bundle.project_graph.project_semantic_graph_id}",
        f"snapshot_id: {bundle.drawing_graph.snapshot_id}",
        f"pattern_graph_id: {bundle.drawing_graph.pattern_graph_id}",
        "",
        "representations:",
    ]
    for representation in bundle.drawing_graph.representations:
        class_id = representation.semantic_class or "unresolved"
        if class_id == "documentation.Sheet":
            category = "sheets"
        elif class_id == "documentation.DrawingView":
            category = "views"
        else:
            category = f"objects/{_component(class_id)}"
        directory = root / category
        directory.mkdir(parents=True, exist_ok=True)
        filename = _component(representation.resolution_id) + ".txt"
        relative = (Path(category) / filename).as_posix()
        (directory / filename).write_text(_record(representation), encoding="utf-8", newline="\n")
        index_lines.append(f"  - {class_id} {representation.status.value} {relative}")
    coverage = semantic_coverage_report(bundle.drawing_graph, bundle.project_graph)
    (root / "unexplained-patterns.txt").write_text(
        "\n".join(coverage.unexplained_pattern_keys) + ("\n" if coverage.unexplained_pattern_keys else ""),
        encoding="utf-8",
        newline="\n",
    )
    index_lines.extend(
        (
            "",
            f"pattern_resolution_coverage: {coverage.pattern_resolution_coverage}",
            f"evidence_coverage: {coverage.evidence_coverage}",
            f"domain_leakage_rate: {coverage.domain_leakage_rate}",
            "unexplained_patterns: unexplained-patterns.txt",
        )
    )
    (root / "index.txt").write_text("\n".join(index_lines) + "\n", encoding="utf-8", newline="\n")
    return root

