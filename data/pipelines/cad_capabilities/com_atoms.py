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
SURFACE = "com"
EXTRACTOR_NAME = "ExportThcadComCapabilityAtoms"
EXTRACTOR_VERSION = "1.0"
DEFAULT_INVENTORY_ID = "thcad-v24.com"
DEFAULT_OBSERVED_HOST_ID = "thcad-v24"
ATOMS_FILE = "capability-atoms.jsonl"

_MACHINE_PATH = re.compile(r"(?i)(?:[a-z]:[\\/]|\\\\)")


class ComAtomizationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ComAtomizationError(message)


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


def canonical_com_key(
    *,
    artifact_id: str,
    declaring: str,
    atom_kind: str,
    signature: str,
) -> str:
    return f"com|{artifact_id}|{declaring}|{atom_kind}|{signature}"


def _format_parameter(parameter: dict[str, Any]) -> str:
    pieces: list[str] = []
    if parameter.get("optional"):
        pieces.append("optional")
    direction = parameter["direction"]
    if direction in {"out", "ref"}:
        pieces.append(direction)
    pieces.append(parameter["type"])
    name = parameter.get("name") or ""
    if name:
        pieces.append(name)
    return " ".join(pieces)


def format_signature(return_type: str | None, name: str, parameters: list[dict[str, Any]]) -> str:
    rendered = ", ".join(_format_parameter(parameter) for parameter in parameters)
    return f"{return_type or 'System.Void'} {name}({rendered})"


def _parameter_record(raw: dict[str, Any], position: int, location: str) -> dict[str, Any]:
    name = raw.get("name")
    _require(isinstance(name, str), f"{location}: parameter name must be a string")
    type_name = raw.get("type")
    _require(isinstance(type_name, str) and type_name, f"{location}: parameter type must be non-empty")
    direction = raw.get("direction", "in")
    _require(direction in {"in", "out", "ref", "return"}, f"{location}: invalid direction")
    optional = raw.get("optional", False)
    _require(isinstance(optional, bool), f"{location}: optional must be boolean")
    record: dict[str, Any] = {
        "position": position,
        "name": name,
        "type": type_name,
        "direction": direction,
        "optional": optional,
    }
    if "default_value" in raw and raw["default_value"] is not None:
        record["default_value"] = raw["default_value"]
    return record


def _copy_parameters(raw_parameters: Any, location: str) -> list[dict[str, Any]]:
    parameters = []
    for position, raw in enumerate(_require_list(raw_parameters or [], location)):
        item_location = f"{location}[{position}]"
        mapping = _require_mapping(raw, item_location)
        parameters.append(_parameter_record(mapping, position, item_location))
    return parameters


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
    return {
        "symbol_id": symbol_id,
        "full_name": full_name,
        "kind": kind,
    }


def _member(
    *,
    name: str,
    signature: str,
    return_type: str | None,
    parameters: list[dict[str, Any]],
    is_static: bool,
) -> dict[str, Any]:
    return {
        "name": name,
        "signature": signature,
        "return_type": return_type,
        "parameters": parameters,
        "is_static": is_static,
    }


def _provenance(source_locator: dict[str, Any]) -> dict[str, Any]:
    return {
        "extractor": EXTRACTOR_NAME,
        "extractor_version": EXTRACTOR_VERSION,
        "source_locator": source_locator,
    }


def _atom(
    *,
    inventory_id: str,
    canonical_key: str,
    atom_kind: str,
    observed_host_ids: list[str],
    source_artifact: dict[str, Any],
    declaring_symbol: dict[str, str] | None,
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
        "atom_kind": atom_kind,
        "observed_host_ids": list(observed_host_ids),
        "source_artifact": dict(source_artifact),
        "declaring_symbol": declaring_symbol,
        "member": member,
        "provenance": _provenance(source_locator),
        "surface_metadata": surface_metadata,
    }
    _reject_machine_paths(record, record["atom_id"])
    return record


def _typelib_artifact(library: dict[str, Any]) -> dict[str, Any]:
    label = library.get("label")
    _require(isinstance(label, str) and label, "type library label must be non-empty")
    sha256 = library.get("sha256")
    if isinstance(sha256, str) and sha256:
        sha256 = sha256.lower()
    else:
        sha256 = None
    version = library.get("version")
    return _source_artifact(
        artifact_id=f"typelib:{label}",
        kind="type_library",
        name=label,
        version=version if isinstance(version, str) and version else None,
        sha256=sha256,
    )


def _registry_artifact(observed_host_id: str) -> dict[str, Any]:
    if observed_host_id == "autocad-2024":
        name = "HKCR ProgID (AutoCAD.*)"
    else:
        name = "HKCR ProgID (BricscadApp|BricscadDb|BricscadSm|THCadToolKit|THCAD)"
    return _source_artifact(
        artifact_id="registry:hkcr-progid",
        kind="registry",
        name=name,
        version=None,
        sha256=None,
    )


def _method_atoms(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    library: dict[str, Any],
    interface: dict[str, Any],
    method: dict[str, Any],
) -> list[dict[str, Any]]:
    label = library["label"]
    full_name = interface["full_name"]
    parameters = _copy_parameters(method.get("parameters"), f"{full_name}.{method.get('name')}.parameters")
    name = method.get("name")
    _require(isinstance(name, str) and name, f"{full_name}: method name must be non-empty")
    return_type = method.get("return_type") or "System.Void"
    signature = format_signature(return_type, name, parameters)
    atom_kind = "method"
    return [
        _atom(
            inventory_id=inventory_id,
            canonical_key=canonical_com_key(
                artifact_id=artifact["artifact_id"],
                declaring=full_name,
                atom_kind=atom_kind,
                signature=signature,
            ),
            atom_kind=atom_kind,
            observed_host_ids=observed_host_ids,
            source_artifact=artifact,
            declaring_symbol=_declaring_symbol(
                f"com-type:{label}:{full_name}",
                full_name,
                interface.get("kind") or "interface",
            ),
            member=_member(
                name=name,
                signature=signature,
                return_type=return_type,
                parameters=parameters,
                is_static=bool(method.get("is_static", False)),
            ),
            source_locator={
                "type_library": label,
                "interface": full_name,
                "member": name,
                "atom_kind": atom_kind,
            },
            surface_metadata={
                "bitness": library.get("bitness"),
                "type_library": label,
                "source_file_name": library.get("file_name"),
                "declaring_interface": full_name,
                "dispid": method.get("dispid"),
            },
        )
    ]


def _property_atoms(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    library: dict[str, Any],
    interface: dict[str, Any],
    property_info: dict[str, Any],
) -> list[dict[str, Any]]:
    label = library["label"]
    full_name = interface["full_name"]
    name = property_info.get("name")
    _require(isinstance(name, str) and name, f"{full_name}: property name must be non-empty")
    property_type = property_info.get("type")
    _require(isinstance(property_type, str) and property_type, f"{full_name}.{name}: property type required")
    index_parameters = _copy_parameters(
        property_info.get("parameters"),
        f"{full_name}.{name}.parameters",
    )
    is_static = bool(property_info.get("is_static", False))
    atoms: list[dict[str, Any]] = []
    accessors: list[tuple[str, str, str, list[dict[str, Any]]]] = []
    if property_info.get("can_read"):
        accessors.append(("property_get", f"get_{name}", property_type, index_parameters))
    if property_info.get("can_write"):
        value_parameter = {
            "position": len(index_parameters),
            "name": "value",
            "type": property_type,
            "direction": "in",
            "optional": False,
        }
        accessors.append(
            (
                "property_set",
                f"set_{name}",
                "System.Void",
                [*index_parameters, value_parameter],
            )
        )
    for atom_kind, accessor_name, return_type, parameters in accessors:
        signature = format_signature(return_type, accessor_name, parameters)
        atoms.append(
            _atom(
                inventory_id=inventory_id,
                canonical_key=canonical_com_key(
                    artifact_id=artifact["artifact_id"],
                    declaring=full_name,
                    atom_kind=atom_kind,
                    signature=signature,
                ),
                atom_kind=atom_kind,
                observed_host_ids=observed_host_ids,
                source_artifact=artifact,
                declaring_symbol=_declaring_symbol(
                    f"com-type:{label}:{full_name}",
                    full_name,
                    interface.get("kind") or "interface",
                ),
                member=_member(
                    name=name,
                    signature=signature,
                    return_type=return_type,
                    parameters=parameters,
                    is_static=is_static,
                ),
                source_locator={
                    "type_library": label,
                    "interface": full_name,
                    "member": name,
                    "atom_kind": atom_kind,
                },
                surface_metadata={
                    "bitness": library.get("bitness"),
                    "type_library": label,
                    "source_file_name": library.get("file_name"),
                    "declaring_interface": full_name,
                    "dispid": property_info.get("dispid"),
                },
            )
        )
    return atoms


def _event_atoms(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    library: dict[str, Any],
    interface: dict[str, Any],
    event_info: dict[str, Any],
) -> list[dict[str, Any]]:
    label = library["label"]
    full_name = interface["full_name"]
    name = event_info.get("name")
    _require(isinstance(name, str) and name, f"{full_name}: event name must be non-empty")
    handler_type = event_info.get("handler_type") or "System.Object"
    is_static = bool(event_info.get("is_static", False))
    handler_parameter = {
        "position": 0,
        "name": "handler",
        "type": handler_type,
        "direction": "in",
        "optional": False,
    }
    atoms: list[dict[str, Any]] = []
    for atom_kind, accessor_name in (
        ("event_subscribe", f"add_{name}"),
        ("event_unsubscribe", f"remove_{name}"),
    ):
        signature = format_signature("System.Void", accessor_name, [handler_parameter])
        atoms.append(
            _atom(
                inventory_id=inventory_id,
                canonical_key=canonical_com_key(
                    artifact_id=artifact["artifact_id"],
                    declaring=full_name,
                    atom_kind=atom_kind,
                    signature=signature,
                ),
                atom_kind=atom_kind,
                observed_host_ids=observed_host_ids,
                source_artifact=artifact,
                declaring_symbol=_declaring_symbol(
                    f"com-type:{label}:{full_name}",
                    full_name,
                    interface.get("kind") or "interface",
                ),
                member=_member(
                    name=name,
                    signature=signature,
                    return_type="System.Void",
                    parameters=[handler_parameter],
                    is_static=is_static,
                ),
                source_locator={
                    "type_library": label,
                    "interface": full_name,
                    "member": name,
                    "atom_kind": atom_kind,
                },
                surface_metadata={
                    "bitness": library.get("bitness"),
                    "type_library": label,
                    "source_file_name": library.get("file_name"),
                    "declaring_interface": full_name,
                    "dispid": event_info.get("dispid"),
                    "event_handler_type": handler_type,
                },
            )
        )
    return atoms


def _progid_atom(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    progid: dict[str, Any],
) -> dict[str, Any]:
    name = progid.get("prog_id")
    _require(isinstance(name, str) and name, "progid must be non-empty")
    signature = "System.Object CreateInstance()"
    atom_kind = "progid_activation"
    registry_view = progid.get("registry_view")
    bitness = None
    if registry_view == "32-bit":
        bitness = "32-bit"
    elif registry_view == "64-bit":
        bitness = "64-bit"
    return _atom(
        inventory_id=inventory_id,
        canonical_key=canonical_com_key(
            artifact_id=artifact["artifact_id"],
            declaring=name,
            atom_kind=atom_kind,
            signature=signature,
        ),
        atom_kind=atom_kind,
        observed_host_ids=observed_host_ids,
        source_artifact=artifact,
        declaring_symbol=_declaring_symbol(f"com-progid:{name}", name, "progid"),
        member=_member(
            name=name,
            signature=signature,
            return_type="System.Object",
            parameters=[],
            is_static=True,
        ),
        source_locator={
            "progid": name,
            "clsid": progid.get("clsid"),
            "registry_view": registry_view,
        },
        surface_metadata={
            "bitness": bitness,
            "progid": name,
            "clsid": progid.get("clsid"),
            "registry_view": registry_view,
            "server_kind": progid.get("server_kind"),
            "type_lib_id": progid.get("type_lib"),
        },
    )


def atomize_scan(scan: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    mapping = _require_mapping(scan, "scan")
    inventory_id = mapping.get("inventory_id") or DEFAULT_INVENTORY_ID
    _require(isinstance(inventory_id, str) and inventory_id, "inventory_id must be non-empty")
    observed_host_id = mapping.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    _require(isinstance(observed_host_id, str) and observed_host_id, "observed_host_id must be non-empty")
    observed_host_ids = [observed_host_id]

    libraries = _require_list(mapping.get("type_libraries") or [], "type_libraries")
    progids = _require_list(mapping.get("progids") or [], "progids")
    conversion_errors = _require_list(mapping.get("conversion_errors") or [], "conversion_errors")
    top_level_reflection_errors = mapping.get("reflection_errors")
    if top_level_reflection_errors is None:
        reflection_errors: list[Any] = []
        for raw_library in libraries:
            if isinstance(raw_library, dict):
                reflection_errors.extend(raw_library.get("reflection_errors") or [])
    else:
        reflection_errors = _require_list(top_level_reflection_errors, "reflection_errors")

    artifacts: list[dict[str, Any]] = []
    artifacts_by_id: dict[str, dict[str, Any]] = {}
    atoms: list[dict[str, Any]] = []
    seen_keys: dict[str, str] = {}

    interfaces = 0
    declared_methods = 0
    declared_properties = 0
    declared_events = 0

    for library_index, raw_library in enumerate(libraries):
        library = _require_mapping(raw_library, f"type_libraries[{library_index}]")
        artifact = _typelib_artifact(library)
        if artifact["artifact_id"] not in artifacts_by_id:
            artifacts.append(artifact)
            artifacts_by_id[artifact["artifact_id"]] = artifact
        dumped_interfaces = _require_list(library.get("interfaces") or [], f"{library.get('label')}.interfaces")
        dumped_methods = 0
        dumped_properties = 0
        dumped_events = 0
        for interface_index, raw_interface in enumerate(dumped_interfaces):
            interface = _require_mapping(raw_interface, f"{library.get('label')}.interfaces[{interface_index}]")
            _require(isinstance(interface.get("full_name"), str) and interface["full_name"], "interface full_name")
            methods = _require_list(interface.get("methods") or [], f"{interface['full_name']}.methods")
            properties = _require_list(interface.get("properties") or [], f"{interface['full_name']}.properties")
            events = _require_list(interface.get("events") or [], f"{interface['full_name']}.events")
            dumped_methods += len(methods)
            dumped_properties += len(properties)
            dumped_events += len(events)
            for method in methods:
                atoms.extend(
                    _method_atoms(
                        inventory_id=inventory_id,
                        observed_host_ids=observed_host_ids,
                        artifact=artifact,
                        library=library,
                        interface=interface,
                        method=_require_mapping(method, f"{interface['full_name']}.method"),
                    )
                )
            for property_info in properties:
                atoms.extend(
                    _property_atoms(
                        inventory_id=inventory_id,
                        observed_host_ids=observed_host_ids,
                        artifact=artifact,
                        library=library,
                        interface=interface,
                        property_info=_require_mapping(property_info, f"{interface['full_name']}.property"),
                    )
                )
            for event_info in events:
                atoms.extend(
                    _event_atoms(
                        inventory_id=inventory_id,
                        observed_host_ids=observed_host_ids,
                        artifact=artifact,
                        library=library,
                        interface=interface,
                        event_info=_require_mapping(event_info, f"{interface['full_name']}.event"),
                    )
                )
        label = library.get("label") or f"type_libraries[{library_index}]"
        if "interface_count" in library:
            _require(
                int(library["interface_count"]) == len(dumped_interfaces),
                f"{label}: interface_count {library['interface_count']} != dumped {len(dumped_interfaces)}",
            )
            interfaces += int(library["interface_count"])
        else:
            interfaces += len(dumped_interfaces)
        if "declared_method_count" in library:
            _require(
                int(library["declared_method_count"]) == dumped_methods,
                f"{label}: declared_method_count {library['declared_method_count']} != dumped {dumped_methods}",
            )
            declared_methods += int(library["declared_method_count"])
        else:
            declared_methods += dumped_methods
        if "declared_property_count" in library:
            _require(
                int(library["declared_property_count"]) == dumped_properties,
                f"{label}: declared_property_count {library['declared_property_count']} != dumped {dumped_properties}",
            )
            declared_properties += int(library["declared_property_count"])
        else:
            declared_properties += dumped_properties
        if "declared_event_count" in library:
            _require(
                int(library["declared_event_count"]) == dumped_events,
                f"{label}: declared_event_count {library['declared_event_count']} != dumped {dumped_events}",
            )
            declared_events += int(library["declared_event_count"])
        else:
            declared_events += dumped_events

    registry_artifact = None
    if progids:
        registry_artifact = _registry_artifact(observed_host_id)
        artifacts.append(registry_artifact)
        artifacts_by_id[registry_artifact["artifact_id"]] = registry_artifact
        for progid_index, raw_progid in enumerate(progids):
            progid = _require_mapping(raw_progid, f"progids[{progid_index}]")
            atoms.append(
                _progid_atom(
                    inventory_id=inventory_id,
                    observed_host_ids=observed_host_ids,
                    artifact=registry_artifact,
                    progid=progid,
                )
            )

    unique_atoms: list[dict[str, Any]] = []
    for atom in atoms:
        key = atom["canonical_key"]
        atom_id = atom["atom_id"]
        _require(key not in seen_keys, f"duplicate canonical_key {key}")
        seen_keys[key] = atom_id
        unique_atoms.append(atom)

    unique_atoms.sort(key=lambda item: str(item["atom_id"]))
    artifacts.sort(key=lambda item: item["artifact_id"])

    source_counts = {
        "interfaces": interfaces,
        "declared_methods": declared_methods,
        "declared_properties": declared_properties,
        "declared_events": declared_events,
        "progids": len(progids),
        "conversion_errors": len(conversion_errors),
        "reflection_errors": len(reflection_errors),
    }
    return unique_atoms, source_counts, artifacts


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
    timestamp = captured_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "inventory_id": inventory_id,
        "surface": SURFACE,
        "observed_host_id": observed_host_id,
        "captured_at": timestamp,
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
    text = "".join(
        json.dumps(atom, ensure_ascii=False, separators=(",", ":")) + "\n" for atom in atoms
    )
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
        raise ComAtomizationError(str(error)) from error
    atoms, source_counts, artifacts = atomize_scan(scan)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    atoms_path = output_dir / ATOMS_FILE
    atoms_sha256 = write_atoms_jsonl(atoms_path, atoms)
    inventory_id = scan.get("inventory_id") or DEFAULT_INVENTORY_ID
    observed_host_id = scan.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    manifest = build_manifest(
        inventory_id=inventory_id,
        observed_host_id=observed_host_id,
        atoms=atoms,
        artifacts=artifacts,
        source_counts=source_counts,
        atoms_sha256=atoms_sha256,
        captured_at=captured_at,
    )
    manifest_path = output_dir / "inventory-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit COM CapabilityAtom JSONL from a type-library scan document.")
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
    except (OSError, json.JSONDecodeError, ComAtomizationError) as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
