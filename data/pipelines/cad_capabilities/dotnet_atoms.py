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
SURFACE = "dotnet"
EXTRACTOR_NAME = "ExportThcadDotNetCapabilityAtoms"
EXTRACTOR_VERSION = "1.0"
DEFAULT_INVENTORY_ID = "thcad-v24.dotnet"
DEFAULT_OBSERVED_HOST_ID = "thcad-v24"
ATOMS_FILE = "capability-atoms.jsonl"

_MACHINE_PATH = re.compile(r"(?i)(?:[a-z]:[\\/]|\\\\)")


class DotNetAtomizationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise DotNetAtomizationError(message)


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


def canonical_dotnet_key(
    *,
    assembly_name: str,
    declaring: str,
    atom_kind: str,
    signature: str,
) -> str:
    return f"dotnet|{assembly_name}|{declaring}|{atom_kind}|{signature}"


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
        "provenance": {
            "extractor": EXTRACTOR_NAME,
            "extractor_version": EXTRACTOR_VERSION,
            "source_locator": source_locator,
        },
        "surface_metadata": surface_metadata,
    }
    _reject_machine_paths(record, record["atom_id"])
    return record


def _assembly_artifact(assembly: dict[str, Any]) -> dict[str, Any]:
    name = assembly.get("name")
    _require(isinstance(name, str) and name, "assembly name must be non-empty")
    sha256 = assembly.get("sha256")
    if isinstance(sha256, str) and sha256:
        sha256 = sha256.lower()
    else:
        sha256 = None
    version = assembly.get("version")
    return _source_artifact(
        artifact_id=f"assembly:{name}",
        kind="assembly",
        name=name,
        version=version if isinstance(version, str) and version else None,
        sha256=sha256,
    )


def _common_metadata(assembly: dict[str, Any], type_info: dict[str, Any]) -> dict[str, Any]:
    return {
        "assembly": assembly.get("name"),
        "source_file_name": assembly.get("file_name"),
        "declaring_type": type_info.get("full_name"),
    }


def _symbol(assembly: dict[str, Any], type_info: dict[str, Any]) -> dict[str, str]:
    full_name = type_info["full_name"]
    return _declaring_symbol(
        f"dotnet-type:{assembly['name']}:{full_name}",
        full_name,
        type_info.get("kind") or "class",
    )


def _method_atoms(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    assembly: dict[str, Any],
    type_info: dict[str, Any],
    method: dict[str, Any],
    atom_kind: str,
) -> list[dict[str, Any]]:
    full_name = type_info["full_name"]
    name = method.get("name")
    _require(isinstance(name, str) and name, f"{full_name}: member name must be non-empty")
    parameters = _copy_parameters(method.get("parameters"), f"{full_name}.{name}.parameters")
    if atom_kind == "constructor":
        return_type = full_name
    else:
        return_type = method.get("return_type") or "System.Void"
    signature = format_signature(return_type, name, parameters)
    return [
        _atom(
            inventory_id=inventory_id,
            canonical_key=canonical_dotnet_key(
                assembly_name=assembly["name"],
                declaring=full_name,
                atom_kind=atom_kind,
                signature=signature,
            ),
            atom_kind=atom_kind,
            observed_host_ids=observed_host_ids,
            source_artifact=artifact,
            declaring_symbol=_symbol(assembly, type_info),
            member=_member(
                name=name,
                signature=signature,
                return_type=return_type,
                parameters=parameters,
                is_static=bool(method.get("is_static", False)),
            ),
            source_locator={
                "assembly": assembly["name"],
                "type": full_name,
                "member": name,
                "atom_kind": atom_kind,
            },
            surface_metadata=_common_metadata(assembly, type_info),
        )
    ]


def _property_atoms(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    assembly: dict[str, Any],
    type_info: dict[str, Any],
    property_info: dict[str, Any],
) -> list[dict[str, Any]]:
    full_name = type_info["full_name"]
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
        accessors.append(("property_set", f"set_{name}", "System.Void", [*index_parameters, value_parameter]))
    for atom_kind, accessor_name, return_type, parameters in accessors:
        signature = format_signature(return_type, accessor_name, parameters)
        atoms.append(
            _atom(
                inventory_id=inventory_id,
                canonical_key=canonical_dotnet_key(
                    assembly_name=assembly["name"],
                    declaring=full_name,
                    atom_kind=atom_kind,
                    signature=signature,
                ),
                atom_kind=atom_kind,
                observed_host_ids=observed_host_ids,
                source_artifact=artifact,
                declaring_symbol=_symbol(assembly, type_info),
                member=_member(
                    name=name,
                    signature=signature,
                    return_type=return_type,
                    parameters=parameters,
                    is_static=is_static,
                ),
                source_locator={
                    "assembly": assembly["name"],
                    "type": full_name,
                    "member": name,
                    "atom_kind": atom_kind,
                },
                surface_metadata=_common_metadata(assembly, type_info),
            )
        )
    return atoms


def _event_atoms(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    assembly: dict[str, Any],
    type_info: dict[str, Any],
    event_info: dict[str, Any],
) -> list[dict[str, Any]]:
    full_name = type_info["full_name"]
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
        metadata = _common_metadata(assembly, type_info)
        metadata["event_handler_type"] = handler_type
        atoms.append(
            _atom(
                inventory_id=inventory_id,
                canonical_key=canonical_dotnet_key(
                    assembly_name=assembly["name"],
                    declaring=full_name,
                    atom_kind=atom_kind,
                    signature=signature,
                ),
                atom_kind=atom_kind,
                observed_host_ids=observed_host_ids,
                source_artifact=artifact,
                declaring_symbol=_symbol(assembly, type_info),
                member=_member(
                    name=name,
                    signature=signature,
                    return_type="System.Void",
                    parameters=[handler_parameter],
                    is_static=is_static,
                ),
                source_locator={
                    "assembly": assembly["name"],
                    "type": full_name,
                    "member": name,
                    "atom_kind": atom_kind,
                },
                surface_metadata=metadata,
            )
        )
    return atoms


def _field_atoms(
    *,
    inventory_id: str,
    observed_host_ids: list[str],
    artifact: dict[str, Any],
    assembly: dict[str, Any],
    type_info: dict[str, Any],
    field: dict[str, Any],
) -> list[dict[str, Any]]:
    if type_info.get("is_enum"):
        return []
    if field.get("is_special_name"):
        return []
    full_name = type_info["full_name"]
    name = field.get("name")
    _require(isinstance(name, str) and name, f"{full_name}: field name must be non-empty")
    field_type = field.get("type")
    _require(isinstance(field_type, str) and field_type, f"{full_name}.{name}: field type required")
    is_static = bool(field.get("is_static", False))
    atoms: list[dict[str, Any]] = []
    getters = [
        (
            "field_read",
            f"get_{name}",
            field_type,
            [],
        )
    ]
    if not field.get("is_init_only") and not field.get("is_literal"):
        getters.append(
            (
                "field_write",
                f"set_{name}",
                "System.Void",
                [
                    {
                        "position": 0,
                        "name": "value",
                        "type": field_type,
                        "direction": "in",
                        "optional": False,
                    }
                ],
            )
        )
    for atom_kind, accessor_name, return_type, parameters in getters:
        signature = format_signature(return_type, accessor_name, parameters)
        atoms.append(
            _atom(
                inventory_id=inventory_id,
                canonical_key=canonical_dotnet_key(
                    assembly_name=assembly["name"],
                    declaring=full_name,
                    atom_kind=atom_kind,
                    signature=signature,
                ),
                atom_kind=atom_kind,
                observed_host_ids=observed_host_ids,
                source_artifact=artifact,
                declaring_symbol=_symbol(assembly, type_info),
                member=_member(
                    name=name,
                    signature=signature,
                    return_type=return_type,
                    parameters=parameters,
                    is_static=is_static,
                ),
                source_locator={
                    "assembly": assembly["name"],
                    "type": full_name,
                    "member": name,
                    "atom_kind": atom_kind,
                },
                surface_metadata=_common_metadata(assembly, type_info),
            )
        )
    return atoms


def atomize_scan(scan: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    mapping = _require_mapping(scan, "scan")
    inventory_id = mapping.get("inventory_id") or DEFAULT_INVENTORY_ID
    _require(isinstance(inventory_id, str) and inventory_id, "inventory_id must be non-empty")
    observed_host_id = mapping.get("observed_host_id") or DEFAULT_OBSERVED_HOST_ID
    _require(isinstance(observed_host_id, str) and observed_host_id, "observed_host_id must be non-empty")
    observed_host_ids = [observed_host_id]

    assemblies = _require_list(mapping.get("assemblies") or [], "assemblies")
    conversion_errors = _require_list(mapping.get("conversion_errors") or [], "conversion_errors")
    top_level_reflection_errors = mapping.get("reflection_errors")
    if top_level_reflection_errors is None:
        reflection_errors: list[Any] = []
        for raw_assembly in assemblies:
            if isinstance(raw_assembly, dict):
                reflection_errors.extend(raw_assembly.get("reflection_errors") or [])
    else:
        reflection_errors = _require_list(top_level_reflection_errors, "reflection_errors")

    artifacts: list[dict[str, Any]] = []
    artifacts_by_id: dict[str, dict[str, Any]] = {}
    atoms: list[dict[str, Any]] = []
    seen_keys: dict[str, str] = {}

    public_types = 0
    declared_methods = 0
    declared_properties = 0
    declared_events = 0
    declared_constructors = 0
    declared_fields = 0
    enum_literals = 0

    for assembly_index, raw_assembly in enumerate(assemblies):
        assembly = _require_mapping(raw_assembly, f"assemblies[{assembly_index}]")
        artifact = _assembly_artifact(assembly)
        if artifact["artifact_id"] not in artifacts_by_id:
            artifacts.append(artifact)
            artifacts_by_id[artifact["artifact_id"]] = artifact
        dumped_types = _require_list(assembly.get("types") or [], f"{assembly.get('name')}.types")
        dumped_methods = 0
        dumped_properties = 0
        dumped_events = 0
        dumped_constructors = 0
        dumped_fields = 0
        dumped_enum_literals = 0
        for type_index, raw_type in enumerate(dumped_types):
            type_info = _require_mapping(raw_type, f"{assembly.get('name')}.types[{type_index}]")
            _require(isinstance(type_info.get("full_name"), str) and type_info["full_name"], "type full_name")
            methods = _require_list(type_info.get("methods") or [], f"{type_info['full_name']}.methods")
            properties = _require_list(type_info.get("properties") or [], f"{type_info['full_name']}.properties")
            events = _require_list(type_info.get("events") or [], f"{type_info['full_name']}.events")
            constructors = _require_list(
                type_info.get("constructors") or [],
                f"{type_info['full_name']}.constructors",
            )
            fields = _require_list(type_info.get("fields") or [], f"{type_info['full_name']}.fields")
            dumped_methods += len(methods)
            dumped_properties += len(properties)
            dumped_events += len(events)
            dumped_constructors += len(constructors)
            dumped_fields += len(fields)
            if type_info.get("is_enum"):
                dumped_enum_literals += sum(
                    1
                    for field in fields
                    if isinstance(field, dict) and field.get("is_literal") and not field.get("is_special_name")
                )
            for method in methods:
                atoms.extend(
                    _method_atoms(
                        inventory_id=inventory_id,
                        observed_host_ids=observed_host_ids,
                        artifact=artifact,
                        assembly=assembly,
                        type_info=type_info,
                        method=_require_mapping(method, f"{type_info['full_name']}.method"),
                        atom_kind="method",
                    )
                )
            for constructor in constructors:
                atoms.extend(
                    _method_atoms(
                        inventory_id=inventory_id,
                        observed_host_ids=observed_host_ids,
                        artifact=artifact,
                        assembly=assembly,
                        type_info=type_info,
                        method=_require_mapping(constructor, f"{type_info['full_name']}.constructor"),
                        atom_kind="constructor",
                    )
                )
            for property_info in properties:
                atoms.extend(
                    _property_atoms(
                        inventory_id=inventory_id,
                        observed_host_ids=observed_host_ids,
                        artifact=artifact,
                        assembly=assembly,
                        type_info=type_info,
                        property_info=_require_mapping(property_info, f"{type_info['full_name']}.property"),
                    )
                )
            for event_info in events:
                atoms.extend(
                    _event_atoms(
                        inventory_id=inventory_id,
                        observed_host_ids=observed_host_ids,
                        artifact=artifact,
                        assembly=assembly,
                        type_info=type_info,
                        event_info=_require_mapping(event_info, f"{type_info['full_name']}.event"),
                    )
                )
            for field in fields:
                atoms.extend(
                    _field_atoms(
                        inventory_id=inventory_id,
                        observed_host_ids=observed_host_ids,
                        artifact=artifact,
                        assembly=assembly,
                        type_info=type_info,
                        field=_require_mapping(field, f"{type_info['full_name']}.field"),
                    )
                )
        label = assembly.get("name") or f"assemblies[{assembly_index}]"
        if "public_type_count" in assembly:
            _require(
                int(assembly["public_type_count"]) == len(dumped_types),
                f"{label}: public_type_count {assembly['public_type_count']} != dumped {len(dumped_types)}",
            )
            public_types += int(assembly["public_type_count"])
        else:
            public_types += len(dumped_types)
        count_specs = (
            ("declared_method_overload_count", dumped_methods, "declared_method_overloads"),
            ("declared_property_count", dumped_properties, "declared_properties"),
            ("declared_event_count", dumped_events, "declared_events"),
            ("declared_constructor_count", dumped_constructors, "declared_constructors"),
            ("declared_field_count", dumped_fields, "declared_fields"),
            ("enum_literal_count", dumped_enum_literals, "enum_literals"),
        )
        buckets = {
            "declared_method_overloads": 0,
            "declared_properties": 0,
            "declared_events": 0,
            "declared_constructors": 0,
            "declared_fields": 0,
            "enum_literals": 0,
        }
        for field_name, dumped, bucket in count_specs:
            if field_name in assembly:
                _require(
                    int(assembly[field_name]) == dumped,
                    f"{label}: {field_name} {assembly[field_name]} != dumped {dumped}",
                )
                buckets[bucket] += int(assembly[field_name])
            else:
                buckets[bucket] += dumped
        declared_methods += buckets["declared_method_overloads"]
        declared_properties += buckets["declared_properties"]
        declared_events += buckets["declared_events"]
        declared_constructors += buckets["declared_constructors"]
        declared_fields += buckets["declared_fields"]
        enum_literals += buckets["enum_literals"]

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
        "public_types": public_types,
        "declared_method_overloads": declared_methods,
        "declared_properties": declared_properties,
        "declared_events": declared_events,
        "declared_constructors": declared_constructors,
        "declared_fields": declared_fields,
        "enum_literals": enum_literals,
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
        raise DotNetAtomizationError(str(error)) from error
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
    (output_dir / "inventory-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit .NET CapabilityAtom JSONL from an assembly scan document.")
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
    except (OSError, json.JSONDecodeError, DotNetAtomizationError) as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
