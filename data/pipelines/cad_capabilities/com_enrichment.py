from __future__ import annotations

import argparse
import io
import json
import re
import sys
from collections.abc import Callable
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

if __package__:
    from .catalog_queue import CatalogValidationError
    from .catalog_queue import main as catalog_main
    from .host_isolation import isolate_autocad_enrichment
else:
    from catalog_queue import CatalogValidationError
    from catalog_queue import main as catalog_main
    from host_isolation import isolate_autocad_enrichment

SCHEMA_VERSION = "1.0"
PROCESSOR_KIND = "rule"
PROCESSOR_NAME = "com-atom-kind-rules"
RUN_ID = "thcad-v24.com.kind-rules.v1"
BATCH_SIZE = 100
KIND_CONFIDENCE = 0.82
METHOD_BASE_CONFIDENCE = 0.62
HEURISTIC_CONFIDENCE = 0.55

# Preferred open-vocabulary tags; not a closed enum.
PREFERRED_DOMAIN_TAGS = (
    "application",
    "document",
    "database",
    "entity",
    "geometry",
    "selection",
    "layer",
    "block",
    "attribute",
    "text",
    "dimension",
    "table",
    "bom",
    "xuhao",
    "paper",
    "plot",
    "file",
    "ui",
    "event",
)

_DOMAIN_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"xuhao|xuhaolabel", re.IGNORECASE), "xuhao"),
    (re.compile(r"bomrecorder|\bbom\b", re.IGNORECASE), "bom"),
    (re.compile(r"paperrecorder|paperspace|paperset|\bpaper\b", re.IGNORECASE), "paper"),
    (re.compile(r"plotstyle|\bplot\b|print", re.IGNORECASE), "plot"),
    (re.compile(r"selectionset|pickfirst|\bselect", re.IGNORECASE), "selection"),
    (re.compile(r"\blayer\b", re.IGNORECASE), "layer"),
    (re.compile(r"\bblock|\bblk", re.IGNORECASE), "block"),
    (re.compile(r"attribute|attrib", re.IGNORECASE), "attribute"),
    (re.compile(r"mtext|\btext|\bfont|\bstyle", re.IGNORECASE), "text"),
    (re.compile(r"dimension|\bdim[a-z]|aligneddim|rotateddim", re.IGNORECASE), "dimension"),
    (re.compile(r"\btable\b|datatable|cell", re.IGNORECASE), "table"),
    (re.compile(r"polyline|polygon|circle|arc\b|spline|ellipse|line\b|point\b|"
                 r"solid\b|surface|mesh|helix|ray\b|xline|geometry|normal\b", re.IGNORECASE), "geometry"),
    (re.compile(r"\bentity|acadobject|objectid|erase|delete", re.IGNORECASE), "entity"),
    (re.compile(r"database|dbobject|thdatabase", re.IGNORECASE), "database"),
    (re.compile(r"document|dwg|drawing", re.IGNORECASE), "document"),
    (re.compile(r"application|acadapplication|bricscadapp", re.IGNORECASE), "application"),
    (re.compile(r"menu|toolbar|palette|dialog|window|status|cmd", re.IGNORECASE), "ui"),
    (re.compile(r"\bfile\b|open|save|import|export|path", re.IGNORECASE), "file"),
    (re.compile(r"event", re.IGNORECASE), "event"),
)

_DELETE_NAME = re.compile(r"^(delete|erase)([A-Z0-9_].*)?$", re.IGNORECASE)
_VERIFIED_EVIDENCE = {"runtime_probe", "human_review"}


class ComEnrichmentError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _owner(atom: dict[str, Any]) -> str:
    declaring = atom.get("declaring_symbol") or {}
    full_name = declaring.get("full_name")
    if isinstance(full_name, str) and full_name:
        return full_name
    member = atom.get("member") or {}
    name = member.get("name")
    if isinstance(name, str) and name:
        return name
    return atom["atom_id"]


def _member_name(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("name") or "")


def _signature(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("signature") or "")


def _haystack(atom: dict[str, Any]) -> str:
    metadata = atom.get("surface_metadata") or {}
    source = atom.get("source_artifact") or {}
    return " ".join(
        str(part)
        for part in (
            _owner(atom),
            _member_name(atom),
            _signature(atom),
            source.get("name"),
            metadata.get("type_library"),
            metadata.get("progid"),
            metadata.get("declaring_interface"),
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
    library_defaults = {
        "BricscadApp": "application",
        "BricscadDb": "database",
        "BricscadSm": "paper",
        "THCadToolKit": "database",
        "THCADPickUp": "file",
        "THCADPickUpEngine": "file",
        "THCADReport": "table",
        "THCADComReport": "table",
        "THCADsCardInfoX": "table",
        "THCADsCardEngine": "table",
    }
    default = library_defaults.get(library)
    if default and default not in seen:
        tags.append(default)
    return tags


def _evidence(kind: str, ref: str, claim: str) -> dict[str, str]:
    return {"kind": kind, "ref": ref, "claim": claim}


def semantic_candidate_allowed(candidate: dict[str, Any], evidence: list[dict[str, Any]]) -> bool:
    if candidate.get("status") != "verified":
        return True
    kinds = {item.get("kind") for item in evidence}
    return bool(kinds & _VERIFIED_EVIDENCE)


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


def _method_heuristics(name: str) -> tuple[list[str], list[dict[str, str]], list[dict[str, Any]]]:
    kinds: list[str] = []
    evidence: list[dict[str, str]] = []
    candidates: list[dict[str, Any]] = []
    if _DELETE_NAME.match(name):
        kinds.append("delete")
        evidence.append(
            _evidence(
                "member_name",
                name,
                f"方法名 {name} 匹配 Delete/Erase，提出 delete 分类，但未经运行时验证。",
            )
        )
        candidates.append(
            _candidate(
                "sem:cad.object.delete",
                "删除 CAD 对象",
                0.45,
                f"member_name={name} 启发式，不得视为 verified。",
            )
        )
    if name.startswith(("add_", "remove_")):
        kinds.append("event")
        evidence.append(
            _evidence("member_name", name, f"方法名 {name} 为事件 add/remove 访问器形态。")
        )
    elif name.startswith(("Get", "get_")):
        kinds.append("read")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 以 Get 开头，提出 read。"))
    elif name.startswith(("Set", "set_")):
        kinds.append("edit")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 以 Set 开头，提出 edit。"))
    elif name.startswith(("Add", "Create", "Insert")):
        kinds.append("create")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 提出 create。"))
    elif name.startswith("Save"):
        kinds.append("save")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 提出 save。"))
    elif name.startswith(("Open", "Import", "Load")):
        kinds.append("import")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 提出 import。"))
    elif name.startswith("Export"):
        kinds.append("export")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 提出 export。"))
    elif name.startswith(("Select", "Pick")):
        kinds.append("select")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 提出 select。"))
    elif name.startswith(("Plot", "Print")):
        kinds.append("display")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 提出 display。"))
    elif re.match(r"^(Move|Rotate|Scale|Transform|Mirror|Offset)", name):
        kinds.append("transform")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 提出 transform。"))
    elif name.startswith(("Close", "Quit")):
        kinds.append("lifecycle")
        evidence.append(_evidence("member_name", name, f"方法名 {name} 提出 lifecycle。"))
    unique: list[str] = []
    for kind in kinds:
        if kind not in unique:
            unique.append(kind)
    return unique, evidence, candidates


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

    if atom_kind == "property_get":
        operation_kinds.append("read")
        summary = f"读取 {owner} 的 {name} 属性。"
        evidence.append(_evidence("signature", signature, "atom_kind=property_get，按签名视为读取。"))
        candidates.append(_candidate("sem:cad.property.read", "读取属性", 0.7, "atom_kind=property_get"))
    elif atom_kind == "property_set":
        operation_kinds.append("edit")
        summary = f"写入 {owner} 的 {name} 属性。"
        evidence.append(_evidence("signature", signature, "atom_kind=property_set，按签名视为写入。"))
        candidates.append(_candidate("sem:cad.property.write", "写入属性", 0.7, "atom_kind=property_set"))
    elif atom_kind in {"constructor", "progid_activation"}:
        operation_kinds.extend(["create", "lifecycle"])
        summary = f"通过 {name} 创建 COM 实例。"
        evidence.append(
            _evidence("signature", signature, f"atom_kind={atom_kind}，按签名视为创建或生命周期入口。")
        )
        candidates.append(
            _candidate("sem:cad.com.create_instance", "创建 COM 对象", 0.65, f"atom_kind={atom_kind}")
        )
    elif atom_kind == "event_subscribe":
        operation_kinds.append("event")
        summary = f"订阅 {owner} 的 {name} 事件。"
        evidence.append(_evidence("signature", signature, "atom_kind=event_subscribe。"))
        candidates.append(_candidate("sem:cad.event.subscribe", "订阅事件", 0.7, "atom_kind=event_subscribe"))
    elif atom_kind == "event_unsubscribe":
        operation_kinds.append("event")
        summary = f"取消订阅 {owner} 的 {name} 事件。"
        evidence.append(_evidence("signature", signature, "atom_kind=event_unsubscribe。"))
        candidates.append(
            _candidate("sem:cad.event.unsubscribe", "取消订阅事件", 0.7, "atom_kind=event_unsubscribe")
        )
    elif atom_kind == "method":
        operation_kinds.append("invoke")
        confidence = METHOD_BASE_CONFIDENCE
        summary = f"调用 {owner}.{name}。"
        evidence.append(_evidence("signature", signature, "atom_kind=method，基础分类为 invoke。"))
        extra_kinds, extra_evidence, extra_candidates = _method_heuristics(name)
        if extra_kinds:
            confidence = HEURISTIC_CONFIDENCE
            for kind in extra_kinds:
                if kind not in operation_kinds:
                    operation_kinds.append(kind)
            evidence.extend(extra_evidence)
            candidates.extend(extra_candidates)
            if "delete" in extra_kinds:
                summary = f"调用 {owner}.{name}；方法名提示删除，尚未运行时验证。"
        notes = "参数协议与真实效果未经验证；方法名启发式不得视为 verified。"
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

    enrichment = {
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
    }
    return isolate_autocad_enrichment(atom, enrichment)


def next_part_index(enrichments_dir: Path) -> int:
    highest = 0
    if enrichments_dir.is_dir():
        for path in enrichments_dir.glob("part-*.jsonl"):
            match = re.fullmatch(r"part-(\d+)\.jsonl", path.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            records.append(json.loads(line))
    return records


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    if path.exists():
        raise ComEnrichmentError(f"refusing to overwrite existing part {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in records)
    path.write_text(text, encoding="utf-8", newline="\n")


def _catalog_command(argv: list[str]) -> dict[str, Any]:
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = catalog_main(argv)
    if code != 0:
        raise ComEnrichmentError(f"catalog_queue {argv[0]} failed with exit {code}")
    text = buffer.getvalue().strip()
    if not text:
        return {}
    return json.loads(text)


def run_loop(
    manifest: Path,
    atoms: Path,
    enrichments_dir: Path,
    batches_dir: Path,
    *,
    limit: int = BATCH_SIZE,
    processed_at: str | None = None,
    classify: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    enrichments_dir.mkdir(parents=True, exist_ok=True)
    batches_dir.mkdir(parents=True, exist_ok=True)
    history: list[dict[str, Any]] = []
    common = [
        "--manifest",
        str(manifest),
        "--atoms",
        str(atoms),
        "--enrichments",
        str(enrichments_dir),
    ]
    progress = _catalog_command(["validate", *common])
    while progress.get("pending", 0) != 0:
        part_number = next_part_index(enrichments_dir)
        batch_path = batches_dir / f"next-{part_number:06d}.jsonl"
        part_path = enrichments_dir / f"part-{part_number:06d}.jsonl"
        _catalog_command(
            [
                "next-batch",
                *common,
                "--limit",
                str(limit),
                "--output",
                str(batch_path),
            ]
        )
        batch_atoms = _read_jsonl(batch_path)
        if not batch_atoms:
            break
        stamp = processed_at or _now()
        classify_fn = classify or classify_atom
        records = [classify_fn(atom, processed_at=stamp) for atom in batch_atoms]
        _write_jsonl(part_path, records)
        progress = _catalog_command(["validate", *common])
        history.append(
            {
                "event": "part",
                "part": part_path.name,
                "batch_atoms": len(records),
                "pending": progress["pending"],
                "classified": progress["classified"],
                "deferred": progress["deferred"],
                "failed": progress["failed"],
            }
        )
        print(json.dumps(history[-1], ensure_ascii=False), flush=True)
    complete = {"event": "complete", **progress}
    history.append(complete)
    return complete


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic COM capability enrichment loop.")
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
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ComEnrichmentError, CatalogValidationError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
