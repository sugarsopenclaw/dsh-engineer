from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

if __package__:
    from .catalog_queue import canonical_atom_id
    from .host_isolation import HostIsolationError, guard_inventory_write
else:
    from catalog_queue import canonical_atom_id
    from host_isolation import HostIsolationError, guard_inventory_write

SCHEMA_VERSION = "1.0"
EXTRACTOR_NAME = "ExportThcadLispCommandCapabilityAtoms"
EXTRACTOR_VERSION = "1.0"
DEFAULT_LISP_INVENTORY_ID = "thcad-v24.lisp"
DEFAULT_COMMAND_INVENTORY_ID = "thcad-v24.command"
DEFAULT_OBSERVED_HOST_ID = "thcad-v24"
ATOMS_FILE = "capability-atoms.jsonl"
LISP_SURFACE = "lisp"
COMMAND_SURFACE = "command"

# Same patterns as ExportThcadLispCommandInventory.ps1.
DEFUN_RE = re.compile(r"(?im)^\s*\(\s*defun(?:-q)?\s+([^\s()]+)")
TOKEN_RE = re.compile(r"(?i)\^c\^c_?([A-Za-z][A-Za-z0-9_.-]*)")
# Windows drive/UNC only. Do not treat CAD macro pauses (`\\`) or URLs (`https://`) as paths.
_MACHINE_PATH = re.compile(r"(?i)(?:[a-z]:\\|\\\\[a-z0-9._-]+\\)")
_ABS_PATH_IN_TEXT = re.compile(r"(?i)(?:[a-z]:\\[^\s;\"<>]*|\\\\[a-z0-9._-]+\\[^\s;\"<>]+)")


class LispCommandAtomizationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise LispCommandAtomizationError(message)


def _require_mapping(value: Any, location: str) -> dict[str, Any]:
    _require(isinstance(value, dict), f"{location}: must be an object")
    return value


def _require_list(value: Any, location: str) -> list[Any]:
    _require(isinstance(value, list), f"{location}: must be a list")
    return value


def _reject_machine_paths(value: Any, location: str) -> None:
    if isinstance(value, str):
        _require(not _MACHINE_PATH.search(value), f"{location}: machine absolute path is not allowed")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            _reject_machine_paths(item, f"{location}.{key}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _reject_machine_paths(item, f"{location}[{index}]")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_text(text: str) -> str:
    return _sha256_bytes(text.encode("utf-8"))


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _as_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [str(item) for item in value if item is not None and str(item) != ""]
    return [str(value)]


def posix_relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def sanitize_text(text: str, *, mechanical_root: Path | None = None) -> str:
    if not text:
        return text

    def replace(match: re.Match[str]) -> str:
        raw = match.group(0)
        if mechanical_root is not None:
            try:
                relative = posix_relative(Path(raw), mechanical_root)
                if not _MACHINE_PATH.search(relative):
                    return relative
            except (OSError, ValueError):
                pass
        return "[ABS_PATH]"

    return _ABS_PATH_IN_TEXT.sub(replace, text)


def drawing_name(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    cleaned = value.replace("\\", "/").rstrip("/")
    name = cleaned.rsplit("/", 1)[-1]
    if _MACHINE_PATH.search(name):
        return None
    return name


def is_command_symbol(name: str) -> bool:
    return name.upper().startswith("C:")


def normalize_lisp_name(name: str) -> str:
    return name.casefold()


def normalize_command_name(name: str) -> str:
    if is_command_symbol(name):
        return "C:" + name[2:].upper()
    return name.upper()


def extract_command_tokens(command: str) -> list[str]:
    tokens = {match.group(1).upper() for match in TOKEN_RE.finditer(command or "")}
    return sorted(tokens)


def parse_lsp_definitions(content: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for match in DEFUN_RE.finditer(content):
        name = match.group(1)
        line = 1 + content.count("\n", 0, match.start())
        rows.append(
            {
                "name": name,
                "line": line,
                "is_command": is_command_symbol(name),
            }
        )
    return rows


def parse_cui_document(xml_text: str | bytes) -> tuple[list[dict[str, Any]], str | None]:
    payload = xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        return [], str(error)

    macros: list[dict[str, Any]] = []
    current_uid: str | None = None
    for element in root.iter():
        tag = _local_tag(element.tag)
        if tag == "MenuMacro":
            current_uid = element.get("UID")
            continue
        if tag != "Macro":
            continue
        name = ""
        command: str | None = None
        for child in list(element):
            child_tag = _local_tag(child.tag)
            if child_tag == "Name":
                name = child.text or ""
            elif child_tag == "Command":
                command = child.text or ""
        if command is None:
            continue
        macros.append(
            {
                "name": name,
                "command": command,
                "command_tokens": extract_command_tokens(command),
                "menu_macro_uid": current_uid,
            }
        )
    return macros, None


def canonical_lisp_key(
    *,
    artifact_id: str,
    atom_kind: str,
    name: str,
    evidence_path: str,
    line: int | None = None,
) -> str:
    parts = [LISP_SURFACE, artifact_id, atom_kind, normalize_lisp_name(name), evidence_path]
    if line is not None:
        parts.append(f"line:{line}")
    return "|".join(parts)


def canonical_command_key(
    *,
    artifact_id: str,
    atom_kind: str,
    name: str,
    evidence_path: str,
    line: int | None = None,
    index: int | None = None,
    command: str | None = None,
) -> str:
    parts = [COMMAND_SURFACE, artifact_id, atom_kind, normalize_command_name(name), evidence_path]
    if index is not None:
        parts.append(f"index:{index:06d}")
    if line is not None:
        parts.append(f"line:{line}")
    if command is not None:
        parts.append(command)
    return "|".join(parts)


def _source_artifact(
    *,
    artifact_id: str,
    kind: str,
    name: str,
    version: str | None,
    sha256: str | None,
) -> dict[str, Any]:
    if sha256 is not None:
        _require(
            isinstance(sha256, str) and len(sha256) == 64 and sha256 == sha256.lower(),
            f"{artifact_id}: sha256 must be lowercase hex",
        )
    return {
        "artifact_id": artifact_id,
        "kind": kind,
        "name": name,
        "version": version,
        "sha256": sha256,
    }


def _declaring_symbol(symbol_id: str, full_name: str, kind: str) -> dict[str, str]:
    return {"symbol_id": symbol_id, "full_name": full_name, "kind": kind}


def _member(*, name: str, signature: str) -> dict[str, Any]:
    _require(isinstance(name, str) and name, "member.name must be non-empty")
    return {
        "name": name,
        "signature": signature,
        "return_type": None,
        "parameters": [],
        "is_static": True,
    }


def _atom(
    *,
    inventory_id: str,
    surface: str,
    canonical_key: str,
    atom_kind: str,
    observed_host_ids: list[str],
    source_artifact: dict[str, Any],
    declaring_symbol: dict[str, str],
    member: dict[str, Any],
    source_locator: dict[str, Any],
    surface_metadata: dict[str, Any],
) -> dict[str, Any]:
    record = {
        "schema_version": SCHEMA_VERSION,
        "inventory_id": inventory_id,
        "atom_id": canonical_atom_id(surface, canonical_key),
        "canonical_key": canonical_key,
        "surface": surface,
        "atom_kind": atom_kind,
        "observed_host_ids": list(observed_host_ids),
        "source_artifact": dict(source_artifact),
        "declaring_symbol": declaring_symbol,
        "member": member,
        "provenance": {
            "extractor": EXTRACTOR_NAME,
            "extractor_version": EXTRACTOR_VERSION,
            "source_locator": source_locator,
        },
        "surface_metadata": surface_metadata,
    }
    _reject_machine_paths(record, record["atom_id"])
    return record


def _file_artifact(kind: str, relative_path: str, sha256: str | None) -> dict[str, Any]:
    prefix = "lsp" if kind == "lsp" else "cui"
    return _source_artifact(
        artifact_id=f"{prefix}:{relative_path}",
        kind=kind,
        name=relative_path,
        version=None,
        sha256=sha256,
    )


def _session_artifact(runtime: dict[str, Any], observed_host_id: str) -> dict[str, Any]:
    atoms = _as_string_list(runtime.get("atoms"))
    digest = _sha256_text("\n".join(sorted(atoms)))
    host = sanitize_text(str(runtime.get("host") or observed_host_id))
    version = str(runtime.get("version") or "") or None
    if version:
        version = sanitize_text(version)
    return _source_artifact(
        artifact_id=f"session:{observed_host_id}",
        kind="runtime-session",
        name=host,
        version=version,
        sha256=digest,
    )


def _session_metadata(runtime: dict[str, Any] | None) -> dict[str, Any]:
    if not runtime:
        return {}
    metadata = {
        "session_host": sanitize_text(str(runtime.get("host") or "")),
        "session_version": sanitize_text(str(runtime.get("version") or "")),
        "session_drawing": drawing_name(runtime.get("drawing")),
        "evidence_path": "runtime",
    }
    return {key: value for key, value in metadata.items() if value not in {None, ""}}


def _finalize_atoms(atoms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, str] = {}
    unique: list[dict[str, Any]] = []
    for atom in atoms:
        key = atom["canonical_key"]
        _require(key not in seen, f"duplicate canonical_key {key}")
        seen[key] = atom["atom_id"]
        unique.append(atom)
    unique.sort(key=lambda item: str(item["atom_id"]))
    return unique


def _source_counts(scan: dict[str, Any]) -> dict[str, int]:
    lsp_files = _require_list(scan.get("lsp_files") or [], "lsp_files")
    cui_files = _require_list(scan.get("cui_files") or [], "cui_files")
    runtime = scan.get("runtime") if isinstance(scan.get("runtime"), dict) else None
    definitions = [
        definition
        for lsp in lsp_files
        for definition in _require_list((lsp or {}).get("definitions") or [], "definitions")
    ]
    macros = [
        macro
        for cui in cui_files
        for macro in _require_list((cui or {}).get("macros") or [], "macros")
    ]
    tokens: set[str] = set()
    token_pairs = 0
    parse_errors = 0
    for cui in cui_files:
        mapping = _require_mapping(cui, "cui")
        if mapping.get("parse_error"):
            parse_errors += 1
        file_tokens = {
            token
            for macro in _require_list(mapping.get("macros") or [], "macros")
            for token in _as_string_list((macro or {}).get("command_tokens"))
        }
        tokens.update(file_tokens)
        token_pairs += len(file_tokens)
    runtime_atoms = _as_string_list((runtime or {}).get("atoms"))
    runtime_commands = [name for name in runtime_atoms if is_command_symbol(name)]
    return {
        "lsp_files": len(lsp_files),
        "source_defuns": len(definitions),
        "source_lisp_functions": sum(1 for item in definitions if not item.get("is_command")),
        "source_commands": sum(1 for item in definitions if item.get("is_command")),
        "cui_files": len(cui_files),
        "menu_macros": len(macros),
        "command_tokens_unique": len(tokens),
        "command_token_file_pairs": token_pairs,
        "cui_parse_errors": parse_errors,
        "runtime_symbols": len(runtime_atoms),
        "runtime_commands": len(runtime_commands),
        "runtime_lisp_symbols": len(runtime_atoms) - len(runtime_commands),
        "loaded_arx": len(_as_string_list((runtime or {}).get("arx"))),
        "loaded_vlx": len(_as_string_list((runtime or {}).get("vlx"))),
    }


def _lisp_atoms(
    scan: dict[str, Any],
    *,
    inventory_id: str,
    observed_host_ids: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    atoms: list[dict[str, Any]] = []
    artifacts_by_id: dict[str, dict[str, Any]] = {}
    runtime = scan.get("runtime") if isinstance(scan.get("runtime"), dict) else None
    host_id = observed_host_ids[0]
    session = (
        _session_artifact(runtime, host_id) if runtime and runtime.get("atoms") is not None else None
    )
    if session:
        artifacts_by_id[session["artifact_id"]] = session

    for lsp in _require_list(scan.get("lsp_files") or [], "lsp_files"):
        mapping = _require_mapping(lsp, "lsp_files[]")
        relative = mapping.get("relative_path")
        _require(isinstance(relative, str) and relative, "lsp relative_path")
        artifact = _file_artifact("lsp", relative, mapping.get("sha256"))
        artifacts_by_id[artifact["artifact_id"]] = artifact
        declaring = _declaring_symbol(f"lisp-file:{relative}", relative, "lsp")
        for definition in _require_list(mapping.get("definitions") or [], f"{relative}.definitions"):
            item = _require_mapping(definition, "definition")
            name = item.get("name")
            _require(isinstance(name, str) and name, f"{relative}: defun name")
            if item.get("is_command") or is_command_symbol(name):
                continue
            line = int(item["line"])
            atoms.append(
                _atom(
                    inventory_id=inventory_id,
                    surface=LISP_SURFACE,
                    canonical_key=canonical_lisp_key(
                        artifact_id=artifact["artifact_id"],
                        atom_kind="lisp_function",
                        name=name,
                        evidence_path="lsp_source",
                        line=line,
                    ),
                    atom_kind="lisp_function",
                    observed_host_ids=observed_host_ids,
                    source_artifact=artifact,
                    declaring_symbol=declaring,
                    member=_member(name=name, signature=f"(defun {name})"),
                    source_locator={
                        "file": relative,
                        "line": line,
                        "symbol": name,
                        "evidence_path": "lsp_source",
                    },
                    surface_metadata={
                        "file": relative,
                        "line": line,
                        "evidence_path": "lsp_source",
                    },
                )
            )

    if session and runtime is not None:
        declaring = _declaring_symbol(f"lisp-session:{host_id}", "runtime.atoms-family", "runtime-session")
        session_meta = _session_metadata(runtime)
        for name in _as_string_list(runtime.get("atoms")):
            if is_command_symbol(name):
                continue
            atoms.append(
                _atom(
                    inventory_id=inventory_id,
                    surface=LISP_SURFACE,
                    canonical_key=canonical_lisp_key(
                        artifact_id=session["artifact_id"],
                        atom_kind="lisp_function",
                        name=name,
                        evidence_path="runtime",
                    ),
                    atom_kind="lisp_function",
                    observed_host_ids=observed_host_ids,
                    source_artifact=session,
                    declaring_symbol=declaring,
                    member=_member(name=name, signature=f"(atoms-family {name})"),
                    source_locator={
                        "symbol": name,
                        "evidence_path": "runtime",
                    },
                    surface_metadata={**session_meta, "symbol": name},
                )
            )

    artifacts = sorted(artifacts_by_id.values(), key=lambda item: item["artifact_id"])
    return _finalize_atoms(atoms), artifacts


def _command_atoms(
    scan: dict[str, Any],
    *,
    inventory_id: str,
    observed_host_ids: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    atoms: list[dict[str, Any]] = []
    artifacts_by_id: dict[str, dict[str, Any]] = {}
    runtime = scan.get("runtime") if isinstance(scan.get("runtime"), dict) else None
    host_id = observed_host_ids[0]
    session = (
        _session_artifact(runtime, host_id) if runtime and runtime.get("atoms") is not None else None
    )
    if session:
        artifacts_by_id[session["artifact_id"]] = session

    for lsp in _require_list(scan.get("lsp_files") or [], "lsp_files"):
        mapping = _require_mapping(lsp, "lsp_files[]")
        relative = mapping.get("relative_path")
        _require(isinstance(relative, str) and relative, "lsp relative_path")
        definitions = [
            item
            for item in _require_list(mapping.get("definitions") or [], f"{relative}.definitions")
            if _require_mapping(item, "definition").get("is_command")
            or is_command_symbol(str(item.get("name") or ""))
        ]
        if not definitions:
            continue
        artifact = _file_artifact("lsp", relative, mapping.get("sha256"))
        artifacts_by_id[artifact["artifact_id"]] = artifact
        declaring = _declaring_symbol(f"lisp-file:{relative}", relative, "lsp")
        for item in definitions:
            name = str(item["name"])
            line = int(item["line"])
            atoms.append(
                _atom(
                    inventory_id=inventory_id,
                    surface=COMMAND_SURFACE,
                    canonical_key=canonical_command_key(
                        artifact_id=artifact["artifact_id"],
                        atom_kind="command",
                        name=name,
                        evidence_path="source_defun",
                        line=line,
                    ),
                    atom_kind="command",
                    observed_host_ids=observed_host_ids,
                    source_artifact=artifact,
                    declaring_symbol=declaring,
                    member=_member(name=name, signature=f"(defun {name})"),
                    source_locator={
                        "file": relative,
                        "line": line,
                        "symbol": name,
                        "evidence_path": "source_defun",
                    },
                    surface_metadata={
                        "file": relative,
                        "line": line,
                        "evidence_path": "source_defun",
                    },
                )
            )

    for cui in _require_list(scan.get("cui_files") or [], "cui_files"):
        mapping = _require_mapping(cui, "cui_files[]")
        relative = mapping.get("relative_path")
        _require(isinstance(relative, str) and relative, "cui relative_path")
        artifact = _file_artifact("cui", relative, mapping.get("sha256"))
        artifacts_by_id[artifact["artifact_id"]] = artifact
        declaring = _declaring_symbol(f"cui-file:{relative}", relative, "cui")
        macros = _require_list(mapping.get("macros") or [], f"{relative}.macros")
        file_tokens: set[str] = set()
        for index, raw_macro in enumerate(macros):
            macro = _require_mapping(raw_macro, f"{relative}.macros[{index}]")
            command = sanitize_text(str(macro.get("command") or ""))
            name = str(macro.get("name") or "") or f"unnamed-{index:06d}"
            tokens = extract_command_tokens(command) or _as_string_list(macro.get("command_tokens"))
            file_tokens.update(tokens)
            atoms.append(
                _atom(
                    inventory_id=inventory_id,
                    surface=COMMAND_SURFACE,
                    canonical_key=canonical_command_key(
                        artifact_id=artifact["artifact_id"],
                        atom_kind="macro",
                        name=name,
                        evidence_path="cui_macro",
                        index=index,
                        command=command,
                    ),
                    atom_kind="macro",
                    observed_host_ids=observed_host_ids,
                    source_artifact=artifact,
                    declaring_symbol=declaring,
                    member=_member(name=name, signature=f"MACRO {name} :: {command}"),
                    source_locator={
                        "file": relative,
                        "macro_name": name,
                        "index": index,
                        "evidence_path": "cui_macro",
                    },
                    surface_metadata={
                        "file": relative,
                        "command": command,
                        "command_tokens": tokens,
                        "menu_macro_uid": macro.get("menu_macro_uid"),
                        "index": index,
                        "evidence_path": "cui_macro",
                    },
                )
            )
        for token in sorted(file_tokens):
            atoms.append(
                _atom(
                    inventory_id=inventory_id,
                    surface=COMMAND_SURFACE,
                    canonical_key=canonical_command_key(
                        artifact_id=artifact["artifact_id"],
                        atom_kind="command",
                        name=token,
                        evidence_path="cui_token",
                    ),
                    atom_kind="command",
                    observed_host_ids=observed_host_ids,
                    source_artifact=artifact,
                    declaring_symbol=declaring,
                    member=_member(name=token, signature=f"COMMAND TOKEN {token}"),
                    source_locator={
                        "file": relative,
                        "token": token,
                        "evidence_path": "cui_token",
                    },
                    surface_metadata={
                        "file": relative,
                        "token": token,
                        "evidence_path": "cui_token",
                    },
                )
            )

    if session and runtime is not None:
        declaring = _declaring_symbol(f"lisp-session:{host_id}", "runtime.atoms-family", "runtime-session")
        session_meta = _session_metadata(runtime)
        for name in _as_string_list(runtime.get("atoms")):
            if not is_command_symbol(name):
                continue
            atoms.append(
                _atom(
                    inventory_id=inventory_id,
                    surface=COMMAND_SURFACE,
                    canonical_key=canonical_command_key(
                        artifact_id=session["artifact_id"],
                        atom_kind="command",
                        name=name,
                        evidence_path="runtime",
                    ),
                    atom_kind="command",
                    observed_host_ids=observed_host_ids,
                    source_artifact=session,
                    declaring_symbol=declaring,
                    member=_member(name=name, signature=name),
                    source_locator={
                        "symbol": name,
                        "evidence_path": "runtime",
                    },
                    surface_metadata={**session_meta, "symbol": name},
                )
            )

    artifacts = sorted(artifacts_by_id.values(), key=lambda item: item["artifact_id"])
    return _finalize_atoms(atoms), artifacts


def atomize_scan(
    scan: dict[str, Any],
    *,
    surface: str,
) -> tuple[list[dict[str, Any]], dict[str, int], list[dict[str, Any]]]:
    mapping = _require_mapping(scan, "scan")
    _require(surface in {LISP_SURFACE, COMMAND_SURFACE}, f"unsupported surface {surface}")
    observed_host_id = mapping.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    _require(isinstance(observed_host_id, str) and observed_host_id, "observed_host_id")
    observed_host_ids = [observed_host_id]
    source_counts = _source_counts(mapping)
    if surface == LISP_SURFACE:
        inventory_id = mapping.get("lisp_inventory_id") or DEFAULT_LISP_INVENTORY_ID
        atoms, artifacts = _lisp_atoms(
            mapping, inventory_id=inventory_id, observed_host_ids=observed_host_ids
        )
    else:
        inventory_id = mapping.get("command_inventory_id") or DEFAULT_COMMAND_INVENTORY_ID
        atoms, artifacts = _command_atoms(
            mapping, inventory_id=inventory_id, observed_host_ids=observed_host_ids
        )
    _require(isinstance(inventory_id, str) and inventory_id, "inventory_id")
    _require(artifacts, f"{surface}: source_artifacts must be non-empty")
    return atoms, source_counts, artifacts


def build_manifest(
    *,
    inventory_id: str,
    surface: str,
    observed_host_id: str,
    atoms: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
    source_counts: dict[str, int],
    atoms_sha256: str,
    captured_at: str | None = None,
) -> dict[str, Any]:
    by_kind = dict(sorted(Counter(atom["atom_kind"] for atom in atoms).items()))
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "inventory_id": inventory_id,
        "surface": surface,
        "observed_host_id": observed_host_id,
        "captured_at": captured_at or _now(),
        "extractor": {"name": EXTRACTOR_NAME, "version": EXTRACTOR_VERSION},
        "source_artifacts": artifacts,
        "atoms_file": ATOMS_FILE,
        "atoms_sha256": atoms_sha256,
        "counts": {
            "atoms": len(atoms),
            "by_kind": by_kind,
            "source": source_counts,
        },
    }
    _reject_machine_paths(manifest, "manifest")
    return manifest


def write_atoms_jsonl(path: Path, atoms: list[dict[str, Any]]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(json.dumps(atom, ensure_ascii=False, separators=(",", ":")) + "\n" for atom in atoms)
    path.write_text(text, encoding="utf-8", newline="\n")
    return _sha256_bytes(path.read_bytes())


def emit_inventory(
    scan: dict[str, Any],
    output_dir: Path,
    *,
    surface: str,
    captured_at: str | None = None,
) -> dict[str, Any]:
    if surface == LISP_SURFACE:
        inventory_id = scan.get("lisp_inventory_id") or DEFAULT_LISP_INVENTORY_ID
    else:
        inventory_id = scan.get("command_inventory_id") or DEFAULT_COMMAND_INVENTORY_ID
    observed_host_id = scan.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    try:
        guard_inventory_write(str(inventory_id), str(observed_host_id), output_dir)
    except HostIsolationError as error:
        raise LispCommandAtomizationError(str(error)) from error
    atoms, source_counts, artifacts = atomize_scan(scan, surface=surface)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    atoms_sha256 = write_atoms_jsonl(output_dir / ATOMS_FILE, atoms)
    if surface == LISP_SURFACE:
        inventory_id = scan.get("lisp_inventory_id") or DEFAULT_LISP_INVENTORY_ID
    else:
        inventory_id = scan.get("command_inventory_id") or DEFAULT_COMMAND_INVENTORY_ID
    observed_host_id = scan.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    timestamp = captured_at or scan.get("captured_at")
    manifest = build_manifest(
        inventory_id=inventory_id,
        surface=surface,
        observed_host_id=observed_host_id,
        atoms=atoms,
        artifacts=artifacts,
        source_counts=source_counts,
        atoms_sha256=atoms_sha256,
        captured_at=timestamp if isinstance(timestamp, str) else None,
    )
    (output_dir / "inventory-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return manifest


def emit_inventories(
    scan: dict[str, Any],
    *,
    lisp_output_dir: Path,
    command_output_dir: Path,
    captured_at: str | None = None,
) -> dict[str, dict[str, Any]]:
    return {
        LISP_SURFACE: emit_inventory(
            scan, lisp_output_dir, surface=LISP_SURFACE, captured_at=captured_at
        ),
        COMMAND_SURFACE: emit_inventory(
            scan, command_output_dir, surface=COMMAND_SURFACE, captured_at=captured_at
        ),
    }


def scan_lsp_file(path: Path, root: Path) -> dict[str, Any]:
    data = path.read_bytes()
    content = data.decode("latin-1")
    return {
        "relative_path": posix_relative(path, root),
        "bytes": len(data),
        "sha256": _sha256_bytes(data),
        "definitions": parse_lsp_definitions(content),
    }


def _decode_cui_xml(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _cui_xml_documents(data: bytes) -> list[tuple[str, str]]:
    if zipfile.is_zipfile(io.BytesIO(data)):
        documents: list[tuple[str, str]] = []
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = sorted(
                (
                    name
                    for name in archive.namelist()
                    if name.lower().endswith((".cui", ".xml")) and not name.endswith("/")
                ),
                key=lambda item: item.replace("\\", "/").casefold(),
            )
            for name in names:
                documents.append((name.replace("\\", "/"), _decode_cui_xml(archive.read(name))))
        return documents
    return [("document", _decode_cui_xml(data))]


def scan_cui_file(path: Path, root: Path) -> dict[str, Any]:
    data = path.read_bytes()
    relative = posix_relative(path, root)
    documents = _cui_xml_documents(data)
    macros: list[dict[str, Any]] = []
    parse_errors: list[str] = []
    for inner_name, xml_text in documents:
        parsed, parse_error = parse_cui_document(xml_text)
        if parse_error:
            parse_errors.append(f"{inner_name}: {parse_error}")
            continue
        for macro in parsed:
            command = sanitize_text(str(macro.get("command") or ""), mechanical_root=root)
            macros.append(
                {
                    "name": macro.get("name") or "",
                    "command": command,
                    "command_tokens": extract_command_tokens(command),
                    "menu_macro_uid": macro.get("menu_macro_uid"),
                    "archive_member": inner_name if zipfile.is_zipfile(io.BytesIO(data)) else None,
                }
            )
    return {
        "relative_path": relative,
        "bytes": len(data),
        "sha256": _sha256_bytes(data),
        "macros": macros,
        "parse_error": "; ".join(parse_errors) if parse_errors and not macros else None,
    }


def normalize_runtime(raw: dict[str, Any]) -> dict[str, Any]:
    mapping = _require_mapping(raw, "runtime")
    drawing = drawing_name(mapping.get("drawing"))
    return {
        "captured_at": mapping.get("captured_at"),
        "host": sanitize_text(str(mapping.get("host") or "")),
        "version": sanitize_text(str(mapping.get("version") or "")),
        "drawing": drawing,
        "atoms": _as_string_list(mapping.get("atoms")),
        "arx": _as_string_list(mapping.get("arx")),
        "vlx": _as_string_list(mapping.get("vlx")),
        "variables": _as_string_list(mapping.get("variables")),
        "error": mapping.get("error"),
    }


def _collect_source_files(root: Path, suffixes: set[str]) -> list[Path]:
    return sorted(
        (path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in suffixes),
        key=lambda item: posix_relative(item, root).casefold(),
    )


def _prefixed_relative(prefix: str, relative: str) -> str:
    if not prefix:
        return relative
    return f"{prefix}/{relative}"


def build_scan(
    mechanical_root: Path | None = None,
    *,
    source_trees: list[tuple[str, Path]] | None = None,
    runtime: dict[str, Any] | None = None,
    observed_host_id: str = DEFAULT_OBSERVED_HOST_ID,
    captured_at: str | None = None,
    lisp_inventory_id: str = DEFAULT_LISP_INVENTORY_ID,
    command_inventory_id: str = DEFAULT_COMMAND_INVENTORY_ID,
) -> dict[str, Any]:
    trees: list[tuple[str, Path]] = []
    if source_trees:
        for prefix, root in source_trees:
            resolved = Path(root).resolve()
            _require(resolved.is_dir(), f"source tree not found: {resolved}")
            trees.append((prefix, resolved))
    elif mechanical_root is not None:
        root = mechanical_root.resolve()
        _require(root.is_dir(), f"mechanical root not found: {root}")
        trees.append(("", root))
    else:
        raise LispCommandAtomizationError("mechanical root or source_trees is required")

    lsp_records: list[dict[str, Any]] = []
    cui_records: list[dict[str, Any]] = []
    for prefix, root in trees:
        for path in _collect_source_files(root, {".lsp"}):
            record = scan_lsp_file(path, root)
            record["relative_path"] = _prefixed_relative(prefix, record["relative_path"])
            lsp_records.append(record)
        for path in _collect_source_files(root, {".cui", ".cuix"}):
            record = scan_cui_file(path, root)
            record["relative_path"] = _prefixed_relative(prefix, record["relative_path"])
            cui_records.append(record)
    lsp_records.sort(key=lambda item: str(item["relative_path"]).casefold())
    cui_records.sort(key=lambda item: str(item["relative_path"]).casefold())

    normalized_runtime = normalize_runtime(runtime) if runtime else None
    if normalized_runtime is not None:
        _require(
            not normalized_runtime.get("error"),
            f"runtime probe failed: {normalized_runtime.get('error')}",
        )
        _require(normalized_runtime.get("host"), "runtime probe did not attach")
        host_text = str(normalized_runtime.get("host") or "").casefold()
        if observed_host_id == "autocad-2024":
            _require("autocad" in host_text, f"runtime host is not AutoCAD: {normalized_runtime.get('host')}")
            _require("bricscad" not in host_text, "runtime host is BricsCAD, not AutoCAD")
            _require("thcad" not in host_text, "runtime host is THCAD, not AutoCAD")
    scan = {
        "observed_host_id": observed_host_id,
        "captured_at": captured_at or _now(),
        "lisp_inventory_id": lisp_inventory_id,
        "command_inventory_id": command_inventory_id,
        "lsp_files": lsp_records,
        "cui_files": cui_records,
        "runtime": normalized_runtime,
    }
    _reject_machine_paths(
        {
            "lsp_files": scan["lsp_files"],
            "cui_files": scan["cui_files"],
            "runtime": {
                key: value
                for key, value in (normalized_runtime or {}).items()
                if key != "raw_output"
            },
        },
        "scan",
    )
    return scan


def write_scan(path: Path, scan: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(scan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _summarize(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "inventory_id": manifest["inventory_id"],
        "surface": manifest["surface"],
        "atoms": manifest["counts"]["atoms"],
        "by_kind": manifest["counts"]["by_kind"],
        "source": manifest["counts"]["source"],
        "atoms_sha256": manifest["atoms_sha256"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Emit LISP and command CapabilityAtom inventories from a frozen scan."
    )
    parser.add_argument("--scan", type=Path)
    parser.add_argument("--mechanical-root", type=Path)
    parser.add_argument("--source-tree", action="append", default=[], metavar="PREFIX=PATH")
    parser.add_argument("--runtime-json", type=Path)
    parser.add_argument("--lisp-output-dir", type=Path, required=True)
    parser.add_argument("--command-output-dir", type=Path, required=True)
    parser.add_argument("--scan-output", type=Path)
    parser.add_argument("--captured-at", default=None)
    parser.add_argument("--observed-host-id", default=None)
    parser.add_argument("--lisp-inventory-id", default=None)
    parser.add_argument("--command-inventory-id", default=None)
    parser.add_argument("--require-runtime", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.scan:
            scan = json.loads(args.scan.read_text(encoding="utf-8"))
            _require(isinstance(scan, dict), "scan root must be an object")
        else:
            runtime = None
            if args.runtime_json:
                runtime = json.loads(args.runtime_json.read_text(encoding="utf-8"))
                _require(isinstance(runtime, dict), "runtime JSON must be an object")
            elif args.require_runtime:
                raise LispCommandAtomizationError("runtime JSON is required")
            trees: list[tuple[str, Path]] = []
            for item in args.source_tree:
                _require("=" in item, f"source-tree must be PREFIX=PATH: {item}")
                prefix, raw_path = item.split("=", 1)
                trees.append((prefix, Path(raw_path)))
            scan = build_scan(
                args.mechanical_root,
                source_trees=trees or None,
                runtime=runtime,
                observed_host_id=args.observed_host_id or DEFAULT_OBSERVED_HOST_ID,
                captured_at=args.captured_at,
                lisp_inventory_id=args.lisp_inventory_id or DEFAULT_LISP_INVENTORY_ID,
                command_inventory_id=args.command_inventory_id or DEFAULT_COMMAND_INVENTORY_ID,
            )
        if args.require_runtime:
            runtime = scan.get("runtime")
            _require(isinstance(runtime, dict) and runtime.get("host"), "runtime probe did not attach")
        if args.scan_output:
            write_scan(args.scan_output, scan)
        manifests = emit_inventories(
            scan,
            lisp_output_dir=args.lisp_output_dir,
            command_output_dir=args.command_output_dir,
            captured_at=args.captured_at or scan.get("captured_at"),
        )
        print(
            json.dumps(
                {
                    "lisp": _summarize(manifests[LISP_SURFACE]),
                    "command": _summarize(manifests[COMMAND_SURFACE]),
                    "lisp_output_dir": str(args.lisp_output_dir),
                    "command_output_dir": str(args.command_output_dir),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except (OSError, json.JSONDecodeError, LispCommandAtomizationError, ET.ParseError) as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
