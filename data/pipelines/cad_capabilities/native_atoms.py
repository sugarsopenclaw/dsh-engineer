from __future__ import annotations

import argparse
import hashlib
import json
import re
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
SURFACE = "native"
EXTRACTOR_NAME = "ExportThcadNativeCapabilityAtoms"
EXTRACTOR_VERSION = "1.0"
DEFAULT_INVENTORY_ID = "thcad-v24.native"
DEFAULT_OBSERVED_HOST_ID = "thcad-v24"
ATOMS_FILE = "capability-atoms.jsonl"
_MACHINE_PATH = re.compile(r"(?i)(?:[a-z]:\\|\\\\[a-z0-9._-]+\\)")
_STANDARD_ENTRY = re.compile(r"^(Dll|acrx|odrx)")


class NativeAtomizationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise NativeAtomizationError(message)


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


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def architecture_of(machine: str | None, pe32_plus: bool | None) -> str:
    if isinstance(machine, str):
        lowered = machine.casefold()
        if lowered in {"0x8664", "8664"}:
            return "x64"
        if lowered in {"0x014c", "0x14c", "14c"}:
            return "x86"
        if lowered in {"0xaa64", "aa64"}:
            return "arm64"
    if pe32_plus is True:
        return "x64"
    if pe32_plus is False:
        return "x86"
    return "unknown"


def export_identity(name: str, ordinal: int) -> str:
    if name:
        return name
    return f"ordinal:{ordinal}"


def canonical_native_key(
    *,
    relative_path: str,
    identity: str,
    ordinal: int,
) -> str:
    return f"native|{relative_path}|native_export|{identity}|ordinal:{ordinal}"


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


def _module_artifact(module: dict[str, Any]) -> dict[str, Any]:
    relative = module["relative_path"]
    sha256 = module.get("sha256")
    if isinstance(sha256, str) and sha256:
        sha256 = sha256.lower()
    else:
        sha256 = None
    version = module.get("version")
    return _source_artifact(
        artifact_id=f"pe:{relative}",
        kind="pe_module",
        name=relative,
        version=version if isinstance(version, str) and version else None,
        sha256=sha256,
    )


def _atom(
    *,
    inventory_id: str,
    canonical_key: str,
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
        "atom_id": canonical_atom_id(SURFACE, canonical_key),
        "canonical_key": canonical_key,
        "surface": SURFACE,
        "atom_kind": "native_export",
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


def _export_atom(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    module: dict[str, Any],
    export: dict[str, Any],
) -> dict[str, Any]:
    relative = module["relative_path"]
    name = export.get("name")
    _require(isinstance(name, str), f"{relative}: export name must be a string")
    ordinal_raw = export.get("ordinal")
    _require(isinstance(ordinal_raw, int) and not isinstance(ordinal_raw, bool), f"{relative}: ordinal must be int")
    ordinal = ordinal_raw
    identity = export_identity(name, ordinal)
    signature = f"PE EXPORT {identity}"
    decorated = name.startswith("?")
    machine = module.get("machine")
    pe32_plus = module.get("pe32_plus")
    return _atom(
        inventory_id=inventory_id,
        canonical_key=canonical_native_key(relative_path=relative, identity=identity, ordinal=ordinal),
        observed_host_ids=observed_host_ids,
        source_artifact=artifact,
        declaring_symbol={
            "symbol_id": f"native-module:{relative}",
            "full_name": relative,
            "kind": "pe_module",
        },
        member={
            "name": identity,
            "signature": signature,
            "return_type": None,
            "parameters": [],
            "is_static": True,
        },
        source_locator={
            "module": relative,
            "symbol": identity,
            "ordinal": ordinal,
            "evidence": "pe_export_symbol",
        },
        surface_metadata={
            "evidence": "pe_export_symbol",
            "not_a_calling_contract": True,
            "ordinal": ordinal,
            "rva": export.get("rva"),
            "forwarder": export.get("forwarder") or "",
            "machine": machine,
            "pe32_plus": pe32_plus,
            "architecture": architecture_of(machine if isinstance(machine, str) else None, pe32_plus if isinstance(pe32_plus, bool) else None),
            "decorated": decorated,
            "standard_entry": bool(name and _STANDARD_ENTRY.match(name)),
            "ordinal_only": not bool(name),
            "module": relative,
            "category": module.get("category"),
            "exporting_module_name": module.get("exporting_module_name") or "",
        },
    )


def atomize_scan(scan: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, int], list[dict[str, Any]]]:
    mapping = _require_mapping(scan, "scan")
    inventory_id = mapping.get("inventory_id") or DEFAULT_INVENTORY_ID
    _require(isinstance(inventory_id, str) and inventory_id, "inventory_id")
    observed_host_id = mapping.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    _require(isinstance(observed_host_id, str) and observed_host_id, "observed_host_id")
    observed_host_ids = [observed_host_id]
    modules = _require_list(mapping.get("modules") or [], "modules")

    artifacts: list[dict[str, Any]] = []
    artifacts_by_id: dict[str, dict[str, Any]] = {}
    atoms: list[dict[str, Any]] = []
    seen_keys: dict[str, str] = {}

    plugin_modules = 0
    host_modules = 0
    plugin_exports = 0
    host_exports = 0
    named_exports = 0
    ordinal_only = 0
    decorated_exports = 0
    standard_entries = 0
    pe_read_errors = 0

    for index, raw_module in enumerate(modules):
        module = _require_mapping(raw_module, f"modules[{index}]")
        relative = module.get("relative_path")
        _require(isinstance(relative, str) and relative, f"modules[{index}]: relative_path")
        artifact = _module_artifact(module)
        if artifact["artifact_id"] not in artifacts_by_id:
            artifacts.append(artifact)
            artifacts_by_id[artifact["artifact_id"]] = artifact
        category = str(module.get("category") or "")
        is_host = category == "host_runtime"
        if is_host:
            host_modules += 1
        else:
            plugin_modules += 1
        if module.get("read_error"):
            pe_read_errors += 1
            continue
        exports = _require_list(module.get("exports") or [], f"{relative}.exports")
        if is_host:
            host_exports += len(exports)
        else:
            plugin_exports += len(exports)
        for export_index, raw_export in enumerate(exports):
            export = _require_mapping(raw_export, f"{relative}.exports[{export_index}]")
            name = str(export.get("name") or "")
            if name:
                named_exports += 1
                if name.startswith("?"):
                    decorated_exports += 1
                if _STANDARD_ENTRY.match(name):
                    standard_entries += 1
            else:
                ordinal_only += 1
            atom = _export_atom(
                inventory_id=inventory_id,
                observed_host_ids=observed_host_ids,
                artifact=artifact,
                module=module,
                export=export,
            )
            key = atom["canonical_key"]
            _require(key not in seen_keys, f"duplicate canonical_key {key}")
            seen_keys[key] = atom["atom_id"]
            atoms.append(atom)

    atoms.sort(key=lambda item: str(item["atom_id"]))
    artifacts.sort(key=lambda item: item["artifact_id"])
    source_counts = {
        "plugin_modules": plugin_modules,
        "host_modules": host_modules,
        "plugin_exports": plugin_exports,
        "host_exports": host_exports,
        "named_exports": named_exports,
        "ordinal_only_exports": ordinal_only,
        "decorated_exports": decorated_exports,
        "standard_entries": standard_entries,
        "sdk_headers": int(mapping.get("sdk_headers") or 0),
        "lib_files": int(mapping.get("lib_files") or 0),
        "coff_import_libs": int(mapping.get("coff_import_libs") or 0),
        "pe_read_errors": pe_read_errors,
    }
    _require(artifacts, "source_artifacts must be non-empty")
    return atoms, source_counts, artifacts


def build_manifest(
    *,
    inventory_id: str,
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
        "surface": SURFACE,
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
    return hashlib.sha256(path.read_bytes()).hexdigest()


def emit_inventory(
    scan: dict[str, Any],
    output_dir: Path,
    captured_at: str | None = None,
) -> dict[str, Any]:
    inventory_id = scan.get("inventory_id") or DEFAULT_INVENTORY_ID
    observed_host_id = scan.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    try:
        guard_inventory_write(str(inventory_id), str(observed_host_id), output_dir)
    except HostIsolationError as error:
        raise NativeAtomizationError(str(error)) from error
    atoms, source_counts, artifacts = atomize_scan(scan)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    atoms_sha256 = write_atoms_jsonl(output_dir / ATOMS_FILE, atoms)
    inventory_id = scan.get("inventory_id") or DEFAULT_INVENTORY_ID
    observed_host_id = scan.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    timestamp = captured_at or scan.get("captured_at")
    manifest = build_manifest(
        inventory_id=inventory_id,
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit native PE CapabilityAtom JSONL from a frozen scan.")
    parser.add_argument("--scan", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--captured-at", default=None)
    args = parser.parse_args(argv)
    try:
        scan = json.loads(args.scan.read_text(encoding="utf-8"))
        _require(isinstance(scan, dict), "scan root must be an object")
        manifest = emit_inventory(scan, args.output_dir, captured_at=args.captured_at)
        print(
            json.dumps(
                {
                    "inventory_id": manifest["inventory_id"],
                    "atoms": manifest["counts"]["atoms"],
                    "by_kind": manifest["counts"]["by_kind"],
                    "source": manifest["counts"]["source"],
                    "atoms_sha256": manifest["atoms_sha256"],
                    "output_dir": str(args.output_dir),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except (OSError, json.JSONDecodeError, NativeAtomizationError) as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
