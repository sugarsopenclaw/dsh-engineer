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
    from .host_isolation import isolate_autocad_enrichment
else:
    from catalog_queue import CatalogValidationError
    from com_enrichment import ComEnrichmentError, run_loop, semantic_candidate_allowed
    from host_isolation import isolate_autocad_enrichment

SCHEMA_VERSION = "1.0"
PROCESSOR_KIND = "rule"
PROCESSOR_NAME = "lisp-command-atom-kind-rules"
RUN_ID = "thcad-v24.lisp-command.kind-rules.v1"
BATCH_SIZE = 100
SOURCE_CONFIDENCE = 0.72
TOKEN_CONFIDENCE = 0.58
MACRO_CONFIDENCE = 0.6
DEFERRED_CONFIDENCE = 0.2

_DOMAIN_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"xuhao|序号", re.IGNORECASE), "xuhao"),
    (re.compile(r"\bbom\b|明细", re.IGNORECASE), "bom"),
    (re.compile(r"paperspace|layout|图纸|布局", re.IGNORECASE), "paper"),
    (re.compile(r"plot|print|打印|出图", re.IGNORECASE), "plot"),
    (re.compile(r"select|pickfirst|选择", re.IGNORECASE), "selection"),
    (re.compile(r"layer|图层", re.IGNORECASE), "layer"),
    (re.compile(r"block|块参照|图块", re.IGNORECASE), "block"),
    (re.compile(r"attribute|attrib|属性", re.IGNORECASE), "attribute"),
    (re.compile(r"mtext|dbtext|textstyle|\btext\b|文字|标注文字", re.IGNORECASE), "text"),
    (re.compile(r"dimension|\bdim|标注", re.IGNORECASE), "dimension"),
    (re.compile(r"\btable\b|表格", re.IGNORECASE), "table"),
    (
        re.compile(
            r"polyline|polygon|circle|arc\b|spline|ellipse|line\b|geometry|偏移|圆|直线",
            re.IGNORECASE,
        ),
        "geometry",
    ),
    (re.compile(r"\bentity\b|erase|delete|删除|实体", re.IGNORECASE), "entity"),
    (re.compile(r"database|dbobject|lisp", re.IGNORECASE), "database"),
    (re.compile(r"document|dwg|drawing|图纸", re.IGNORECASE), "document"),
    (re.compile(r"command|cui|macro|menu|菜单|工具栏", re.IGNORECASE), "ui"),
    (re.compile(r"file|open|save|import|export|文件", re.IGNORECASE), "file"),
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _member_name(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("name") or "")


def _signature(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("signature") or "")


def _locator(atom: dict[str, Any]) -> dict[str, Any]:
    provenance = atom.get("provenance") or {}
    locator = provenance.get("source_locator")
    return locator if isinstance(locator, dict) else {}


def _metadata(atom: dict[str, Any]) -> dict[str, Any]:
    metadata = atom.get("surface_metadata")
    return metadata if isinstance(metadata, dict) else {}


def evidence_path_of(atom: dict[str, Any]) -> str:
    locator = _locator(atom)
    metadata = _metadata(atom)
    return str(locator.get("evidence_path") or metadata.get("evidence_path") or "")


def _haystack(atom: dict[str, Any]) -> str:
    locator = _locator(atom)
    metadata = _metadata(atom)
    return " ".join(
        str(part)
        for part in (
            _member_name(atom),
            _signature(atom),
            locator.get("file"),
            locator.get("symbol"),
            locator.get("token"),
            locator.get("macro_name"),
            metadata.get("file"),
            metadata.get("command"),
            metadata.get("token"),
            " ".join(str(token) for token in (metadata.get("command_tokens") or [])),
            atom.get("atom_kind"),
        )
        if part
    )


def domain_tags_for(atom: dict[str, Any]) -> list[str]:
    text = _haystack(atom)
    tags: list[str] = []
    seen: set[str] = set()
    for pattern, tag in _DOMAIN_PATTERNS:
        if tag in seen:
            continue
        if pattern.search(text):
            tags.append(tag)
            seen.add(tag)
    kind = atom.get("atom_kind")
    if kind == "macro" and "ui" not in seen:
        tags.append("ui")
    elif kind == "lisp_function" and "database" not in seen:
        tags.append("database")
    elif kind == "command" and "ui" not in seen:
        tags.append("ui")
    return tags


def _evidence(kind: str, ref: str, claim: str) -> dict[str, str]:
    return {"kind": kind, "ref": ref, "claim": claim}


def _slug(value: str) -> str:
    stripped = value
    if stripped.upper().startswith("C:"):
        stripped = stripped[2:]
    slug = re.sub(r"[^a-z0-9]+", "-", stripped.casefold()).strip("-")
    return (slug[:48] or "unnamed")


def _candidate(
    semantic_id: str,
    label: str,
    confidence: float,
    basis: str,
    *,
    status: str = "proposed",
) -> dict[str, Any]:
    if status == "verified":
        raise ComEnrichmentError("classifier must not mark semantic candidates verified")
    return {
        "semantic_capability_id": semantic_id,
        "label": label,
        "confidence": confidence,
        "status": status,
        "basis": basis,
    }


def _source_code_evidence(atom: dict[str, Any]) -> dict[str, str] | None:
    locator = _locator(atom)
    file_name = locator.get("file")
    line = locator.get("line")
    if not isinstance(file_name, str) or not file_name:
        return None
    if not isinstance(line, int):
        return None
    name = _member_name(atom)
    return _evidence(
        "source_code",
        f"{file_name}:{line}",
        f"LSP 源码 {file_name} 第 {line} 行定义 {name}；函数体未嵌入原子，本阶段不启动 CAD 读取。",
    )


def _alias_candidate(atom: dict[str, Any], name: str) -> dict[str, Any]:
    path = evidence_path_of(atom)
    slug = _slug(name)
    return _candidate(
        f"sem:cad.symbol.{slug}",
        f"符号 {name}",
        0.4,
        f"name={name}; observed-in={path or atom.get('atom_kind')}; alias/equivalence only, do not merge atoms",
    )


def classify_atom(
    atom: dict[str, Any],
    *,
    processed_at: str | None = None,
    run_id: str = RUN_ID,
) -> dict[str, Any]:
    atom_kind = atom["atom_kind"]
    name = _member_name(atom) or atom["atom_id"]
    signature = _signature(atom) or name
    path = evidence_path_of(atom)
    metadata = _metadata(atom)
    locator = _locator(atom)
    evidence: list[dict[str, str]] = []
    candidates: list[dict[str, Any]] = []
    operation_kinds: list[str] = []
    status = "classified"
    summary: str | None
    notes: str | None
    confidence: float

    if atom_kind == "lisp_function" and path == "lsp_source":
        operation_kinds.append("invoke")
        confidence = SOURCE_CONFIDENCE
        file_name = locator.get("file")
        line = locator.get("line")
        summary = f"调用 LSP 函数 {name}（{file_name}:{line}）。"
        source_evidence = _source_code_evidence(atom)
        if source_evidence:
            evidence.append(source_evidence)
        evidence.append(_evidence("signature", signature, f"atom_kind=lisp_function，源码定位 {file_name}:{line}。"))
        candidates.append(
            _candidate("sem:cad.lisp.function", "LSP 函数", 0.55, f"source lisp_function {name}")
        )
        candidates.append(_alias_candidate(atom, name))
        notes = "已引用 LSP 文件与行号，参数协议与图纸效果未经验证，不得视为 verified。"

    elif atom_kind == "lisp_function":
        status = "deferred"
        operation_kinds.append("unknown")
        confidence = DEFERRED_CONFIDENCE
        summary = None
        notes = (
            f"运行时仅观测到 LISP 符号名 {name}，没有参数协议或源码定位，暂缓分类；"
            "需要交互验证，本阶段不调用该符号。"
        )
        evidence.append(_evidence("member_name", name, notes))

    elif atom_kind == "command" and path == "source_defun":
        operation_kinds.append("invoke")
        confidence = SOURCE_CONFIDENCE
        file_name = locator.get("file")
        line = locator.get("line")
        summary = f"调用源码 C: 命令 {name}（{file_name}:{line}）。"
        source_evidence = _source_code_evidence(atom)
        if source_evidence:
            evidence.append(source_evidence)
        evidence.append(_evidence("signature", signature, f"atom_kind=command，source_defun {name}。"))
        candidates.append(
            _candidate("sem:cad.command.invoke", "命令入口", 0.5, f"source C: command {name}")
        )
        candidates.append(_alias_candidate(atom, name))
        notes = "已引用 LSP 定义，未调用命令验证效果。"

    elif atom_kind == "command" and path == "cui_token":
        operation_kinds.append("invoke")
        confidence = TOKEN_CONFIDENCE
        file_name = locator.get("file") or metadata.get("file")
        summary = f"CUI 宏中提取的命令 token {name}（来源 {file_name}），不是菜单宏本身。"
        evidence.append(_evidence("member_name", name, f"从宏命令串提取 token {name}，未执行。"))
        evidence.append(_evidence("signature", signature, f"atom_kind=command，cui_token，文件 {file_name}。"))
        candidates.append(
            _candidate(
                f"sem:cad.command.{_slug(name)}",
                f"命令 {name}",
                0.45,
                f"CUI token {name}; proposed only",
            )
        )
        candidates.append(_alias_candidate(atom, name))
        notes = "命令 token 无参数协议；不得因菜单标题或宏序列自动 verified。"

    elif atom_kind == "command":
        status = "deferred"
        operation_kinds.append("unknown")
        confidence = DEFERRED_CONFIDENCE
        summary = None
        notes = (
            f"运行时仅观测到命令名 {name}，没有参数协议，暂缓分类；"
            "列入需交互验证清单，本阶段不 SendCommand。"
        )
        evidence.append(_evidence("member_name", name, notes))

    elif atom_kind == "macro":
        operation_kinds.append("invoke")
        confidence = MACRO_CONFIDENCE
        command = str(metadata.get("command") or signature)
        tokens = [str(token) for token in (metadata.get("command_tokens") or []) if token]
        summary = (
            f"CUI 宏「{name}」是编排入口，完整命令串为「{command}」；"
            "不得把串内多个命令的综合效果归到其中任意单个命令。"
        )
        evidence.append(_evidence("signature", command, f"宏完整命令串来自 {locator.get('file') or metadata.get('file')}。"))
        evidence.append(_evidence("member_name", name, f"菜单标题 {name} 仅作 proposed 候选，不得自动 verified。"))
        candidates.append(
            _candidate(
                "sem:cad.macro.sequence",
                "宏编排入口",
                0.5,
                f"macro sequence {command[:180]}; orchestration only",
            )
        )
        if name.strip():
            candidates.append(
                _candidate(
                    f"sem:cad.menu.{_slug(name)}",
                    f"菜单 {name}",
                    0.35,
                    f"Chinese menu title {name}; proposed only",
                )
            )
        for token in tokens:
            candidates.append(
                _candidate(
                    f"sem:cad.command.{_slug(token)}",
                    f"宏内 token {token}",
                    0.35,
                    f"token {token} in macro {name}; not the macro itself",
                )
            )
        notes = "宏只作为编排入口；内部 token 另有 command 原子，禁止合并或把综合效果归到单条命令。"

    else:
        status = "deferred"
        operation_kinds.append("unknown")
        confidence = 0.1
        summary = None
        notes = f"没有针对 atom_kind={atom_kind} evidence_path={path} 的确定性规则，暂缓分类。"
        evidence.append(_evidence("signature", signature or atom["atom_id"], notes))

    unique_kinds: list[str] = []
    for kind in operation_kinds:
        if kind not in unique_kinds:
            unique_kinds.append(kind)

    unique_candidates: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for candidate in candidates:
        if not semantic_candidate_allowed(candidate, evidence):
            raise ComEnrichmentError("verified semantic candidate lacks runtime_probe/human_review")
        key = candidate["semantic_capability_id"]
        if key in seen_ids:
            continue
        seen_ids.add(key)
        unique_candidates.append(candidate)

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
            "semantic_candidates": unique_candidates,
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
    parser = argparse.ArgumentParser(description="Deterministic LISP/command/macro capability enrichment loop.")
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
