from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import shutil
import tempfile
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if __package__:
    from .catalog_queue import (
        CatalogSnapshot,
        CatalogValidationError,
        _iter_jsonl,
        _read_json,
        _validate_atom,
        _validate_manifest,
        load_catalog,
    )
else:
    from catalog_queue import (
        CatalogSnapshot,
        CatalogValidationError,
        _iter_jsonl,
        _read_json,
        _validate_atom,
        _validate_manifest,
        load_catalog,
    )

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_STAGING_ROOT = REPO_ROOT / "data" / "datasets" / "staging" / "cad-capabilities"
DEFAULT_OUTPUT_DIRECTORY = (
    REPO_ROOT / "data" / "datasets" / "curated" / "cad-capabilities" / "v1"
)
DATASET_ID = "cad.capabilities.curated.v1"
INVENTORY_DIRECTORY_NAMES = (
    "thcad-v24.com",
    "thcad-v24.dotnet",
    "thcad-v24.lisp",
    "thcad-v24.command",
    "thcad-v24.native",
)


@dataclass(frozen=True)
class CuratedDatasetSpec:
    dataset_id: str
    output_directory: Path
    inventory_directory_names: tuple[str, ...]


V1_SPEC = CuratedDatasetSpec(
    dataset_id=DATASET_ID,
    output_directory=DEFAULT_OUTPUT_DIRECTORY,
    inventory_directory_names=INVENTORY_DIRECTORY_NAMES,
)
V2_SPEC = CuratedDatasetSpec(
    dataset_id="cad.capabilities.curated.v2",
    output_directory=(
        REPO_ROOT / "data" / "datasets" / "curated" / "cad-capabilities" / "v2"
    ),
    inventory_directory_names=(
        *INVENTORY_DIRECTORY_NAMES,
        "autocad-2024.com",
        "autocad-2024.dotnet",
        "autocad-2024.lisp",
        "autocad-2024.command",
        "autocad-2024.native",
    ),
)
DATASET_SPECS = {"v1": V1_SPEC, "v2": V2_SPEC}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> int:
    rows = 0
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for record in records:
            stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            stream.write("\n")
            rows += 1
    return rows


def _enrichment_inputs(inventory_directory: Path) -> list[str]:
    enrichment_directory = inventory_directory / "enrichments"
    return [str(enrichment_directory)] if enrichment_directory.is_dir() else []


def _has_enrichment_records(inventory_directory: Path) -> bool:
    enrichment_directory = inventory_directory / "enrichments"
    return enrichment_directory.is_dir() and any(enrichment_directory.rglob("*.jsonl"))


def load_inventory(inventory_directory: Path) -> CatalogSnapshot:
    return load_catalog(
        inventory_directory / "inventory-manifest.json",
        inventory_directory / "capability-atoms.jsonl",
        _enrichment_inputs(inventory_directory),
    )


def _inventory_record(
    manifest: dict[str, Any],
    progress: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": manifest["schema_version"],
        "inventory_id": manifest["inventory_id"],
        "surface": manifest["surface"],
        "observed_host_id": manifest["observed_host_id"],
        "captured_at": manifest["captured_at"],
        "extractor": manifest["extractor"],
        "source_artifacts": manifest["source_artifacts"],
        "atoms_sha256": manifest["atoms_sha256"],
        "counts": manifest["counts"],
        "classification_counts": {
            "classified": progress["classified"],
            "deferred": progress["deferred"],
            "failed": progress["failed"],
            "pending": progress["pending"],
        },
    }


def inventory_record(snapshot: CatalogSnapshot) -> dict[str, Any]:
    return _inventory_record(snapshot.manifest, snapshot.progress())


def curated_atom(
    atom: dict[str, Any],
    enrichment: dict[str, Any] | None,
) -> dict[str, Any]:
    if enrichment is None:
        classification = {
            "classification_status": "pending",
            "operation_kinds": [],
            "domain_tags": [],
            "summary": None,
            "classification_confidence": None,
            "semantic_candidates": [],
            "evidence": [],
            "processor": None,
            "processed_at": None,
            "notes": None,
        }
    else:
        classification = {
            "classification_status": enrichment["status"],
            "operation_kinds": enrichment["operation_kinds"],
            "domain_tags": enrichment["domain_tags"],
            "summary": enrichment["summary"],
            "classification_confidence": enrichment["classification_confidence"],
            "semantic_candidates": enrichment["semantic_candidates"],
            "evidence": enrichment["evidence"],
            "processor": enrichment["processor"],
            "processed_at": enrichment["processed_at"],
            "notes": enrichment["notes"],
        }
    return {**atom, **classification}


def _replace_output_directory(
    temporary_directory: Path,
    output_directory: Path,
    dataset_id: str = DATASET_ID,
) -> None:
    if output_directory.exists():
        manifest_path = output_directory / "manifest.json"
        try:
            existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(
                f"refusing to replace unrecognized output directory: {output_directory}"
            ) from error
        if existing_manifest.get("dataset_id") != dataset_id:
            raise RuntimeError(
                f"refusing to replace output for another dataset: {output_directory}"
            )
        shutil.rmtree(output_directory)
    temporary_directory.replace(output_directory)


def _load_streaming_manifest(inventory_directory: Path) -> dict[str, Any]:
    manifest_path = inventory_directory / "inventory-manifest.json"
    atoms_path = inventory_directory / "capability-atoms.jsonl"
    manifest = _read_json(manifest_path)
    _validate_manifest(manifest, manifest_path)
    if atoms_path.name != manifest["atoms_file"]:
        raise CatalogValidationError(
            f"{atoms_path}: filename does not match inventory manifest"
        )
    actual_sha256 = _sha256_file(atoms_path)
    if actual_sha256 != manifest["atoms_sha256"]:
        raise CatalogValidationError(f"{atoms_path}: SHA-256 does not match manifest")
    return manifest


def _iter_validated_atoms(
    inventory_directory: Path,
    manifest: dict[str, Any],
) -> Iterator[dict[str, Any]]:
    atoms_path = inventory_directory / "capability-atoms.jsonl"
    artifacts_by_id = {
        artifact["artifact_id"]: artifact for artifact in manifest["source_artifacts"]
    }
    previous_atom_id: str | None = None
    rows = 0
    by_kind: Counter[str] = Counter()
    for line_number, atom in _iter_jsonl(atoms_path):
        location = f"{atoms_path}:{line_number}"
        _validate_atom(
            atom,
            location=location,
            manifest=manifest,
            artifacts_by_id=artifacts_by_id,
        )
        atom_id = atom["atom_id"]
        if previous_atom_id is not None and atom_id <= previous_atom_id:
            qualifier = "duplicate" if atom_id == previous_atom_id else "unsorted"
            raise CatalogValidationError(f"{location}: {qualifier} atom_id {atom_id}")
        previous_atom_id = atom_id
        rows += 1
        by_kind[atom["atom_kind"]] += 1
        yield atom

    if rows != manifest["counts"]["atoms"]:
        raise CatalogValidationError(f"{atoms_path}: atom count does not match manifest")
    if dict(sorted(by_kind.items())) != dict(
        sorted(manifest["counts"]["by_kind"].items())
    ):
        raise CatalogValidationError(f"{atoms_path}: counts.by_kind does not match atoms")


def _record_atom_counts(
    atom: dict[str, Any],
    *,
    by_surface: Counter[str],
    by_status: Counter[str],
    operation_assignments: Counter[str],
) -> None:
    by_surface[atom["surface"]] += 1
    by_status[atom["classification_status"]] += 1
    operation_assignments.update(atom["operation_kinds"])


def _write_inventory_chunk(
    inventory_directory: Path,
    chunk_path: Path,
    *,
    by_surface: Counter[str],
    by_status: Counter[str],
    operation_assignments: Counter[str],
) -> tuple[dict[str, Any], int]:
    if _has_enrichment_records(inventory_directory):
        snapshot = load_inventory(inventory_directory)
        progress = snapshot.progress()
        if snapshot.manifest["surface"] != "native" and progress["pending"] != 0:
            raise ValueError(f"inventory is incomplete: {snapshot.manifest['inventory_id']}")
        inventory = inventory_record(snapshot)
        records: Iterable[dict[str, Any]] = (
            curated_atom(atom, snapshot.enrichments_by_id.get(atom["atom_id"]))
            for atom in snapshot.atoms
        )
    else:
        manifest = _load_streaming_manifest(inventory_directory)
        if manifest["surface"] != "native":
            raise ValueError(f"inventory is incomplete: {manifest['inventory_id']}")
        total = manifest["counts"]["atoms"]
        inventory = _inventory_record(
            manifest,
            {
                "classified": 0,
                "deferred": 0,
                "failed": 0,
                "pending": total,
            },
        )
        records = (
            curated_atom(atom, None)
            for atom in _iter_validated_atoms(inventory_directory, manifest)
        )

    rows = 0
    with chunk_path.open("w", encoding="utf-8", newline="\n") as stream:
        for record in records:
            _record_atom_counts(
                record,
                by_surface=by_surface,
                by_status=by_status,
                operation_assignments=operation_assignments,
            )
            stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            stream.write("\n")
            rows += 1
    return inventory, rows


def _iter_chunk(path: Path) -> Iterator[dict[str, Any]]:
    for _, record in _iter_jsonl(path):
        yield record


def _merge_atom_chunks(chunk_paths: list[Path], output_path: Path) -> int:
    iterators = [_iter_chunk(path) for path in chunk_paths]
    merged = heapq.merge(*iterators, key=lambda record: record["atom_id"])
    previous_atom_id: str | None = None
    rows = 0
    with output_path.open("w", encoding="utf-8", newline="\n") as stream:
        for record in merged:
            atom_id = record["atom_id"]
            if atom_id == previous_atom_id:
                raise ValueError(f"duplicate atom_id across inventories: {atom_id}")
            previous_atom_id = atom_id
            stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            stream.write("\n")
            rows += 1
    return rows


def build_dataset(
    staging_root: Path,
    output_directory: Path,
    *,
    dataset_id: str = DATASET_ID,
    inventory_directory_names: tuple[str, ...] = INVENTORY_DIRECTORY_NAMES,
) -> dict[str, Any]:
    output_directory.parent.mkdir(parents=True, exist_ok=True)
    temporary_directory = Path(
        tempfile.mkdtemp(
            prefix=f"{dataset_id.replace('.', '-')}-",
            dir=output_directory.parent,
        )
    )
    chunks_directory = temporary_directory / ".chunks"
    chunks_directory.mkdir()

    inventories: list[dict[str, Any]] = []
    chunk_paths: list[Path] = []
    by_surface: Counter[str] = Counter()
    by_status: Counter[str] = Counter()
    operation_assignments: Counter[str] = Counter()
    atom_count = 0

    try:
        for position, directory_name in enumerate(inventory_directory_names):
            inventory_directory = staging_root / directory_name
            if not inventory_directory.is_dir():
                raise FileNotFoundError(
                    f"missing inventory directory: {inventory_directory}"
                )
            chunk_path = chunks_directory / f"{position:02d}.jsonl"
            inventory, rows = _write_inventory_chunk(
                inventory_directory,
                chunk_path,
                by_surface=by_surface,
                by_status=by_status,
                operation_assignments=operation_assignments,
            )
            inventories.append(inventory)
            chunk_paths.append(chunk_path)
            atom_count += rows

        inventories.sort(key=lambda item: item["inventory_id"])
        inventory_path = temporary_directory / "capability-inventories.jsonl"
        atoms_path = temporary_directory / "capability-atoms.jsonl"
        inventory_rows = _write_jsonl(inventory_path, inventories)
        merged_rows = _merge_atom_chunks(chunk_paths, atoms_path)
        if merged_rows != atom_count:
            raise RuntimeError(
                f"merged atom count mismatch: expected {atom_count}, got {merged_rows}"
            )
        shutil.rmtree(chunks_directory)

        try:
            source_root = staging_root.relative_to(REPO_ROOT).as_posix()
        except ValueError:
            source_root = str(staging_root)

        manifest = {
            "schema_version": "1.0",
            "dataset_id": dataset_id,
            "build_status": "valid",
            "source": {
                "kind": "cad_capability_staging",
                "root": source_root,
                "inventory_ids": [item["inventory_id"] for item in inventories],
            },
            "files": {
                inventory_path.name: {
                    "rows": inventory_rows,
                    "sha256": _sha256_file(inventory_path),
                },
                atoms_path.name: {
                    "rows": merged_rows,
                    "sha256": _sha256_file(atoms_path),
                },
            },
            "counts": {
                "inventories": inventory_rows,
                "atoms": merged_rows,
                "by_surface": dict(sorted(by_surface.items())),
                "by_classification_status": dict(sorted(by_status.items())),
                "operation_assignments": dict(sorted(operation_assignments.items())),
            },
        }
        (temporary_directory / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )

        _replace_output_directory(temporary_directory, output_directory, dataset_id)
    except Exception:
        shutil.rmtree(temporary_directory, ignore_errors=True)
        raise
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staging-root", type=Path, default=DEFAULT_STAGING_ROOT)
    parser.add_argument("--dataset-version", choices=sorted(DATASET_SPECS), default="v1")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    spec = DATASET_SPECS[args.dataset_version]
    output_directory = args.output_dir or spec.output_directory
    result = build_dataset(
        args.staging_root.resolve(),
        output_directory.resolve(),
        dataset_id=spec.dataset_id,
        inventory_directory_names=spec.inventory_directory_names,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
