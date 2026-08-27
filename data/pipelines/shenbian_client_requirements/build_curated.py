"""Build the curated Shenbian business-requirement dataset.

The customer drop remains immutable.  This pipeline turns the versioned human
curation specification into normalized JSONL tables plus an LLM-readable
Markdown view, and fails fast on broken identities, hierarchy cycles or lost
provenance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any, Iterable

import curation_spec as spec


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = REPO_ROOT / "data/datasets/curated/shenbian-client-requirements/v1"
HIERARCHY_RELATIONS = {"contains_requirement", "decomposes_to"}
NAVIGATION_RELATIONS = HIERARCHY_RELATIONS | {"reuses_requirement"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    materialized = list(rows)
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for row in materialized:
            stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            stream.write("\n")
    return len(materialized)


def normalized_name(value: str) -> str:
    return re.sub(r"[\s、，。；：/（）()\-—_]+", "", value).casefold()


def validate() -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    nodes = spec.NODES
    relations = spec.RELATIONS

    evidence_ids = {row["source_evidence_id"] for row in spec.SOURCE_EVIDENCE}
    source_document_ids = {row["source_document_id"] for row in spec.SOURCE_DOCUMENTS}
    scope_value_ids = {row["scope_value_id"] for row in spec.SCOPE_VALUES}

    for row in spec.SOURCE_EVIDENCE:
        if row["source_document_id"] not in source_document_ids:
            errors.append(f"evidence {row['source_evidence_id']} references missing source document")

    relation_ids: set[str] = set()
    for row in relations:
        relation_id = row["requirement_relation_id"]
        if relation_id in relation_ids:
            errors.append(f"duplicate relation id: {relation_id}")
        relation_ids.add(relation_id)
        for key in ("parent_requirement_id", "child_requirement_id"):
            if row[key] not in nodes:
                errors.append(f"{relation_id} references missing node {row[key]}")

    for row in spec.SOURCE_LINKS:
        if row["requirement_id"] not in nodes:
            errors.append(f"source link references missing requirement {row['requirement_id']}")
        if row["source_evidence_id"] not in evidence_ids:
            errors.append(f"source link references missing evidence {row['source_evidence_id']}")

    for row in spec.REQUIREMENT_SCOPE_LINKS:
        if row["requirement_id"] not in nodes:
            errors.append(f"scope link references missing requirement {row['requirement_id']}")
        if row["scope_value_id"] not in scope_value_ids:
            errors.append(f"scope link references missing value {row['scope_value_id']}")

    dedup_ids: set[str] = set()
    for row in spec.DEDUP_DECISIONS:
        if row["dedup_decision_id"] in dedup_ids:
            errors.append(f"duplicate dedup decision id: {row['dedup_decision_id']}")
        dedup_ids.add(row["dedup_decision_id"])
        for requirement_id in row["candidate_requirement_ids"]:
            if requirement_id not in nodes:
                errors.append(f"dedup decision references missing requirement {requirement_id}")

    question_ids: set[str] = set()
    for row in spec.OPEN_QUESTIONS:
        if row["open_question_id"] in question_ids:
            errors.append(f"duplicate open question id: {row['open_question_id']}")
        question_ids.add(row["open_question_id"])
        for requirement_id in row["affects_requirement_ids"]:
            if requirement_id not in nodes:
                errors.append(f"open question references missing requirement {requirement_id}")

    hierarchy_children: dict[str, list[str]] = defaultdict(list)
    navigation_children: dict[str, list[str]] = defaultdict(list)
    for row in relations:
        if row["relation_kind"] in HIERARCHY_RELATIONS:
            hierarchy_children[row["parent_requirement_id"]].append(row["child_requirement_id"])
        if row["relation_kind"] in NAVIGATION_RELATIONS:
            navigation_children[row["parent_requirement_id"]].append(row["child_requirement_id"])

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visiting:
            errors.append(f"hierarchy cycle at {node_id}")
            return
        if node_id in visited:
            return
        visiting.add(node_id)
        for child_id in hierarchy_children.get(node_id, []):
            visit(child_id)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in nodes:
        visit(node_id)

    reachable: set[str] = set()
    queue: deque[str] = deque(["BR-000"])
    while queue:
        node_id = queue.popleft()
        if node_id in reachable:
            continue
        reachable.add(node_id)
        queue.extend(navigation_children.get(node_id, []))
    unreachable = sorted(set(nodes) - reachable)
    if unreachable:
        errors.append(f"unreachable requirements: {', '.join(unreachable)}")

    for node_id, node in nodes.items():
        children = hierarchy_children.get(node_id, [])
        if node["atomic"] and children:
            errors.append(f"atomic requirement {node_id} has hierarchy children")
        if not node["atomic"] and node_id != "BR-000" and not (
            children or navigation_children.get(node_id)
        ):
            errors.append(f"non-atomic requirement {node_id} has no children")
        if node["atomic"] and not node.get("verification_method"):
            errors.append(f"atomic requirement {node_id} lacks verification method")

    direct_source_nodes = {row["requirement_id"] for row in spec.SOURCE_LINKS}
    for node_id, node in nodes.items():
        if node["origin_kind"] == "customer_stated" and node_id not in direct_source_nodes:
            errors.append(f"customer-stated requirement {node_id} lacks direct evidence")

    name_groups: dict[str, list[str]] = defaultdict(list)
    for node_id, node in nodes.items():
        name_groups[normalized_name(node["name"])].append(node_id)
    for key, ids in name_groups.items():
        if key and len(ids) > 1:
            warnings.append(f"normalized duplicate name: {ids}")

    source_checks: list[dict[str, Any]] = []
    for document in spec.SOURCE_DOCUMENTS:
        storage_ref = document["storage_ref"]
        if "#" in storage_ref:
            source_checks.append(
                {
                    "source_document_id": document["source_document_id"],
                    "status": "outer_container_verified_inner_hash_recorded",
                    "expected_sha256": document["sha256"],
                }
            )
            continue
        path = REPO_ROOT / storage_ref
        if not path.exists():
            errors.append(f"source file missing: {storage_ref}")
            continue
        actual = sha256(path)
        status = "match" if actual == document["sha256"] else "mismatch"
        source_checks.append(
            {
                "source_document_id": document["source_document_id"],
                "status": status,
                "expected_sha256": document["sha256"],
                "actual_sha256": actual,
            }
        )
        if status == "mismatch":
            errors.append(f"source hash changed: {storage_ref}")

    if errors:
        raise ValueError("curation validation failed:\n- " + "\n- ".join(errors))

    return {
        "status": "passed",
        "errors": errors,
        "warnings": warnings,
        "source_checks": source_checks,
    }


def acceptance_criteria() -> list[dict[str, Any]]:
    rows = []
    for node in spec.NODES.values():
        if not node["atomic"]:
            continue
        rows.append(
            {
                "acceptance_criterion_id": f"AC-{node['requirement_id']}",
                "requirement_id": node["requirement_id"],
                "criterion_statement": node["verification_method"],
                "criterion_status": (
                    "candidate_needs_customer_confirmation"
                    if node["needs_confirmation"]
                    else "candidate"
                ),
                "threshold": None,
                "measurement_method": node["verification_method"],
                "origin_kind": "domain_decomposition",
            }
        )
    return rows


def layout_positions() -> list[dict[str, Any]]:
    return [
        {
            "graph_layout_position_id": f"GLP-GV-BUSINESS-DEFAULT-{node_id}",
            "graph_view_id": "GV-BUSINESS-DEFAULT",
            "node_kind": "business_requirement",
            "node_id": node_id,
            "x": None,
            "y": None,
            "z": None,
            "position_source": "unassigned",
            "locked": False,
        }
        for node_id in sorted(spec.NODES)
    ]


def normalized_dedup_tables() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    decisions = []
    links = []
    for decision in spec.DEDUP_DECISIONS:
        decision_row = {key: value for key, value in decision.items() if key != "candidate_requirement_ids"}
        decisions.append(decision_row)
        for index, requirement_id in enumerate(decision["candidate_requirement_ids"], start=1):
            links.append(
                {
                    "dedup_decision_requirement_link_id": f"DDR-{decision['dedup_decision_id']}-{index:02d}",
                    "dedup_decision_id": decision["dedup_decision_id"],
                    "requirement_id": requirement_id,
                    "candidate_order": index,
                }
            )
    return decisions, links


def normalized_open_question_tables() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    questions = []
    links = []
    for question in spec.OPEN_QUESTIONS:
        question_row = {key: value for key, value in question.items() if key != "affects_requirement_ids"}
        question_row["status"] = "open"
        questions.append(question_row)
        for index, requirement_id in enumerate(question["affects_requirement_ids"], start=1):
            links.append(
                {
                    "open_question_requirement_link_id": f"OQR-{question['open_question_id']}-{index:02d}",
                    "open_question_id": question["open_question_id"],
                    "requirement_id": requirement_id,
                }
            )
    return questions, links


def normalized_graph_view_tables() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    views = []
    filters = []
    dimension_by_key = {
        "organization": "SD-ORG",
        "cad_discipline": "SD-DISCIPLINE",
        "product_domain": "SD-DOMAIN",
    }
    for view in spec.GRAPH_VIEWS:
        view_row = {key: value for key, value in view.items() if key != "filter_set"}
        views.append(view_row)
        for filter_key, scope_value_ids in view.get("filter_set", {}).items():
            for index, scope_value_id in enumerate(scope_value_ids, start=1):
                filters.append(
                    {
                        "graph_view_filter_id": f"GVF-{view['graph_view_id']}-{filter_key}-{index:02d}",
                        "graph_view_id": view["graph_view_id"],
                        "scope_dimension_id": dimension_by_key[filter_key],
                        "scope_value_id": scope_value_id,
                        "operator": "include",
                    }
                )
    return views, filters


def derived_depths() -> dict[str, int]:
    children: dict[str, list[str]] = defaultdict(list)
    for row in spec.RELATIONS:
        if row["relation_kind"] in HIERARCHY_RELATIONS:
            children[row["parent_requirement_id"]].append(row["child_requirement_id"])
    depths = {"BR-000": 0}
    queue: deque[str] = deque(["BR-000"])
    while queue:
        parent = queue.popleft()
        for child in children.get(parent, []):
            candidate = depths[parent] + 1
            if child not in depths or candidate < depths[child]:
                depths[child] = candidate
                queue.append(child)
    return depths


def tree_markdown(manifest: dict[str, Any]) -> str:
    nodes = spec.NODES
    children: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for relation in spec.RELATIONS:
        children[relation["parent_requirement_id"]].append(relation)
    for values in children.values():
        values.sort(key=lambda row: (row["display_order"], row["child_requirement_id"]))

    lines = [
        "# 沈变客户需求业务实体树",
        "",
        "> 这是 Data Layer 生成视图。客户原话、规范化名称和领域拆分已分开标记；源文件仍以 `client-data/` 中不可变原文为准。",
        "",
        f"- 需求实体：{manifest['counts']['requirement_nodes']} 个",
        f"- 客户可读一级需求：{manifest['counts']['level_one_requirements']} 个",
        f"- 可独立验证的原子需求：{manifest['counts']['atomic_requirements']} 个",
        f"- 需求关系：{manifest['counts']['requirement_relations']} 条",
        f"- 待确认问题：{manifest['counts']['open_questions']} 个",
        "",
        "## 一级需求",
        "",
    ]
    top_relations = [
        row
        for row in children["BR-000"]
        if row["relation_kind"] == "contains_requirement"
    ]
    for relation in top_relations:
        node = nodes[relation["child_requirement_id"]]
        suffix = f"（原表优先级 {node['priority_order']}）" if node["priority_order"] else ""
        lines.append(f"- `{node['requirement_id']}` {node['name']}{suffix}")

    lines.extend(["", "## 完整拆分", ""])
    for relation in top_relations:
        top_id = relation["child_requirement_id"]
        top = nodes[top_id]
        lines.extend([f"### {top_id} {top['name']}", ""])
        render_children(lines, top_id, children, nodes, depth=0)
        lines.append("")

    lines.extend(
        [
            "## 说明",
            "",
            "- `客户原述`：直接来自原始 XLSX、DOCX 或其内嵌附件。",
            "- `规范化`：只改变组织和命名，不新增客户事实。",
            "- `领域拆分`：为独立开发、运行和验收而推导，仍需客户规则或样本确认。",
            "- `复用`：同一个下层需求实体被多个业务场景引用，不复制成同义节点。",
            "- 坐标不属于需求实体事实；默认视图的 x/y/z 目前全部为空。",
            "",
        ]
    )
    return "\n".join(lines)


def render_children(
    lines: list[str],
    parent_id: str,
    children: dict[str, list[dict[str, Any]]],
    nodes: dict[str, dict[str, Any]],
    *,
    depth: int,
) -> None:
    for relation in children.get(parent_id, []):
        if relation["relation_kind"] not in NAVIGATION_RELATIONS:
            continue
        child = nodes[relation["child_requirement_id"]]
        indent = "  " * depth
        if relation["relation_kind"] == "reuses_requirement":
            lines.append(f"{indent}- ↪ 复用 `{child['requirement_id']}` {child['name']}")
            continue
        origin_label = {
            "customer_stated": "客户原述",
            "normalized": "规范化",
            "domain_decomposition": "领域拆分",
        }.get(child["origin_kind"], child["origin_kind"])
        marker = "原子" if child["atomic"] else "分组"
        confirm = "；待客户确认规则" if child["needs_confirmation"] else ""
        lines.append(
            f"{indent}- `{child['requirement_id']}` {child['name']}（{marker}；{origin_label}{confirm}）"
        )
        if not child["atomic"]:
            render_children(lines, child["requirement_id"], children, nodes, depth=depth + 1)


def source_matrix_markdown() -> str:
    source_links_by_requirement: dict[str, list[str]] = defaultdict(list)
    for row in spec.SOURCE_LINKS:
        source_links_by_requirement[row["requirement_id"]].append(row["source_evidence_id"])
    lines = [
        "# 一级需求与原始证据矩阵",
        "",
        "一级需求名称保持客户可理解的朴素表达；证据 ID 可在 `source_evidence.jsonl` 中解析到文件和单元格/段落/表格位置。",
        "",
        "| 需求 ID | 一级需求 | 原始证据 | 优先级/标记 |",
        "|---|---|---|---|",
    ]
    for relation in sorted(
        (row for row in spec.RELATIONS if row["parent_requirement_id"] == "BR-000"),
        key=lambda row: row["display_order"],
    ):
        node = spec.NODES[relation["child_requirement_id"]]
        evidence_ids = ", ".join(f"`{value}`" for value in source_links_by_requirement[node["requirement_id"]])
        priority = str(node["priority_order"]) if node["priority_order"] else "访谈场景"
        if node["source_emphasis"]:
            priority += f"；原表{node['source_emphasis']}标记（含义未知）"
        lines.append(f"| `{node['requirement_id']}` | {node['name']} | {evidence_ids} | {priority} |")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    validation = validate()
    depths = derived_depths()
    nodes = []
    for node_id in sorted(spec.NODES):
        node = dict(spec.NODES[node_id])
        node["derived_min_depth"] = depths.get(node_id)
        nodes.append(node)

    criteria = acceptance_criteria()
    positions = layout_positions()
    dedup_decisions, dedup_links = normalized_dedup_tables()
    open_questions, open_question_links = normalized_open_question_tables()
    graph_views, graph_view_filters = normalized_graph_view_tables()
    level_one_count = sum(
        1
        for row in spec.RELATIONS
        if row["parent_requirement_id"] == "BR-000"
        and row["relation_kind"] == "contains_requirement"
    )
    manifest = {
        "dataset_id": "shenbian.client_requirements.curated.v1",
        "schema_version": "1.0",
        "build_status": "valid",
        "counts": {
            "source_documents": len(spec.SOURCE_DOCUMENTS),
            "source_evidence": len(spec.SOURCE_EVIDENCE),
            "requirement_nodes": len(nodes),
            "level_one_requirements": level_one_count,
            "atomic_requirements": sum(1 for row in nodes if row["atomic"]),
            "requirement_relations": len(spec.RELATIONS),
            "source_links": len(spec.SOURCE_LINKS),
            "aliases": len(spec.ALIASES),
            "dedup_decisions": len(dedup_decisions),
            "dedup_decision_requirement_links": len(dedup_links),
            "scope_dimensions": len(spec.SCOPE_DIMENSIONS),
            "scope_values": len(spec.SCOPE_VALUES),
            "scope_links": len(spec.REQUIREMENT_SCOPE_LINKS),
            "acceptance_criteria": len(criteria),
            "open_questions": len(open_questions),
            "open_question_requirement_links": len(open_question_links),
            "graph_views": len(graph_views),
            "graph_view_filters": len(graph_view_filters),
            "graph_layout_positions": len(positions),
        },
        "requirement_kind_counts": dict(sorted(Counter(row["requirement_kind"] for row in nodes).items())),
        "origin_kind_counts": dict(sorted(Counter(row["origin_kind"] for row in nodes).items())),
        "validation": validation,
    }

    tables = {
        "source_documents.jsonl": spec.SOURCE_DOCUMENTS,
        "source_evidence.jsonl": spec.SOURCE_EVIDENCE,
        "requirement_nodes.jsonl": nodes,
        "requirement_relations.jsonl": spec.RELATIONS,
        "requirement_source_links.jsonl": spec.SOURCE_LINKS,
        "requirement_aliases.jsonl": spec.ALIASES,
        "dedup_decisions.jsonl": dedup_decisions,
        "dedup_decision_requirement_links.jsonl": dedup_links,
        "scope_dimensions.jsonl": spec.SCOPE_DIMENSIONS,
        "scope_values.jsonl": spec.SCOPE_VALUES,
        "requirement_scope_links.jsonl": spec.REQUIREMENT_SCOPE_LINKS,
        "acceptance_criteria.jsonl": criteria,
        "open_questions.jsonl": open_questions,
        "open_question_requirement_links.jsonl": open_question_links,
        "graph_views.jsonl": graph_views,
        "graph_view_filters.jsonl": graph_view_filters,
        "graph_layout_positions.jsonl": positions,
    }
    for filename, rows in tables.items():
        write_jsonl(output / filename, rows)

    (output / "requirements-tree.md").write_text(tree_markdown(manifest), encoding="utf-8", newline="\n")
    (output / "source-matrix.md").write_text(source_matrix_markdown(), encoding="utf-8", newline="\n")
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(json.dumps(manifest["counts"], ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
