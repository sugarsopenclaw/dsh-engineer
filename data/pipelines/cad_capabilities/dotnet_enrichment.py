from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

if __package__:
    from .catalog_queue import CatalogValidationError
    from .com_enrichment import ComEnrichmentError, run_loop, semantic_candidate_allowed
    from .host_isolation import isolate_autocad_enrichment, is_autocad_atom
else:
    from catalog_queue import CatalogValidationError
    from com_enrichment import ComEnrichmentError, run_loop, semantic_candidate_allowed
    from host_isolation import isolate_autocad_enrichment, is_autocad_atom

SCHEMA_VERSION = "1.0"
PROCESSOR_KIND = "rule"
PROCESSOR_NAME = "dotnet-atom-kind-rules"
RUN_ID = "thcad-v24.dotnet.kind-rules.v1"
BATCH_SIZE = 100
KIND_CONFIDENCE = 0.82
METHOD_BASE_CONFIDENCE = 0.62
CONTEXT_CONFIDENCE = 0.55
EXPLODE_GEOMETRY_TYPE = "Teigha.DatabaseServices.Entity"
EXPLODE_GEOMETRY_NAME = "ExplodeGeometry"
EXPLODE_GEOMETRY_DOC = "docs/dev/2026-08-27-THCAD-V24-DotNet公开能力盘点.md"

_DELETE_NAME = re.compile(r"^(delete|erase)([A-Z0-9_].*)?$", re.IGNORECASE)
_COMPUTE_RETURN = re.compile(
    r"Point3d|Point2d|Vector3d|Vector2d|Matrix3d|Extents|BoundBlock|"
    r"System\.(Double|Single|Int32|Int16|Int64|Boolean|String|Void)",
    re.IGNORECASE,
)
_DB_TYPE = re.compile(
    r"DBObject|DatabaseServices\.(Entity|Database|BlockTableRecord|Transaction)|"
    r"SymbolTableRecord",
    re.IGNORECASE,
)
_DOMAIN_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"xuhao|xuhaoentity", re.IGNORECASE), "xuhao"),
    (re.compile(r"\bbom\b", re.IGNORECASE), "bom"),
    (re.compile(r"paperspace|layout|\bpaper\b", re.IGNORECASE), "paper"),
    (re.compile(r"plotsettings|\bplot\b", re.IGNORECASE), "plot"),
    (re.compile(r"selection|pickfirst|prompt", re.IGNORECASE), "selection"),
    (re.compile(r"\blayer\b", re.IGNORECASE), "layer"),
    (re.compile(r"blocktablerecord|blockreference|\bblock\b", re.IGNORECASE), "block"),
    (re.compile(r"attribute", re.IGNORECASE), "attribute"),
    (re.compile(r"mtext|dbtext|\btextstyle|\btext\b", re.IGNORECASE), "text"),
    (re.compile(r"dimension|\bdim", re.IGNORECASE), "dimension"),
    (re.compile(r"\btable\b", re.IGNORECASE), "table"),
    (re.compile(
        r"polyline|polygon|circle|arc\b|spline|ellipse|line\b|point3d|vector3d|"
        r"solid3d|surface|mesh|geometry|curve\b|extents",
        re.IGNORECASE,
    ), "geometry"),
    (re.compile(r"\bentity\b", re.IGNORECASE), "entity"),
    (re.compile(r"database|dbobject|transaction", re.IGNORECASE), "database"),
    (re.compile(r"document|dwgfile|drawing", re.IGNORECASE), "document"),
    (re.compile(r"application|editorinput|graphicssystem|brxmgd", re.IGNORECASE), "application"),
    (re.compile(r"window|palette|menu|command", re.IGNORECASE), "ui"),
    (re.compile(r"readdwg|saveas|dxfin|dxfout|\bfile\b", re.IGNORECASE), "file"),
    (re.compile(r"event", re.IGNORECASE), "event"),
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _owner(atom: dict[str, Any]) -> str:
    declaring = atom.get("declaring_symbol") or {}
    full_name = declaring.get("full_name")
    if isinstance(full_name, str) and full_name:
        return full_name
    return str((atom.get("member") or {}).get("name") or atom["atom_id"])


def _member_name(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("name") or "")


def _signature(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("signature") or "")


def _return_type(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("return_type") or "")


def _haystack(atom: dict[str, Any]) -> str:
    metadata = atom.get("surface_metadata") or {}
    source = atom.get("source_artifact") or {}
    return " ".join(
        str(part)
        for part in (
            _owner(atom),
            _member_name(atom),
            _signature(atom),
            _return_type(atom),
            source.get("name"),
            metadata.get("assembly"),
            metadata.get("declaring_type"),
            atom.get("atom_kind"),
        )
        if part
    )


def domain_tags_for(atom: dict[str, Any]) -> list[str]:
    text = _haystack(atom)
    tags: list[str] = []
    seen: set[str] = set()
    if atom.get("atom_kind") in {"event_subscribe", "event_unsubscribe"}:
        tags.append("event")
        seen.add("event")
    for pattern, tag in _DOMAIN_PATTERNS:
        if tag in seen:
            continue
        if pattern.search(text):
            tags.append(tag)
            seen.add(tag)
    library = str((atom.get("source_artifact") or {}).get("name") or "")
    defaults = {
        "BrxMgd": "application",
        "TD_Mgd": "database",
        "TD_MgdBrep": "geometry",
        "TD_MgdDbConstraints": "geometry",
        "TA_Mgd": "entity",
        "TA_MgdArch": "entity",
        "TA_MgdStructure": "entity",
    }
    default = defaults.get(library)
    if default and default not in seen:
        tags.append(default)
    return tags


def _evidence(kind: str, ref: str, claim: str) -> dict[str, str]:
    return {"kind": kind, "ref": ref, "claim": claim}


def _candidate(
    semantic_id: str,
    label: str,
    confidence: float,
    basis: str,
    *,
    status: str = "proposed",
) -> dict[str, Any]:
    return {
        "semantic_capability_id": semantic_id,
        "label": label,
        "confidence": confidence,
        "status": status,
        "basis": basis,
    }


def _pascal_prefix(name: str, prefixes: tuple[str, ...]) -> bool:
    for prefix in prefixes:
        if name == prefix or name.startswith(prefix + "_"):
            return True
        if name.startswith(prefix) and len(name) > len(prefix) and name[len(prefix)].isupper():
            return True
    return False


def is_entity_explode_geometry(atom: dict[str, Any]) -> bool:
    if is_autocad_atom(atom):
        return False
    return (
        atom.get("atom_kind") == "method"
        and _member_name(atom) == EXPLODE_GEOMETRY_NAME
        and _owner(atom) == EXPLODE_GEOMETRY_TYPE
    )


def _method_context(
    atom: dict[str, Any],
) -> tuple[list[str], list[dict[str, str]], list[dict[str, Any]], str | None]:
    name = _member_name(atom)
    declaring = _owner(atom)
    return_type = _return_type(atom)
    signature = _signature(atom)
    kinds: list[str] = []
    evidence: list[dict[str, str]] = []
    candidates: list[dict[str, Any]] = []
    summary_extra: str | None = None
    db_context = bool(_DB_TYPE.search(declaring))
    compute_return = bool(_COMPUTE_RETURN.search(return_type or signature))

    if _DELETE_NAME.match(name):
        kinds.append("delete")
        if db_context:
            kinds.append("edit")
        evidence.append(
            _evidence(
                "member_name",
                name,
                f"{declaring}.{name} 方法名匹配 Delete/Erase，提出 delete；声明类型={declaring}，未经验证。",
            )
        )
        candidates.append(
            _candidate(
                "sem:cad.object.delete",
                "删除对象",
                0.45,
                f"member_name={name} on {declaring}; not verified",
            )
        )
        summary_extra = f"调用 {declaring}.{name}；方法名提示删除，尚未运行时验证。"

    if is_entity_explode_geometry(atom):
        kinds.extend(["compute", "read"])
        evidence.append(
            _evidence(
                "runtime_probe",
                EXPLODE_GEOMETRY_DOC,
                "TH_XuHaoEntity 上实测 Entity.ExplodeGeometry 可用。该证据只绑定 Teigha.DatabaseServices.Entity.ExplodeGeometry。",
            )
        )
        evidence.append(
            _evidence(
                "documentation",
                EXPLODE_GEOMETRY_DOC,
                "能力盘点记录 ExplodeGeometry 对 TH_XuHaoEntity 的运行时结果，不得推广到 Explode 或其他成员。",
            )
        )
        candidates.append(
            _candidate(
                "sem:cad.entity.explode_geometry",
                "分解实体几何",
                0.85,
                "runtime_probe: TH_XuHaoEntity / Entity.ExplodeGeometry only",
                status="verified",
            )
        )
        summary_extra = (
            f"调用 {declaring}.{name} 分解几何；已有 TH_XuHaoEntity 运行时证据，不推广到其他成员。"
        )
        return kinds, evidence, candidates, summary_extra

    if _pascal_prefix(name, ("Get", "Is", "Has", "Can")) or name.startswith("get_"):
        kinds.append("read")
        if compute_return or not db_context:
            kinds.append("compute")
        evidence.append(
            _evidence(
                "signature",
                signature,
                f"{declaring}.{name} 结合返回类型 {return_type or 'unknown'} 视为读取/计算，不因 Get 前缀当作写入。",
            )
        )
    elif name.startswith(("Set", "set_")):
        kinds.append("edit")
        evidence.append(
            _evidence(
                "signature",
                signature,
                f"{declaring}.{name} 在声明类型 {declaring} 上视为写入。",
            )
        )
    elif name.startswith(("Save", "SaveAs")) or name in {"DxfOut", "DwgOut", "WriteDwgFile"}:
        kinds.append("save")
        evidence.append(_evidence("member_name", name, f"{declaring}.{name} 结合类型视为保存。"))
    elif name.startswith(("ReadDwg", "DxfIn", "ReadDxf")):
        kinds.append("import")
        evidence.append(_evidence("member_name", name, f"{declaring}.{name} 结合类型视为导入。"))
    elif name.startswith(("Add", "Append", "Create", "Insert", "New")):
        kinds.append("create")
        if db_context:
            kinds.append("edit")
            evidence.append(
                _evidence(
                    "signature",
                    signature,
                    f"{declaring}.{name} 在数据库对象上可能创建并写入；内存工厂则仅为 create。",
                )
            )
        else:
            evidence.append(
                _evidence(
                    "signature",
                    signature,
                    f"{declaring}.{name} 无 DBObject 声明上下文，仅提出 in-memory create。",
                )
            )
    elif name in {"Commit", "Abort"} and "Transaction" in declaring:
        kinds.append("lifecycle")
        if name == "Commit":
            kinds.append("edit")
        evidence.append(
            _evidence("signature", signature, f"{declaring}.{name} 为事务提交/回滚，不是普通 Get/Set。")
        )
    elif re.match(r"^(Move|Rotate|Scale|Transform|Mirror|Offset)", name):
        kinds.append("transform")
        if db_context:
            kinds.append("edit")
        evidence.append(_evidence("member_name", name, f"{declaring}.{name} 提出变换。"))
    elif name.startswith(("Select", "GetSelection", "SelectAll")):
        kinds.append("select")
        evidence.append(_evidence("member_name", name, f"{declaring}.{name} 提出选择。"))

    unique: list[str] = []
    for kind in kinds:
        if kind not in unique:
            unique.append(kind)
    return unique, evidence, candidates, summary_extra


def classify_atom(
    atom: dict[str, Any],
    *,
    processed_at: str | None = None,
    run_id: str = RUN_ID,
) -> dict[str, Any]:
    atom_kind = atom["atom_kind"]
    name = _member_name(atom)
    signature = _signature(atom) or name
    owner = _owner(atom)
    operation_kinds: list[str] = []
    evidence: list[dict[str, str]] = []
    candidates: list[dict[str, Any]] = []
    confidence = KIND_CONFIDENCE
    status = "classified"
    notes: str | None = None
    summary: str | None

    if atom_kind in {"property_get", "field_read"}:
        operation_kinds.append("read")
        summary = f"读取 {owner} 的 {name}。"
        evidence.append(_evidence("signature", signature, f"atom_kind={atom_kind}，按签名视为读取。"))
        candidates.append(_candidate("sem:cad.property.read", "读取成员", 0.7, f"atom_kind={atom_kind}"))
    elif atom_kind in {"property_set", "field_write"}:
        operation_kinds.append("edit")
        summary = f"写入 {owner} 的 {name}。"
        evidence.append(_evidence("signature", signature, f"atom_kind={atom_kind}，按签名视为写入。"))
        candidates.append(_candidate("sem:cad.property.write", "写入成员", 0.7, f"atom_kind={atom_kind}"))
    elif atom_kind == "constructor":
        operation_kinds.extend(["create", "lifecycle"])
        summary = f"构造 {owner} 的新实例。"
        evidence.append(_evidence("signature", signature, "atom_kind=constructor，视为创建或生命周期入口。"))
        candidates.append(_candidate("sem:cad.object.create", "构造对象", 0.65, "atom_kind=constructor"))
    elif atom_kind == "event_subscribe":
        operation_kinds.append("event")
        summary = f"订阅 {owner} 的 {name} 事件。"
        evidence.append(_evidence("signature", signature, "atom_kind=event_subscribe。"))
        candidates.append(_candidate("sem:cad.event.subscribe", "订阅事件", 0.7, "atom_kind=event_subscribe"))
    elif atom_kind == "event_unsubscribe":
        operation_kinds.append("event")
        summary = f"取消订阅 {owner} 的 {name} 事件。"
        evidence.append(_evidence("signature", signature, "atom_kind=event_unsubscribe。"))
        candidates.append(_candidate("sem:cad.event.unsubscribe", "取消订阅事件", 0.7, "atom_kind=event_unsubscribe"))
    elif atom_kind == "method":
        operation_kinds.append("invoke")
        confidence = METHOD_BASE_CONFIDENCE
        summary = f"调用 {owner}.{name}。"
        evidence.append(
            _evidence(
                "signature",
                signature,
                f"atom_kind=method；声明类型 {owner}，返回 {_return_type(atom) or 'unknown'}，基础分类为 invoke。",
            )
        )
        extra_kinds, extra_evidence, extra_candidates, extra_summary = _method_context(atom)
        if extra_kinds or extra_evidence:
            if not is_entity_explode_geometry(atom):
                confidence = CONTEXT_CONFIDENCE
            else:
                confidence = 0.8
            for kind in extra_kinds:
                if kind not in operation_kinds:
                    operation_kinds.append(kind)
            evidence.extend(extra_evidence)
            candidates.extend(extra_candidates)
            if extra_summary:
                summary = extra_summary
        notes = "参数协议与 TH_* runtime_class 支持矩阵未在元数据阶段验证；Get/Set 不得脱离声明类型下结论。"
    else:
        status = "deferred"
        operation_kinds.append("unknown")
        confidence = 0.1
        summary = None
        notes = f"没有针对 atom_kind={atom_kind} 的确定性规则，暂缓分类。"
        evidence.append(_evidence("signature", signature or atom["atom_id"], notes))

    unique_kinds: list[str] = []
    for kind in operation_kinds:
        if kind not in unique_kinds:
            unique_kinds.append(kind)

    for candidate in candidates:
        if not semantic_candidate_allowed(candidate, evidence):
            raise ComEnrichmentError("verified semantic candidate lacks runtime_probe/human_review")

    return isolate_autocad_enrichment(
        atom,
        {
            "schema_version": SCHEMA_VERSION,
            "inventory_id": atom["inventory_id"],
            "atom_id": atom["atom_id"],
            "status": status,
            "operation_kinds": unique_kinds,
            "domain_tags": domain_tags_for(atom),
            "summary": summary,
            "classification_confidence": confidence,
            "semantic_candidates": candidates,
            "evidence": evidence,
            "processor": {
                "kind": PROCESSOR_KIND,
                "name": PROCESSOR_NAME,
                "run_id": run_id,
            },
            "processed_at": processed_at or _now(),
            "notes": notes,
        },
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic .NET capability enrichment loop.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--atoms", type=Path, required=True)
    parser.add_argument("--enrichments", type=Path, required=True)
    parser.add_argument("--batches", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=BATCH_SIZE)
    args = parser.parse_args(argv)
    try:
        result = run_loop(
            args.manifest,
            args.atoms,
            args.enrichments,
            args.batches,
            limit=args.limit,
            classify=classify_atom,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ComEnrichmentError, CatalogValidationError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
