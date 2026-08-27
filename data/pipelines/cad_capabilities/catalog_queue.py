from __future__ import annotations

import argparse
import glob
import hashlib
import json
import sys
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SURFACES = {"com", "dotnet", "lisp", "command", "native"}
ATOM_KINDS = {
    "method",
    "property_get",
    "property_set",
    "constructor",
    "event_subscribe",
    "event_unsubscribe",
    "field_read",
    "field_write",
    "lisp_function",
    "command",
    "macro",
    "progid_activation",
    "native_export",
}
ENRICHMENT_STATUSES = {"classified", "deferred", "failed"}
OPERATION_KINDS = {
    "read",
    "compute",
    "create",
    "edit",
    "delete",
    "transform",
    "save",
    "import",
    "export",
    "select",
    "navigate",
    "display",
    "invoke",
    "event",
    "lifecycle",
    "unknown",
}
EVIDENCE_KINDS = {
    "member_name",
    "signature",
    "source_code",
    "documentation",
    "runtime_probe",
    "human_review",
}

MANIFEST_KEYS = {
    "schema_version",
    "inventory_id",
    "surface",
    "observed_host_id",
    "captured_at",
    "extractor",
    "source_artifacts",
    "atoms_file",
    "atoms_sha256",
    "counts",
}
ATOM_KEYS = {
    "schema_version",
    "inventory_id",
    "atom_id",
    "canonical_key",
    "surface",
    "atom_kind",
    "observed_host_ids",
    "source_artifact",
    "declaring_symbol",
    "member",
    "provenance",
    "surface_metadata",
}
ENRICHMENT_KEYS = {
    "schema_version",
    "inventory_id",
    "atom_id",
    "status",
    "operation_kinds",
    "domain_tags",
    "summary",
    "classification_confidence",
    "semantic_candidates",
    "evidence",
    "processor",
    "processed_at",
    "notes",
}


class CatalogValidationError(ValueError):
    pass


@dataclass(frozen=True)
class CatalogSnapshot:
    manifest: dict[str, Any]
    atoms: list[dict[str, Any]]
    atoms_by_id: dict[str, dict[str, Any]]
    enrichments_by_id: dict[str, dict[str, Any]]
    enrichment_sources: dict[str, str]

    def progress(self) -> dict[str, Any]:
        status_counts = Counter(
            enrichment["status"] for enrichment in self.enrichments_by_id.values()
        )
        raw_total = len(self.atoms)
        classified = status_counts["classified"]
        deferred = status_counts["deferred"]
        failed = status_counts["failed"]
        processed = classified + deferred + failed
        pending = raw_total - processed
        return {
            "inventory_id": self.manifest["inventory_id"],
            "surface": self.manifest["surface"],
            "raw_total": raw_total,
            "classified": classified,
            "deferred": deferred,
            "failed": failed,
            "processed": processed,
            "pending": pending,
            "unaccounted": raw_total - processed - pending,
            "coverage_percent": round((processed / raw_total * 100) if raw_total else 100.0, 4),
        }


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CatalogValidationError(message)


def _require_exact_keys(record: dict[str, Any], keys: set[str], location: str) -> None:
    actual = set(record)
    missing = sorted(keys - actual)
    extra = sorted(actual - keys)
    _require(not missing, f"{location}: missing keys: {', '.join(missing)}")
    _require(not extra, f"{location}: unexpected keys: {', '.join(extra)}")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CatalogValidationError(f"{path}: cannot read JSON: {error}") from error
    _require(isinstance(value, dict), f"{path}: root must be an object")
    return value


def _iter_jsonl(path: Path) -> Iterable[tuple[int, dict[str, Any]]]:
    try:
        with path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, start=1):
                if not line.strip():
                    continue
                try:
                    value = json.loads(line)
                except json.JSONDecodeError as error:
                    raise CatalogValidationError(
                        f"{path}:{line_number}: invalid JSON: {error.msg}"
                    ) from error
                _require(
                    isinstance(value, dict),
                    f"{path}:{line_number}: record must be an object",
                )
                yield line_number, value
    except OSError as error:
        raise CatalogValidationError(f"{path}: cannot read JSONL: {error}") from error


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise CatalogValidationError(f"{path}: cannot hash file: {error}") from error
    return digest.hexdigest()


def canonical_atom_id(surface: str, canonical_key: str) -> str:
    digest = hashlib.sha256(canonical_key.encode("utf-8")).hexdigest()[:24]
    return f"cap:{surface}:{digest}"


def _validate_manifest(manifest: dict[str, Any], path: Path) -> None:
    location = str(path)
    _require_exact_keys(manifest, MANIFEST_KEYS, location)
    _require(manifest["schema_version"] == "1.0", f"{location}: unsupported schema_version")
    _require(manifest["surface"] in SURFACES, f"{location}: invalid surface")
    _require(isinstance(manifest["inventory_id"], str) and manifest["inventory_id"], f"{location}: invalid inventory_id")
    _require(isinstance(manifest["observed_host_id"], str) and manifest["observed_host_id"], f"{location}: invalid observed_host_id")
    _require(manifest["atoms_file"] == "capability-atoms.jsonl", f"{location}: atoms_file must be capability-atoms.jsonl")
    atoms_sha256 = manifest["atoms_sha256"]
    _require(
        isinstance(atoms_sha256, str)
        and len(atoms_sha256) == 64
        and all(character in "0123456789abcdef" for character in atoms_sha256),
        f"{location}: atoms_sha256 must be lowercase SHA-256",
    )
    _require(isinstance(manifest["source_artifacts"], list) and manifest["source_artifacts"], f"{location}: source_artifacts must be non-empty")
    artifact_ids: set[str] = set()
    for index, artifact in enumerate(manifest["source_artifacts"]):
        item_location = f"{location}:source_artifacts[{index}]"
        _require(isinstance(artifact, dict), f"{item_location}: must be an object")
        required = {"artifact_id", "kind", "name", "version", "sha256"}
        _require_exact_keys(artifact, required, item_location)
        artifact_id = artifact["artifact_id"]
        _require(isinstance(artifact_id, str) and artifact_id, f"{item_location}: invalid artifact_id")
        _require(artifact_id not in artifact_ids, f"{item_location}: duplicate artifact_id {artifact_id}")
        artifact_ids.add(artifact_id)
    counts = manifest["counts"]
    _require(isinstance(counts, dict), f"{location}: counts must be an object")
    _require_exact_keys(counts, {"atoms", "by_kind", "source"}, f"{location}:counts")
    _require(isinstance(counts["atoms"], int) and counts["atoms"] >= 0, f"{location}: counts.atoms must be non-negative")
    _require(isinstance(counts["by_kind"], dict), f"{location}: counts.by_kind must be an object")
    _require(isinstance(counts["source"], dict), f"{location}: counts.source must be an object")


def _validate_atom(
    atom: dict[str, Any],
    *,
    location: str,
    manifest: dict[str, Any],
    artifacts_by_id: dict[str, dict[str, Any]],
) -> None:
    _require_exact_keys(atom, ATOM_KEYS, location)
    _require(atom["schema_version"] == "1.0", f"{location}: unsupported schema_version")
    _require(atom["inventory_id"] == manifest["inventory_id"], f"{location}: inventory_id mismatch")
    surface = atom["surface"]
    _require(surface == manifest["surface"], f"{location}: surface mismatch")
    _require(atom["atom_kind"] in ATOM_KINDS, f"{location}: invalid atom_kind")
    canonical_key = atom["canonical_key"]
    _require(isinstance(canonical_key, str) and canonical_key, f"{location}: canonical_key must be non-empty")
    expected_id = canonical_atom_id(surface, canonical_key)
    _require(atom["atom_id"] == expected_id, f"{location}: atom_id must be {expected_id}")
    host_ids = atom["observed_host_ids"]
    _require(isinstance(host_ids, list) and host_ids, f"{location}: observed_host_ids must be non-empty")
    _require(len(host_ids) == len(set(host_ids)), f"{location}: duplicate observed_host_ids")
    _require(manifest["observed_host_id"] in host_ids, f"{location}: manifest host is not observed")

    source_artifact = atom["source_artifact"]
    _require(isinstance(source_artifact, dict), f"{location}: source_artifact must be an object")
    _require_exact_keys(
        source_artifact,
        {"artifact_id", "kind", "name", "version", "sha256"},
        f"{location}:source_artifact",
    )
    artifact_id = source_artifact["artifact_id"]
    _require(
        artifact_id in artifacts_by_id,
        f"{location}: unknown source artifact {artifact_id}",
    )
    _require(
        source_artifact == artifacts_by_id[artifact_id],
        f"{location}: source artifact metadata does not match manifest",
    )

    declaring_symbol = atom["declaring_symbol"]
    if declaring_symbol is not None:
        _require(isinstance(declaring_symbol, dict), f"{location}: declaring_symbol must be an object or null")
        _require_exact_keys(
            declaring_symbol,
            {"symbol_id", "full_name", "kind"},
            f"{location}:declaring_symbol",
        )

    member = atom["member"]
    _require(isinstance(member, dict), f"{location}: member must be an object")
    _require_exact_keys(
        member,
        {"name", "signature", "return_type", "parameters", "is_static"},
        f"{location}:member",
    )
    _require(isinstance(member["name"], str) and member["name"], f"{location}: member.name must be non-empty")
    _require(isinstance(member["signature"], str) and member["signature"], f"{location}: member.signature must be non-empty")
    _require(isinstance(member["parameters"], list), f"{location}: member.parameters must be a list")
    for position, parameter in enumerate(member["parameters"]):
        parameter_location = f"{location}:member.parameters[{position}]"
        _require(isinstance(parameter, dict), f"{parameter_location}: must be an object")
        allowed = {"position", "name", "type", "direction", "optional", "default_value"}
        required = {"position", "name", "type", "direction", "optional"}
        actual = set(parameter)
        _require(not (required - actual), f"{parameter_location}: missing required keys")
        _require(not (actual - allowed), f"{parameter_location}: unexpected keys")
        _require(parameter["position"] == position, f"{parameter_location}: position must be {position}")
        _require(parameter["direction"] in {"in", "out", "ref", "return"}, f"{parameter_location}: invalid direction")
    _require(isinstance(member["is_static"], bool), f"{location}: member.is_static must be boolean")

    provenance = atom["provenance"]
    _require(isinstance(provenance, dict), f"{location}: provenance must be an object")
    _require_exact_keys(
        provenance,
        {"extractor", "extractor_version", "source_locator"},
        f"{location}:provenance",
    )
    _require(isinstance(provenance["source_locator"], dict) and provenance["source_locator"], f"{location}: source_locator must be non-empty")
    _require(isinstance(atom["surface_metadata"], dict), f"{location}: surface_metadata must be an object")


def _validate_enrichment(
    enrichment: dict[str, Any],
    *,
    location: str,
    inventory_id: str,
    atom_ids: set[str],
) -> None:
    _require_exact_keys(enrichment, ENRICHMENT_KEYS, location)
    _require(enrichment["schema_version"] == "1.0", f"{location}: unsupported schema_version")
    _require(enrichment["inventory_id"] == inventory_id, f"{location}: inventory_id mismatch")
    atom_id = enrichment["atom_id"]
    _require(atom_id in atom_ids, f"{location}: enrichment references unknown atom_id {atom_id}")
    status = enrichment["status"]
    _require(status in ENRICHMENT_STATUSES, f"{location}: invalid status")
    operation_kinds = enrichment["operation_kinds"]
    _require(isinstance(operation_kinds, list), f"{location}: operation_kinds must be a list")
    _require(len(operation_kinds) == len(set(operation_kinds)), f"{location}: duplicate operation_kinds")
    invalid_operations = sorted(set(operation_kinds) - OPERATION_KINDS)
    _require(not invalid_operations, f"{location}: invalid operation_kinds: {', '.join(invalid_operations)}")
    domain_tags = enrichment["domain_tags"]
    _require(isinstance(domain_tags, list), f"{location}: domain_tags must be a list")
    _require(len(domain_tags) == len(set(domain_tags)), f"{location}: duplicate domain_tags")
    _require(
        all(isinstance(tag, str) and tag for tag in domain_tags),
        f"{location}: domain_tags must contain non-empty strings",
    )
    confidence = enrichment["classification_confidence"]
    _require(isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and 0 <= confidence <= 1, f"{location}: classification_confidence must be between 0 and 1")
    evidence = enrichment["evidence"]
    _require(isinstance(evidence, list), f"{location}: evidence must be a list")
    for index, item in enumerate(evidence):
        item_location = f"{location}:evidence[{index}]"
        _require(isinstance(item, dict), f"{item_location}: must be an object")
        _require_exact_keys(item, {"kind", "ref", "claim"}, item_location)
        _require(item["kind"] in EVIDENCE_KINDS, f"{item_location}: invalid evidence kind")
        _require(isinstance(item["ref"], str) and item["ref"], f"{item_location}: ref must be non-empty")
        _require(isinstance(item["claim"], str) and item["claim"], f"{item_location}: claim must be non-empty")
    semantic_candidates = enrichment["semantic_candidates"]
    _require(isinstance(semantic_candidates, list), f"{location}: semantic_candidates must be a list")
    for index, candidate in enumerate(semantic_candidates):
        item_location = f"{location}:semantic_candidates[{index}]"
        _require(isinstance(candidate, dict), f"{item_location}: must be an object")
        _require_exact_keys(
            candidate,
            {"semantic_capability_id", "label", "confidence", "status", "basis"},
            item_location,
        )
        _require(candidate["status"] in {"proposed", "verified", "rejected"}, f"{item_location}: invalid status")
        candidate_confidence = candidate["confidence"]
        _require(isinstance(candidate_confidence, (int, float)) and not isinstance(candidate_confidence, bool) and 0 <= candidate_confidence <= 1, f"{item_location}: confidence must be between 0 and 1")
        if candidate["status"] == "verified":
            evidence_kinds = {item["kind"] for item in evidence}
            _require(
                bool(evidence_kinds & {"runtime_probe", "human_review"}),
                f"{item_location}: verified requires runtime_probe or human_review evidence",
            )

    processor = enrichment["processor"]
    _require(isinstance(processor, dict), f"{location}: processor must be an object")
    _require_exact_keys(processor, {"kind", "name", "run_id"}, f"{location}:processor")
    _require(processor["kind"] in {"rule", "agent", "human"}, f"{location}: invalid processor.kind")
    if status == "classified":
        _require(operation_kinds, f"{location}: classified record needs operation_kinds")
        _require(isinstance(enrichment["summary"], str) and enrichment["summary"].strip(), f"{location}: classified record needs summary")
        _require(evidence, f"{location}: classified record needs evidence")
    else:
        _require(isinstance(enrichment["notes"], str) and enrichment["notes"].strip(), f"{location}: {status} record needs notes")


def _expand_enrichment_paths(values: list[str]) -> list[Path]:
    paths: set[Path] = set()
    for value in values:
        path = Path(value)
        if path.is_dir():
            paths.update(item.resolve() for item in path.rglob("*.jsonl") if item.is_file())
            continue
        matches = [Path(match) for match in glob.glob(value, recursive=True)]
        if matches:
            paths.update(item.resolve() for item in matches if item.is_file())
        elif path.exists() and path.is_file():
            paths.add(path.resolve())
        else:
            raise CatalogValidationError(f"Enrichment path does not exist: {value}")
    return sorted(paths, key=lambda item: str(item).casefold())


def load_catalog(
    manifest_path: Path,
    atoms_path: Path,
    enrichment_values: list[str],
) -> CatalogSnapshot:
    manifest_path = manifest_path.resolve()
    atoms_path = atoms_path.resolve()
    manifest = _read_json(manifest_path)
    _validate_manifest(manifest, manifest_path)
    _require(atoms_path.name == manifest["atoms_file"], f"{atoms_path}: filename does not match manifest")
    actual_sha256 = _sha256_file(atoms_path)
    _require(actual_sha256 == manifest["atoms_sha256"], f"{atoms_path}: SHA-256 does not match manifest")

    artifacts_by_id = {
        artifact["artifact_id"]: artifact for artifact in manifest["source_artifacts"]
    }
    atoms: list[dict[str, Any]] = []
    atoms_by_id: dict[str, dict[str, Any]] = {}
    for line_number, atom in _iter_jsonl(atoms_path):
        location = f"{atoms_path}:{line_number}"
        _validate_atom(
            atom,
            location=location,
            manifest=manifest,
            artifacts_by_id=artifacts_by_id,
        )
        atom_id = atom["atom_id"]
        _require(atom_id not in atoms_by_id, f"{location}: duplicate atom_id {atom_id}")
        atoms.append(atom)
        atoms_by_id[atom_id] = atom

    atom_ids_in_file = [atom["atom_id"] for atom in atoms]
    _require(
        atom_ids_in_file == sorted(atom_ids_in_file),
        f"{atoms_path}: atoms must be sorted by atom_id",
    )
    _require(len(atoms) == manifest["counts"]["atoms"], f"{atoms_path}: atom count does not match manifest")
    actual_by_kind = dict(sorted(Counter(atom["atom_kind"] for atom in atoms).items()))
    expected_by_kind = dict(sorted(manifest["counts"]["by_kind"].items()))
    _require(actual_by_kind == expected_by_kind, f"{atoms_path}: counts.by_kind does not match atoms")

    enrichments_by_id: dict[str, dict[str, Any]] = {}
    enrichment_sources: dict[str, str] = {}
    for enrichment_path in _expand_enrichment_paths(enrichment_values):
        for line_number, enrichment in _iter_jsonl(enrichment_path):
            location = f"{enrichment_path}:{line_number}"
            _validate_enrichment(
                enrichment,
                location=location,
                inventory_id=manifest["inventory_id"],
                atom_ids=set(atoms_by_id),
            )
            atom_id = enrichment["atom_id"]
            if atom_id in enrichments_by_id:
                first_location = enrichment_sources[atom_id]
                raise CatalogValidationError(
                    f"{location}: duplicate enrichment for {atom_id}; first seen at {first_location}"
                )
            enrichments_by_id[atom_id] = enrichment
            enrichment_sources[atom_id] = location

    return CatalogSnapshot(
        manifest=manifest,
        atoms=atoms,
        atoms_by_id=atoms_by_id,
        enrichments_by_id=enrichments_by_id,
        enrichment_sources=enrichment_sources,
    )


def _write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> int:
    materialized = list(records)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in materialized
    )
    path.write_text(text, encoding="utf-8", newline="\n")
    return len(materialized)


def _add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--atoms", required=True, type=Path)
    parser.add_argument(
        "--enrichments",
        nargs="*",
        default=[],
        help="Enrichment files, directories or glob patterns.",
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate and resume CAD capability atom enrichment batches."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate")
    _add_common_arguments(validate_parser)
    validate_parser.add_argument("--require-complete", action="store_true")

    next_parser = subparsers.add_parser("next-batch")
    _add_common_arguments(next_parser)
    next_parser.add_argument("--limit", type=int, default=100)
    next_parser.add_argument("--output", required=True, type=Path)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        snapshot = load_catalog(args.manifest, args.atoms, args.enrichments)
        progress = snapshot.progress()
        if args.command == "validate":
            if args.require_complete and progress["pending"] != 0:
                raise CatalogValidationError(
                    f"Inventory is incomplete: {progress['pending']} atoms remain pending"
                )
            print(json.dumps(progress, ensure_ascii=False, indent=2))
            return 0

        _require(args.limit > 0, "--limit must be greater than zero")
        pending = (
            atom
            for atom in sorted(snapshot.atoms, key=lambda item: item["atom_id"])
            if atom["atom_id"] not in snapshot.enrichments_by_id
        )
        selected: list[dict[str, Any]] = []
        for atom in pending:
            selected.append(atom)
            if len(selected) >= args.limit:
                break
        written = _write_jsonl(args.output.resolve(), selected)
        result = {
            **progress,
            "batch_output": str(args.output.resolve()),
            "batch_atoms": written,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except CatalogValidationError as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
