"""Compare AutoCAD COM and MLightCAD captures from one real-project case."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SEMANTIC_FIELDS = (
    "bbox",
    "start",
    "end",
    "length",
    "vertices",
    "closed",
    "area",
    "center",
    "radius",
    "start_angle",
    "end_angle",
    "major_axis",
    "radius_ratio",
    "control_points",
    "fit_points",
    "degree",
    "position",
    "height",
    "rotation",
    "style",
    "content",
    "content_clean",
    "measurement",
    "text_override",
    "text_position",
    "point1",
    "point2",
    "name",
    "insert_point",
    "scale",
    "attributes",
    "rows",
    "columns",
    "cells",
    "pattern",
    "loops_count",
    "is_solid",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: object) -> None:
    content = f"{json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)}\n".encode("utf-8")
    atomic_write(path, content)


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}-{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object: {path}")
    return value


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"expected an object at {path}:{line_number}")
        records.append(value)
    return records


def canonical_key(record: dict[str, Any]) -> tuple[str, str]:
    owner = str(record.get("owner_block_name") or "").casefold()
    handle = str(record.get("handle") or "").upper()
    return owner, handle


def display_key(key: tuple[str, str]) -> str:
    return f"{key[0]}::{key[1]}"


def index_records(
    records: Iterable[dict[str, Any]],
) -> tuple[dict[tuple[str, str], dict[str, Any]], list[str]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[canonical_key(record)].append(record)
    duplicates = [display_key(key) for key, values in grouped.items() if len(values) > 1]
    return {key: values[0] for key, values in grouped.items()}, sorted(duplicates)


def values_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        if not math.isfinite(float(left)) or not math.isfinite(float(right)):
            return left == right
        return math.isclose(float(left), float(right), rel_tol=1e-7, abs_tol=1e-5)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(values_equal(a, b) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(values_equal(left[key], right[key]) for key in left)
    return left == right


def semantic_value(field: str, value: Any) -> Any:
    if field == "bbox" and isinstance(value, dict):
        return {
            key: point[:2] if isinstance(point, list) else point
            for key, point in value.items()
        }
    if field in {
        "start",
        "end",
        "center",
        "position",
        "text_position",
        "point1",
        "point2",
        "insert_point",
        "major_axis",
    } and isinstance(value, list):
        return value[:2]
    return value


def bare_handle_collision_count(records: Iterable[dict[str, Any]]) -> int:
    counts = Counter(str(record.get("handle") or "").upper() for record in records)
    return sum(count - 1 for count in counts.values() if count > 1)


def count_by(records: Iterable[dict[str, Any]], field: str) -> dict[str, int]:
    counts = Counter(str(record.get(field) or "(empty)") for record in records)
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def coverage_for_scope(
    scope: str,
    autocad: dict[tuple[str, str], dict[str, Any]],
    mlight: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    a_keys = {key for key, value in autocad.items() if value.get("owner_scope") == scope}
    m_keys = {key for key, value in mlight.items() if value.get("owner_scope") == scope}
    common = a_keys & m_keys
    return {
        "autocad_count": len(a_keys),
        "mlightcad_count": len(m_keys),
        "common_count": len(common),
        "only_autocad_count": len(a_keys - m_keys),
        "only_mlightcad_count": len(m_keys - a_keys),
        "mlightcad_to_autocad_ratio": round(len(m_keys) / len(a_keys), 6) if a_keys else None,
    }


def mismatch_sample(
    keys: Iterable[tuple[str, str]],
    records: dict[tuple[str, str], dict[str, Any]],
    limit: int = 100,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for key in sorted(keys)[:limit]:
        record = records[key]
        result.append(
            {
                "entity_key": display_key(key),
                "handle": record.get("handle"),
                "type": record.get("type"),
                "layer": record.get("layer"),
                "owner_scope": record.get("owner_scope"),
                "owner_block_name": record.get("owner_block_name"),
            }
        )
    return result


def artifact_inventory(case_root: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for group in ("source", "channels", "comparison"):
        root = case_root / group
        if not root.exists():
            continue
        for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
            result.append(
                {
                    "path": path.relative_to(case_root).as_posix(),
                    "size_bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
    return result


def render_markdown(report: dict[str, Any]) -> str:
    scopes = report["entity_coverage"]["by_owner_scope"]
    core = report["common_entity_agreement"]
    evidence = report["evidence_status"]
    lines = [
        "# 双通道实体数据对比报告",
        "",
        f"- case: `{report['case_id']}`",
        f"- source SHA-256: `{report['source']['sha256']}`",
        f"- AutoCAD COM: {report['channels']['autocad-com']['indexed_entity_count']} entities",
        f"- MLightCAD: {report['channels']['mlightcad']['indexed_entity_count']} entities",
        f"- common authored entities: {report['entity_coverage']['common_count']}",
        f"- strict same-snapshot claim allowed: `{str(evidence['strict_same_snapshot_claim_allowed']).lower()}`",
        "",
        "## 结论",
        "",
        *[f"- {note}" for note in report["conclusions"]],
        "",
        "## 按实体所属空间覆盖",
        "",
        "| owner scope | AutoCAD | MLightCAD | common | AutoCAD only | MLight only | ratio |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for scope in ("model_space", "paper_space", "block_definition"):
        row = scopes[scope]
        ratio = row["mlightcad_to_autocad_ratio"]
        lines.append(
            f"| {scope} | {row['autocad_count']} | {row['mlightcad_count']} | "
            f"{row['common_count']} | {row['only_autocad_count']} | "
            f"{row['only_mlightcad_count']} | {ratio if ratio is not None else ''} |"
        )
    lines.extend(
        [
            "",
            "## 共同实体的一致性",
            "",
            "| check | agreement | mismatches |",
            "| --- | ---: | ---: |",
            f"| type | {core['type']['agreement_ratio']} | {core['type']['mismatch_count']} |",
            f"| layer | {core['layer']['agreement_ratio']} | {core['layer']['mismatch_count']} |",
            f"| visible | {core['visible']['agreement_ratio']} | {core['visible']['mismatch_count']} |",
            "",
            "## 证据限制",
            "",
            *[f"- {note}" for note in evidence["limitations"]],
            "",
            "完整字段覆盖、差异样本和产物哈希见 `report.json`。",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", required=True, type=Path, dest="case_root")
    args = parser.parse_args()
    case_root = args.case_root.resolve(strict=True)
    output = case_root / "comparison"

    source_manifest = load_json(case_root / "source" / "manifest.json")
    a_dir = case_root / "channels" / "autocad-com"
    m_dir = case_root / "channels" / "mlightcad"
    a_summary, m_summary = load_json(a_dir / "summary.json"), load_json(m_dir / "summary.json")
    a_provenance, m_provenance = load_json(a_dir / "provenance.json"), load_json(m_dir / "provenance.json")
    a_records, m_records = load_jsonl(a_dir / "entities.raw.jsonl"), load_jsonl(m_dir / "entities.raw.jsonl")
    a_index, a_duplicates = index_records(a_records)
    m_index, m_duplicates = index_records(m_records)
    a_keys, m_keys = set(a_index), set(m_index)
    common_keys = a_keys & m_keys
    only_a, only_m = a_keys - m_keys, m_keys - a_keys

    source_hashes = {
        str(source_manifest["source"]["sha256"]),
        str(a_provenance["source"]["sha256"]),
        str(m_provenance["source"]["sha256"]),
    }
    same_disk_source = len(source_hashes) == 1
    active_document = a_provenance.get("active_document", {})
    strict_snapshot = bool(same_disk_source and active_document.get("saved") and not active_document.get("dbmod"))

    core_agreement: dict[str, Any] = {}
    mismatch_details: dict[str, list[dict[str, Any]]] = {}
    for field in ("type", "layer", "visible"):
        mismatches = [key for key in common_keys if not values_equal(a_index[key].get(field), m_index[key].get(field))]
        core_agreement[field] = {
            "compared_count": len(common_keys),
            "match_count": len(common_keys) - len(mismatches),
            "mismatch_count": len(mismatches),
            "agreement_ratio": round((len(common_keys) - len(mismatches)) / len(common_keys), 6)
            if common_keys
            else None,
        }
        mismatch_details[field] = [
            {
                "entity_key": display_key(key),
                "autocad": a_index[key].get(field),
                "mlightcad": m_index[key].get(field),
            }
            for key in sorted(mismatches)[:100]
        ]

    type_mismatch_keys = [
        key for key in common_keys if a_index[key].get("type") != m_index[key].get("type")
    ]
    type_mismatch_pairs = Counter(
        f"{a_index[key].get('type')} -> {m_index[key].get('type')}" for key in type_mismatch_keys
    )

    field_agreement: dict[str, Any] = {}
    for field in SEMANTIC_FIELDS:
        both = [
            key
            for key in common_keys
            if a_index[key].get(field) is not None and m_index[key].get(field) is not None
        ]
        differing = [
            key
            for key in both
            if not values_equal(
                semantic_value(field, a_index[key][field]),
                semantic_value(field, m_index[key][field]),
            )
        ]
        equal = len(both) - len(differing)
        field_agreement[field] = {
            "autocad_present": sum(record.get(field) is not None for record in a_index.values()),
            "mlightcad_present": sum(record.get(field) is not None for record in m_index.values()),
            "both_present_on_common": len(both),
            "equal_when_both_present": equal,
            "different_when_both_present": len(differing),
            "agreement_ratio_when_comparable": round(equal / len(both), 6) if both else None,
            "different_by_type": count_by((a_index[key] for key in differing), "type"),
        }

    by_scope = {
        scope: coverage_for_scope(scope, a_index, m_index)
        for scope in ("model_space", "paper_space", "block_definition")
    }
    a_elapsed = float(a_summary.get("elapsed_ms") or 0)
    m_elapsed = float(m_summary.get("elapsed_ms") or 0)
    limitations = [
        "两路都遍历原生数据库实体，但都没有把块参照递归展开为场景 occurrence。",
        "代理对象、OLE 内嵌内容及未解析外参仍可能是不透明内容。",
    ]
    if not strict_snapshot:
        limitations.append(
            "AutoCAD 活动文档为未保存/已修改状态；COM 读取内存数据库，MLightCAD 读取经哈希验证的磁盘副本，"
            "因此本次不能宣称是同一字节快照的严格一致性试验。"
        )
    source_graph = m_provenance.get("source_graph")
    if isinstance(source_graph, list) and len(source_graph) > 1:
        limitations.append(
            "MLightCAD 当前不原生绑定外参；本次由采集驱动逐个解析可用外参文件，并按 AutoCAD 的 alias|name "
            "命名空间规则投影后合并。实体键与数量可核对，但这不等同于引擎内原生外参解析。"
        )
    if only_a:
        limitations.append(
            "AutoCAD 独有实体集中在已加载外参或其依赖块定义；MLightCAD 当前不会绑定这些外参内部几何。"
        )

    area_differing = [
        key
        for key in common_keys
        if a_index[key].get("area") is not None
        and m_index[key].get("area") is not None
        and not values_equal(a_index[key]["area"], m_index[key]["area"])
    ]
    open_polyline_area_differences = sum(
        a_index[key].get("type") == "lwpolyline" and not bool(a_index[key].get("closed"))
        for key in area_differing
    )

    conclusions = [
        f"模型空间实体键覆盖为 {by_scope['model_space']['common_count']}/"
        f"{by_scope['model_space']['autocad_count']}，图纸空间为 "
        f"{by_scope['paper_space']['common_count']}/{by_scope['paper_space']['autocad_count']}。",
        f"全库共同实体 {len(common_keys)}；AutoCAD 独有 {len(only_a)}；MLightCAD 独有 {len(only_m)}。",
        f"共同实体类型一致率 {core_agreement['type']['agreement_ratio']}，"
        f"图层一致率 {core_agreement['layer']['agreement_ratio']}。",
    ]
    if type_mismatch_keys:
        if set(type_mismatch_pairs) == {"attributedefinition -> text"}:
            conclusions.append(
                f"{len(type_mismatch_keys)} 个属性定义（AcDbAttributeDefinition）在 MLightCAD 中被降级归类为 text；"
                "句柄、所属块和图层仍可对应。"
            )
        else:
            conclusions.append(
                f"共同实体中有 {len(type_mismatch_keys)} 个类型分类差异："
                + ", ".join(f"{pair} × {count}" for pair, count in sorted(type_mismatch_pairs.items()))
                + "。"
            )
    if area_differing:
        conclusions.append(
            f"面积字段有 {len(area_differing)} 处差异，其中 {open_polyline_area_differences} 处是未闭合多段线："
            "AutoCAD COM 返回隐式首尾闭合面积，MLightCAD 返回 0。算量层不得直接把开放多段线 Area 当作封闭区域面积。"
        )
    bbox_differences = int(field_agreement["bbox"]["different_when_both_present"])
    if bbox_differences:
        bbox_types = field_agreement["bbox"]["different_by_type"]
        assert isinstance(bbox_types, dict)
        breakdown = ", ".join(
            f"{entity_type}×{count}" for entity_type, count in bbox_types.items()
        )
        conclusions.append(
            f"二维归一化后包围盒仍有 {bbox_differences} 处差异（{breakdown}）；"
            "文字差异主要反映两引擎的字体/排版宽度计算，块参照差异需由场景展开层继续核验。"
        )
    if a_elapsed > 0 and m_elapsed > 0:
        conclusions.append(
            f"本次通道内部采集耗时 AutoCAD COM {round(a_elapsed / 1000, 3)} 秒，"
            f"MLightCAD {round(m_elapsed / 1000, 3)} 秒；前者包含逐实体跨进程 COM 调用。"
        )

    report: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": utc_now(),
        "case_id": source_manifest["case_id"],
        "source": source_manifest["source"],
        "channels": {
            "autocad-com": a_summary,
            "mlightcad": m_summary,
        },
        "evidence_status": {
            "same_disk_source_sha256": same_disk_source,
            "strict_same_snapshot_claim_allowed": strict_snapshot,
            "autocad_active_document_saved": active_document.get("saved"),
            "autocad_dbmod": active_document.get("dbmod"),
            "mlightcad_source_graph": source_graph,
            "limitations": limitations,
        },
        "identity": {
            "key": "case-folded owner_block_name + upper-case entity handle",
            "reason": "xref-owned handles can collide with host-drawing handles",
            "autocad_duplicate_keys": a_duplicates,
            "mlightcad_duplicate_keys": m_duplicates,
            "autocad_bare_handle_collision_count": bare_handle_collision_count(a_records),
            "mlightcad_bare_handle_collision_count": bare_handle_collision_count(m_records),
        },
        "entity_coverage": {
            "autocad_count": len(a_index),
            "mlightcad_count": len(m_index),
            "common_count": len(common_keys),
            "only_autocad_count": len(only_a),
            "only_mlightcad_count": len(only_m),
            "by_owner_scope": by_scope,
            "only_autocad_by_owner_block": count_by((a_index[key] for key in only_a), "owner_block_name"),
            "only_autocad_by_type": count_by((a_index[key] for key in only_a), "type"),
            "only_mlightcad_by_owner_block": count_by((m_index[key] for key in only_m), "owner_block_name"),
            "only_mlightcad_by_type": count_by((m_index[key] for key in only_m), "type"),
            "only_autocad_samples": mismatch_sample(only_a, a_index),
            "only_mlightcad_samples": mismatch_sample(only_m, m_index),
        },
        "common_entity_agreement": core_agreement,
        "type_mismatch_pairs": dict(type_mismatch_pairs),
        "core_mismatch_samples": mismatch_details,
        "semantic_field_agreement": field_agreement,
        "area_semantics": {
            "different_count": len(area_differing),
            "open_lwpolyline_different_count": open_polyline_area_differences,
            "autocad_behavior": "returns the area after implicit endpoint closure for open lightweight polylines",
            "mlightcad_behavior": "returns zero for these open lightweight polylines",
        },
        "conclusions": conclusions,
    }
    atomic_json(output / "report.json", report)
    atomic_write(output / "report.md", render_markdown(report).encode("utf-8"))
    run_manifest = {
        "schema_version": 1,
        "case_id": source_manifest["case_id"],
        "status": "captured_and_compared",
        "updated_at": utc_now(),
        "channels": {
            "autocad-com": {
                "indexed_entity_count": a_summary.get("indexed_entity_count"),
                "failed_entity_count": a_summary.get("failed_entity_count"),
            },
            "mlightcad": {
                "indexed_entity_count": m_summary.get("indexed_entity_count"),
                "failed_entity_count": m_summary.get("failed_entity_count"),
            },
        },
        "evidence_status": report["evidence_status"],
        "artifacts": artifact_inventory(case_root),
    }
    atomic_json(case_root / "run" / "manifest.json", run_manifest)
    print(
        json.dumps(
            {
                "ok": True,
                "report": str(output / "report.json"),
                "common_count": len(common_keys),
                "only_autocad_count": len(only_a),
                "only_mlightcad_count": len(only_m),
                "strict_same_snapshot_claim_allowed": strict_snapshot,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
