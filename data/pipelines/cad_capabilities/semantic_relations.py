from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1.0"
PRODUCER = "cad-semantic-matcher.v1"
VERIFIED_EVIDENCE = {"runtime_probe", "human_review"}
NAME_ONLY_MAX_CONFIDENCE = 0.3
STRUCTURED_CONFIDENCE = 0.62
LOGIC_CALL_CONFIDENCE = 0.75
LOGIC_DOC_CONFIDENCE = 0.55

_DELETE_NAME = re.compile(r"^(delete|erase)$", re.IGNORECASE)
_ERASE_COMMAND = re.compile(r"^(c:)?_?erase$", re.IGNORECASE)
_CS_USING = re.compile(r"^\s*using\s+([\w.]+)\s*;", re.MULTILINE)
_CAD_USING = re.compile(r"^(Teigha|Bricscad|Autodesk)\b")

SEMANTICS: dict[str, dict[str, Any]] = {
    "sem:cad.entity.delete": {
        "label": "删除 CAD 实体",
        "description": "从当前数据库删除一个实体或 DBObject，不合并跨技术原子。",
        "operation_kinds": ["delete"],
    },
    "sem:cad.entity.explode_geometry": {
        "label": "分解实体几何",
        "description": "Entity.ExplodeGeometry 将复杂实体分解为基本图元；与 Explode 不是同一入口。",
        "operation_kinds": ["compute", "read"],
    },
    "sem:cad.entity.explode": {
        "label": "分解实体（Explode）",
        "description": "Entity.Explode 入口；不得借用 ExplodeGeometry 的运行时证据。",
        "operation_kinds": ["compute"],
    },
    "sem:cad.database.get_object": {
        "label": "事务打开数据库对象",
        "description": "Transaction.GetObject 按 ObjectId 打开对象。",
        "operation_kinds": ["read"],
    },
    "sem:cad.database.transaction_commit": {
        "label": "提交事务",
        "description": "Transaction.Commit 提交当前事务。",
        "operation_kinds": ["lifecycle", "edit"],
    },
}

LOGIC_CATALOG: tuple[tuple[str, str, str], ...] = (
    ("cad-01", "01-full-entity-extraction", "local-dev/cad/adapters/thcad/01-full-entity-extraction"),
    ("cad-02", "02-drawing-frame-detection", "local-dev/cad/core/02-drawing-frame-detection"),
    ("cad-03", "03-drawing-zone-detection", "local-dev/cad/core/03-drawing-zone-detection"),
    ("cad-04", "04-mechanical-bom-knowledge", "local-dev/cad/core/04-mechanical-bom-knowledge"),
    ("cad-05", "05-technical-requirements-extraction", "local-dev/cad/core/05-technical-requirements-extraction"),
    ("cad-06", "06-layer-analysis", "local-dev/cad/core/06-layer-analysis"),
    ("cad-07", "07-centerline-identification", "local-dev/cad/core/07-centerline-identification"),
)


class SemanticRelationError(ValueError):
    pass


def _member_name(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("name") or "")


def _signature(atom: dict[str, Any]) -> str:
    return str((atom.get("member") or {}).get("signature") or "")


def _declaring(atom: dict[str, Any]) -> str:
    declaring = atom.get("declaring_symbol") or {}
    return str(declaring.get("full_name") or "")


def _return_type(atom: dict[str, Any]) -> str:
    value = (atom.get("member") or {}).get("return_type")
    return "" if value is None else str(value)


def _operation_kinds(enrichment: dict[str, Any] | None) -> set[str]:
    if not enrichment:
        return set()
    return {str(item) for item in enrichment.get("operation_kinds") or []}


def _evidence_kinds(enrichment: dict[str, Any] | None) -> set[str]:
    if not enrichment:
        return set()
    return {str(item.get("kind")) for item in enrichment.get("evidence") or [] if isinstance(item, dict)}


def relation_id(kind: str, *parts: str) -> str:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:24]
    prefix = "impl" if kind == "IMPLEMENTS" else "logic-uses"
    return f"{prefix}:{digest}"


def layout_seed(view_id: str, inventory_id: str, node_id: str) -> str:
    return f"{view_id}|{inventory_id}|{node_id}"


def layout_position(view_id: str, inventory_id: str, node_id: str) -> dict[str, float | str]:
    seed = layout_seed(view_id, inventory_id, node_id)
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    def axis(offset: int) -> float:
        value = int.from_bytes(digest[offset : offset + 4], "big") / 0xFFFFFFFF
        return round(value * 2000.0 - 1000.0, 6)
    return {"x": axis(0), "y": axis(4), "z": axis(8), "seed": seed}


def validate_relation(record: dict[str, Any]) -> None:
    required = {"schema_version", "relation_id", "kind", "status", "confidence", "basis", "producer"}
    missing = sorted(required - set(record))
    if missing:
        raise SemanticRelationError("relation missing " + ", ".join(missing))
    if record["kind"] not in {"IMPLEMENTS", "LOGIC_USES_CAPABILITY"}:
        raise SemanticRelationError("invalid relation kind")
    if record["status"] not in {"proposed", "verified", "rejected"}:
        raise SemanticRelationError("invalid relation status")
    confidence = record["confidence"]
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= float(confidence) <= 1:
        raise SemanticRelationError("confidence must be between 0 and 1")
    if not str(record.get("basis") or "").strip():
        raise SemanticRelationError("basis is required")
    if not str(record.get("producer") or "").strip():
        raise SemanticRelationError("producer is required")
    if record["kind"] == "IMPLEMENTS":
        for key in ("semantic_capability_id", "atom_id", "inventory_id", "evidence"):
            if key not in record:
                raise SemanticRelationError(f"IMPLEMENTS missing {key}")
    if record["kind"] == "LOGIC_USES_CAPABILITY":
        for key in ("logic_id", "logic_source_ref", "evidence"):
            if key not in record:
                raise SemanticRelationError(f"LOGIC_USES_CAPABILITY missing {key}")
    if record["status"] == "verified":
        kinds = {item.get("kind") for item in record.get("evidence") or [] if isinstance(item, dict)}
        if not (kinds & VERIFIED_EVIDENCE):
            raise SemanticRelationError("verified requires runtime_probe or human_review")


def name_only_confidence(atom_a: dict[str, Any], atom_b: dict[str, Any]) -> float:
    name_a = _member_name(atom_a).casefold()
    name_b = _member_name(atom_b).casefold()
    if name_a.removeprefix("c:").removeprefix("_") != name_b.removeprefix("c:").removeprefix("_"):
        return 0.0
    if _declaring(atom_a) != _declaring(atom_b) or _signature(atom_a) != _signature(atom_b):
        return NAME_ONLY_MAX_CONFIDENCE
    return NAME_ONLY_MAX_CONFIDENCE


def high_confidence_from_name_alone(atom_a: dict[str, Any], atom_b: dict[str, Any]) -> bool:
    return name_only_confidence(atom_a, atom_b) >= STRUCTURED_CONFIDENCE


def _declaring_is_entity_like(atom: dict[str, Any]) -> bool:
    declaring = _declaring(atom)
    return declaring.endswith((".Entity", ".DBObject", "IAcadEntity"))


def match_semantic_family(atom: dict[str, Any], enrichment: dict[str, Any] | None) -> str | None:
    name = _member_name(atom)
    kind = atom.get("atom_kind")
    declaring = _declaring(atom)
    operations = _operation_kinds(enrichment)
    if kind == "method" and name == "ExplodeGeometry" and declaring.endswith(".Entity"):
        return "sem:cad.entity.explode_geometry"
    if kind == "method" and name == "Explode" and declaring.endswith(".Entity"):
        return "sem:cad.entity.explode"
    if kind == "method" and name == "GetObject" and "Transaction" in declaring:
        return "sem:cad.database.get_object"
    if kind == "method" and name == "Commit" and "Transaction" in declaring:
        return "sem:cad.database.transaction_commit"
    if (
        kind in {"method", "command"}
        and _DELETE_NAME.match(name)
        and _declaring_is_entity_like(atom)
        and ("delete" in operations or kind == "method")
    ):
        return "sem:cad.entity.delete"
    if kind == "command" and _ERASE_COMMAND.match(name):
        return "sem:cad.entity.delete"
    return None


def implements_status(atom: dict[str, Any], enrichment: dict[str, Any] | None, semantic_id: str) -> str:
    if semantic_id == "sem:cad.entity.explode_geometry" and _evidence_kinds(enrichment) & VERIFIED_EVIDENCE:
        return "verified"
    return "proposed"


def make_implements(
    atom: dict[str, Any],
    enrichment: dict[str, Any] | None,
    semantic_id: str,
) -> dict[str, Any]:
    status = implements_status(atom, enrichment, semantic_id)
    evidence = list(enrichment.get("evidence") or []) if enrichment else []
    if not evidence:
        evidence = [
            {
                "kind": "signature",
                "ref": _signature(atom) or _member_name(atom),
                "claim": f"structured match on {_declaring(atom)}.{_member_name(atom)}",
            }
        ]
    record = {
        "schema_version": SCHEMA_VERSION,
        "relation_id": relation_id("IMPLEMENTS", semantic_id, atom["atom_id"]),
        "kind": "IMPLEMENTS",
        "status": status,
        "confidence": 0.85 if status == "verified" else STRUCTURED_CONFIDENCE,
        "basis": (
            f"operation_kinds={sorted(_operation_kinds(enrichment))}; "
            f"declaring={_declaring(atom)}; signature={_signature(atom)}; "
            f"summary={(enrichment or {}).get('summary')}"
        ),
        "producer": PRODUCER,
        "semantic_capability_id": semantic_id,
        "atom_id": atom["atom_id"],
        "inventory_id": atom["inventory_id"],
        "evidence": evidence,
    }
    validate_relation(record)
    return record


def csharp_has_cad_using(source: str) -> bool:
    return any(_CAD_USING.match(match.group(1)) for match in _CS_USING.finditer(source))


def extract_member_calls(source: str) -> list[tuple[int, str]]:
    calls: list[tuple[int, str]] = []
    dotted = re.compile(r"\.([A-Za-z_][\w]*)\s*\(")
    for line_no, line in enumerate(source.splitlines(), 1):
        stripped = line.split("//", 1)[0]
        if "might use" in stripped.casefold() or "looks like" in stripped.casefold():
            continue
        for match in dotted.finditer(stripped):
            name = match.group(1)
            prefix = stripped[: match.start()].rstrip()
            if name == "Delete" and prefix.endswith("File"):
                continue
            calls.append((line_no, name))
    return calls


def logic_uses_from_resemblance_only(basis: str) -> bool:
    text = basis.casefold()
    return "might use" in text or "looks like" in text or "resemblance" in text


def make_logic_uses(
    *,
    logic_id: str,
    source_ref: str,
    atom: dict[str, Any] | None,
    semantic_id: str | None,
    evidence_kind: str,
    claim: str,
    confidence: float,
    basis: str,
) -> dict[str, Any] | None:
    if logic_uses_from_resemblance_only(basis) or logic_uses_from_resemblance_only(claim):
        return None
    if atom is None and semantic_id is None:
        return None
    evidence = [{"kind": evidence_kind, "ref": source_ref, "claim": claim}]
    record: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "relation_id": relation_id(
            "LOGIC_USES_CAPABILITY",
            logic_id,
            source_ref,
            (atom or {}).get("atom_id") or "",
            semantic_id or "",
        ),
        "kind": "LOGIC_USES_CAPABILITY",
        "status": "proposed",
        "confidence": confidence,
        "basis": basis,
        "producer": PRODUCER,
        "logic_id": logic_id,
        "logic_source_ref": source_ref,
        "evidence": evidence,
    }
    if atom is not None:
        record["atom_id"] = atom["atom_id"]
        record["inventory_id"] = atom["inventory_id"]
    if semantic_id is not None:
        record["semantic_capability_id"] = semantic_id
    validate_relation(record)
    return record


def semantic_records() -> list[dict[str, Any]]:
    records = []
    for semantic_id, spec in SEMANTICS.items():
        records.append(
            {
                "schema_version": SCHEMA_VERSION,
                "semantic_capability_id": semantic_id,
                "label": spec["label"],
                "description": spec["description"],
                "operation_kinds": list(spec["operation_kinds"]),
                "producer": PRODUCER,
            }
        )
    records.sort(key=lambda item: item["semantic_capability_id"])
    return records


def _iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def load_interesting_atoms(atoms_path: Path) -> dict[str, dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for atom in _iter_jsonl(atoms_path):
        if match_semantic_family(atom, None):
            selected[atom["atom_id"]] = atom
            continue
        name = _member_name(atom)
        if _DELETE_NAME.match(name) or _ERASE_COMMAND.match(name) or name in {"Explode", "ExplodeGeometry", "GetObject", "Commit"}:
            selected[atom["atom_id"]] = atom
    return selected


def load_enrichments_for(path: Path, atom_ids: set[str]) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return found
    files = [path] if path.is_file() else sorted(path.glob("*.jsonl"))
    for file_path in files:
        for record in _iter_jsonl(file_path):
            atom_id = record.get("atom_id")
            if atom_id in atom_ids:
                found[atom_id] = record
    return found


def cluster_implements(
    atoms: dict[str, dict[str, Any]],
    enrichments: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    implements: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    for atom_id, atom in atoms.items():
        enrichment = enrichments.get(atom_id)
        family = match_semantic_family(atom, enrichment)
        if family:
            implements.append(make_implements(atom, enrichment, family))
            continue
        name = _member_name(atom)
        if _DELETE_NAME.match(name) or name in {"Explode", "GetObject"}:
            conflicts.append(
                {
                    "schema_version": SCHEMA_VERSION,
                    "relation_id": relation_id("IMPLEMENTS", "rejected-name", atom_id),
                    "kind": "IMPLEMENTS",
                    "status": "rejected",
                    "confidence": NAME_ONLY_MAX_CONFIDENCE,
                    "basis": (
                        "name-only weak signal; declaring type/signature/operation_kinds "
                        f"did not support clustering ({_declaring(atom)}.{name})"
                    ),
                    "producer": PRODUCER,
                    "semantic_capability_id": "sem:cad.unclustered.name",
                    "atom_id": atom_id,
                    "inventory_id": atom["inventory_id"],
                    "evidence": [
                        {
                            "kind": "member_name",
                            "ref": name,
                            "claim": "same member name is insufficient without declaring type context",
                        }
                    ],
                }
            )
    implements.sort(key=lambda item: item["relation_id"])
    conflicts.sort(key=lambda item: item["relation_id"])
    return implements, conflicts


def _map_call_to_semantic(name: str) -> str | None:
    mapping = {
        "ExplodeGeometry": "sem:cad.entity.explode_geometry",
        "Explode": "sem:cad.entity.explode",
        "GetObject": "sem:cad.database.get_object",
        "Commit": "sem:cad.database.transaction_commit",
        "Erase": "sem:cad.entity.delete",
    }
    return mapping.get(name)


def extract_logic_uses(
    logic_root: Path,
    atoms_by_key: dict[tuple[str, str], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    relations: list[dict[str, Any]] = []
    for logic_id, _label, relative in LOGIC_CATALOG:
        directory = logic_root / relative
        if not directory.exists() and "local-dev/cad/" in relative:
            directory = logic_root / relative.split("local-dev/cad/", 1)[1]
        if not directory.exists():
            continue
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or path.suffix.casefold() not in {".cs", ".md"}:
                continue
            text = path.read_text(encoding="utf-8")
            rel = str(path).replace("\\", "/")
            marker = "local-dev/cad/"
            source_rel = rel[rel.index(marker) :] if marker in rel else path.name
            if path.suffix.casefold() == ".cs":
                if logic_id != "cad-01" and not csharp_has_cad_using(text):
                    continue
                for line_no, name in extract_member_calls(text):
                    semantic_id = _map_call_to_semantic(name)
                    if semantic_id is None:
                        continue
                    matches = atoms_by_key.get((name, semantic_id), [])
                    atom = matches[0] if matches else None
                    record = make_logic_uses(
                        logic_id=logic_id,
                        source_ref=f"{source_rel}:{line_no}",
                        atom=atom,
                        semantic_id=semantic_id,
                        evidence_kind="source_code",
                        claim=f"{source_rel}:{line_no} calls {name}(",
                        confidence=LOGIC_CALL_CONFIDENCE,
                        basis=f"source call {name} in {source_rel}",
                    )
                    if record:
                        relations.append(record)
            elif logic_id == "cad-01" and "ExplodeGeometry" in text:
                matches = atoms_by_key.get(("ExplodeGeometry", "sem:cad.entity.explode_geometry"), [])
                atom = matches[0] if matches else None
                record = make_logic_uses(
                    logic_id=logic_id,
                    source_ref=source_rel,
                    atom=atom,
                    semantic_id="sem:cad.entity.explode_geometry",
                    evidence_kind="documentation",
                    claim=f"{source_rel} documents Entity.ExplodeGeometry",
                    confidence=LOGIC_DOC_CONFIDENCE,
                    basis=f"documentation evidence in {source_rel}",
                )
                if record:
                    relations.append(record)
    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    ordered = sorted(relations, key=lambda item: 0 if item["evidence"][0]["kind"] == "source_code" else 1)
    for record in ordered:
        key = (
            record["logic_id"],
            str(record.get("atom_id") or ""),
            str(record.get("semantic_capability_id") or ""),
        )
        unique.setdefault(key, record)
    return sorted(unique.values(), key=lambda item: item["relation_id"])


def build_views(
    implements: list[dict[str, Any]],
    logic_uses: list[dict[str, Any]],
    atoms: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    views = [
        {"schema_version": SCHEMA_VERSION, "record_kind": "graph_view", "view_id": "view:surface", "view_kind": "surface", "label": "技术面原子"},
        {"schema_version": SCHEMA_VERSION, "record_kind": "graph_view", "view_id": "view:semantic", "view_kind": "semantic", "label": "语义能力聚类"},
        {"schema_version": SCHEMA_VERSION, "record_kind": "graph_view", "view_id": "view:logic-affinity", "view_kind": "logic-affinity", "label": "Logic 证据连接"},
    ]
    positions: list[dict[str, Any]] = []
    atom_nodes = {item["atom_id"]: atoms[item["atom_id"]] for item in implements if item["atom_id"] in atoms}
    for item in logic_uses:
        atom_id = item.get("atom_id")
        if atom_id and atom_id in atoms:
            atom_nodes[atom_id] = atoms[atom_id]
    semantic_ids = sorted({item["semantic_capability_id"] for item in implements})
    logic_ids = sorted({item["logic_id"] for item in logic_uses} | {row[0] for row in LOGIC_CATALOG})

    def add_pos(view_id: str, inventory_id: str, node_id: str) -> None:
        coords = layout_position(view_id, inventory_id, node_id)
        positions.append(
            {
                "schema_version": SCHEMA_VERSION,
                "record_kind": "graph_layout_position",
                "view_id": view_id,
                "node_id": node_id,
                "inventory_id": inventory_id,
                **coords,
            }
        )

    for atom in atom_nodes.values():
        add_pos("view:surface", atom["inventory_id"], atom["atom_id"])
        add_pos("view:semantic", atom["inventory_id"], atom["atom_id"])
    for semantic_id in semantic_ids:
        add_pos("view:semantic", "semantic", semantic_id)
    for logic_id in logic_ids:
        add_pos("view:logic-affinity", "logic", logic_id)
    for atom in atom_nodes.values():
        add_pos("view:logic-affinity", atom["inventory_id"], atom["atom_id"])
    positions.sort(key=lambda item: (item["view_id"], item["inventory_id"], item["node_id"]))
    return views, positions


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in records)
    path.write_text(text, encoding="utf-8", newline="\n")


def generate_dataset(
    *,
    inventories: dict[str, tuple[Path, Path]],
    logic_root: Path,
    output_dir: Path,
) -> dict[str, Any]:
    atoms: dict[str, dict[str, Any]] = {}
    enrichments: dict[str, dict[str, Any]] = {}
    for atoms_path, enrichments_path in inventories.values():
        found = load_interesting_atoms(atoms_path)
        atoms.update(found)
        enrichments.update(load_enrichments_for(enrichments_path, set(found)))
    implements, conflicts = cluster_implements(atoms, enrichments)
    by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in implements:
        atom = atoms[record["atom_id"]]
        key = (_member_name(atom), record["semantic_capability_id"])
        by_key.setdefault(key, []).append(atom)
        by_key[key].sort(key=lambda item: item["atom_id"])
    logic_uses = extract_logic_uses(logic_root, by_key)
    semantics = semantic_records()
    views, positions = build_views(implements, logic_uses, atoms)
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_jsonl(output_dir / "semantic-capabilities.jsonl", semantics)
    _write_jsonl(output_dir / "implements.jsonl", implements)
    _write_jsonl(output_dir / "logic-uses-capability.jsonl", logic_uses)
    _write_jsonl(output_dir / "graph-views.jsonl", views)
    _write_jsonl(output_dir / "graph-layout-positions.jsonl", positions)
    _write_jsonl(output_dir / "conflicts.jsonl", conflicts)
    summary = {
        "semantic_capabilities": len(semantics),
        "implements": len(implements),
        "implements_by_status": _count(implements, "status"),
        "logic_uses": len(logic_uses),
        "logic_uses_by_logic": _count(logic_uses, "logic_id"),
        "conflicts": len(conflicts),
        "views": len(views),
        "layout_positions": len(positions),
    }
    (output_dir / "generation-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return summary


def _count(records: list[dict[str, Any]], key: str) -> dict[str, int]:
    tally: dict[str, int] = {}
    for record in records:
        value = str(record.get(key) or "")
        tally[value] = tally.get(value, 0) + 1
    return dict(sorted(tally.items()))


def _fingerprint(output_dir: Path) -> dict[str, str]:
    names = [
        "semantic-capabilities.jsonl",
        "implements.jsonl",
        "logic-uses-capability.jsonl",
        "graph-views.jsonl",
        "graph-layout-positions.jsonl",
        "conflicts.jsonl",
    ]
    result = {}
    for name in names:
        path = output_dir / name
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate SemanticCapability candidate relations and GraphView layouts.")
    parser.add_argument("--com-atoms", type=Path, required=True)
    parser.add_argument("--com-enrichments", type=Path, required=True)
    parser.add_argument("--dotnet-atoms", type=Path, required=True)
    parser.add_argument("--dotnet-enrichments", type=Path, required=True)
    parser.add_argument("--lisp-atoms", type=Path, required=True)
    parser.add_argument("--lisp-enrichments", type=Path, required=True)
    parser.add_argument("--command-atoms", type=Path, required=True)
    parser.add_argument("--command-enrichments", type=Path, required=True)
    parser.add_argument("--logic-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    inventories = {
        "com": (args.com_atoms, args.com_enrichments),
        "dotnet": (args.dotnet_atoms, args.dotnet_enrichments),
        "lisp": (args.lisp_atoms, args.lisp_enrichments),
        "command": (args.command_atoms, args.command_enrichments),
    }
    summary = generate_dataset(inventories=inventories, logic_root=args.logic_root, output_dir=args.output_dir)
    summary["fingerprint"] = _fingerprint(args.output_dir)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
