from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from data.pipelines.cad_capabilities.build_curated import (
    V2_SPEC,
    _replace_output_directory,
    build_dataset,
    curated_atom,
)
from data.pipelines.cad_capabilities.catalog_queue import canonical_atom_id
from data.pipelines.cad_capabilities.load_postgres import (
    ATOM_COLUMNS,
    INVENTORY_COLUMNS,
    atom_copy_record,
    inventory_copy_record,
)


def atom() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "inventory_id": "thcad-v24.dotnet",
        "atom_id": "cap:dotnet:000000000000000000000001",
        "canonical_key": "dotnet|Example.Type|Read()",
        "surface": "dotnet",
        "atom_kind": "method",
        "observed_host_ids": ["thcad-v24"],
        "source_artifact": {
            "artifact_id": "assembly:test",
            "kind": "assembly",
            "name": "test",
            "version": "1.0",
            "sha256": "a" * 64,
        },
        "declaring_symbol": {
            "symbol_id": "type:Example.Type",
            "full_name": "Example.Type",
            "kind": "class",
        },
        "member": {
            "name": "Read",
            "signature": "System.String Read()",
            "return_type": "System.String",
            "parameters": [],
            "is_static": False,
        },
        "provenance": {
            "extractor": "test",
            "extractor_version": "1.0",
            "source_locator": {"token": 1},
        },
        "surface_metadata": {},
    }


def write_native_inventory(
    staging_root: Path,
    *,
    inventory_id: str,
    host_id: str,
    canonical_key: str,
) -> dict[str, object]:
    inventory_directory = staging_root / inventory_id
    inventory_directory.mkdir(parents=True)
    artifact = {
        "artifact_id": f"module:{host_id}",
        "kind": "native_module",
        "name": f"{host_id}.dll",
        "version": "1.0",
        "sha256": "a" * 64,
    }
    record = {
        "schema_version": "1.0",
        "inventory_id": inventory_id,
        "atom_id": canonical_atom_id("native", canonical_key),
        "canonical_key": canonical_key,
        "surface": "native",
        "atom_kind": "native_export",
        "observed_host_ids": [host_id],
        "source_artifact": artifact,
        "declaring_symbol": None,
        "member": {
            "name": canonical_key,
            "signature": canonical_key,
            "return_type": None,
            "parameters": [],
            "is_static": True,
        },
        "provenance": {
            "extractor": "test",
            "extractor_version": "1.0",
            "source_locator": {"ordinal": 1},
        },
        "surface_metadata": {},
    }
    atoms_text = json.dumps(
        record, ensure_ascii=False, separators=(",", ":")
    ) + "\n"
    atoms_path = inventory_directory / "capability-atoms.jsonl"
    atoms_path.write_text(atoms_text, encoding="utf-8", newline="\n")
    manifest = {
        "schema_version": "1.0",
        "inventory_id": inventory_id,
        "surface": "native",
        "observed_host_id": host_id,
        "captured_at": "2026-08-29T00:00:00Z",
        "extractor": {"name": "test", "version": "1.0"},
        "source_artifacts": [artifact],
        "atoms_file": "capability-atoms.jsonl",
        "atoms_sha256": hashlib.sha256(atoms_text.encode("utf-8")).hexdigest(),
        "counts": {
            "atoms": 1,
            "by_kind": {"native_export": 1},
            "source": {"exports": 1},
        },
    }
    (inventory_directory / "inventory-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8", newline="\n"
    )
    return record


class CuratedDatasetTests(unittest.TestCase):
    def test_missing_enrichment_is_explicit_pending(self) -> None:
        record = curated_atom(atom(), None)
        self.assertEqual(record["classification_status"], "pending")
        self.assertEqual(record["operation_kinds"], [])
        self.assertIsNone(record["classification_confidence"])

    def test_enrichment_becomes_atom_properties(self) -> None:
        enrichment = {
            "status": "classified",
            "operation_kinds": ["read", "compute"],
            "domain_tags": ["entity"],
            "summary": "Reads a value.",
            "classification_confidence": 0.8,
            "semantic_candidates": [],
            "evidence": [{"kind": "signature", "ref": "Read", "claim": "read"}],
            "processor": {"kind": "rule", "name": "test", "run_id": "run-1"},
            "processed_at": "2026-08-28T00:00:00Z",
            "notes": None,
        }
        record = curated_atom(atom(), enrichment)
        self.assertEqual(record["classification_status"], "classified")
        self.assertEqual(record["operation_kinds"], ["read", "compute"])
        self.assertEqual(record["summary"], "Reads a value.")

    def test_copy_records_preserve_open_attributes_and_json(self) -> None:
        record = curated_atom(atom(), None)
        copied = atom_copy_record("cad.capabilities.curated.v1", record)
        self.assertEqual(len(copied), len(ATOM_COLUMNS))
        values = dict(zip(ATOM_COLUMNS, copied, strict=True))
        self.assertEqual(values["surface"], "dotnet")
        self.assertEqual(values["observed_host_ids"], ["thcad-v24"])
        self.assertEqual(json.loads(values["member"])["name"], "Read")

    def test_inventory_copy_record_matches_column_contract(self) -> None:
        inventory = {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.dotnet",
            "surface": "dotnet",
            "observed_host_id": "thcad-v24",
            "captured_at": "2026-08-28T00:00:00Z",
            "extractor": {"name": "test", "version": "1.0"},
            "source_artifacts": [],
            "atoms_sha256": "a" * 64,
            "counts": {"atoms": 1},
            "classification_counts": {
                "classified": 0,
                "deferred": 0,
                "failed": 0,
                "pending": 1,
            },
        }
        copied = inventory_copy_record("cad.capabilities.curated.v1", inventory)
        self.assertEqual(len(copied), len(INVENTORY_COLUMNS))

    def test_output_replacement_refuses_unrecognized_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            existing = root / "existing"
            replacement = root / "replacement"
            existing.mkdir()
            replacement.mkdir()
            (existing / "keep.txt").write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "unrecognized output directory"):
                _replace_output_directory(replacement, existing)
            self.assertTrue((existing / "keep.txt").is_file())

    def test_v2_spec_keeps_ten_host_scoped_inventories(self) -> None:
        self.assertEqual(V2_SPEC.dataset_id, "cad.capabilities.curated.v2")
        self.assertEqual(len(V2_SPEC.inventory_directory_names), 10)
        self.assertEqual(
            {name.split(".", 1)[0] for name in V2_SPEC.inventory_directory_names},
            {"thcad-v24", "autocad-2024"},
        )

    def test_combined_dataset_preserves_independent_host_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            staging = root / "staging"
            first = write_native_inventory(
                staging,
                inventory_id="thcad-v24.native",
                host_id="thcad-v24",
                canonical_key="native|thcad.dll|ThcadExport",
            )
            second = write_native_inventory(
                staging,
                inventory_id="autocad-2024.native",
                host_id="autocad-2024",
                canonical_key="native|acad.dll|AcadExport",
            )
            output = root / "v2"
            manifest = build_dataset(
                staging,
                output,
                dataset_id="test.cad.capabilities.curated.v2",
                inventory_directory_names=(
                    "thcad-v24.native",
                    "autocad-2024.native",
                ),
            )

            self.assertEqual(manifest["counts"]["atoms"], 2)
            records = [
                json.loads(line)
                for line in (output / "capability-atoms.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            self.assertEqual(
                [record["atom_id"] for record in records],
                sorted([first["atom_id"], second["atom_id"]]),
            )
            self.assertEqual(
                {tuple(record["observed_host_ids"]) for record in records},
                {("thcad-v24",), ("autocad-2024",)},
            )

    def test_combined_dataset_rejects_cross_host_atom_id_collision(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            staging = root / "staging"
            canonical_key = "native|shared.dll|SameExport"
            write_native_inventory(
                staging,
                inventory_id="thcad-v24.native",
                host_id="thcad-v24",
                canonical_key=canonical_key,
            )
            write_native_inventory(
                staging,
                inventory_id="autocad-2024.native",
                host_id="autocad-2024",
                canonical_key=canonical_key,
            )
            with self.assertRaisesRegex(ValueError, "duplicate atom_id across inventories"):
                build_dataset(
                    staging,
                    root / "v2",
                    dataset_id="test.cad.capabilities.curated.v2",
                    inventory_directory_names=(
                        "thcad-v24.native",
                        "autocad-2024.native",
                    ),
                )


if __name__ == "__main__":
    unittest.main()
