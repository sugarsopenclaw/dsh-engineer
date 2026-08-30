from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from data.pipelines.cad_capabilities.catalog_queue import (
    canonical_atom_id,
    load_catalog,
)
from data.pipelines.cad_capabilities.native_atoms import (
    EXTRACTOR_NAME,
    atomize_scan,
    canonical_native_key,
    emit_inventory,
    export_identity,
)


def sha(fill: str) -> str:
    return (fill * 64)[:64]


class NativeAtomizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scan = {
            "inventory_id": "thcad-v24.native.test",
            "observed_host_id": "thcad-v24",
            "sdk_headers": 0,
            "lib_files": 8,
            "coff_import_libs": 0,
            "modules": [
                {
                    "relative_path": "V24/THCadToolKit.arx",
                    "category": "mechanical_arx",
                    "bytes": 100,
                    "version": "5, 0, 0, 0",
                    "sha256": sha("a"),
                    "exporting_module_name": "THCadToolKit.arx",
                    "machine": "0x8664",
                    "pe32_plus": True,
                    "read_error": None,
                    "exports": [
                        {
                            "name": "acrxEntryPoint",
                            "ordinal": 1,
                            "rva": "0x00001000",
                            "forwarder": "",
                        },
                        {
                            "name": "",
                            "ordinal": 2,
                            "rva": "0x00002000",
                            "forwarder": "",
                        },
                        {
                            "name": "?AddBox@OdaBlockUtil@@YAJVOdDbObjectId@@@Z",
                            "ordinal": 3,
                            "rva": "0x00003000",
                            "forwarder": "",
                        },
                    ],
                },
                {
                    "relative_path": "THCAD/brx23.dll",
                    "category": "host_runtime",
                    "bytes": 200,
                    "version": "23.2.04",
                    "sha256": sha("b"),
                    "exporting_module_name": "brx23.dll",
                    "machine": "0x8664",
                    "pe32_plus": True,
                    "read_error": None,
                    "exports": [
                        {
                            "name": "odrxGetAPIVersion",
                            "ordinal": 10,
                            "rva": "0x00004000",
                            "forwarder": "",
                        }
                    ],
                },
                {
                    "relative_path": "V24/broken.arx",
                    "category": "mechanical_arx",
                    "bytes": 10,
                    "version": None,
                    "sha256": sha("c"),
                    "exporting_module_name": "",
                    "machine": None,
                    "pe32_plus": None,
                    "read_error": "Not an MZ executable",
                    "exports": [],
                },
            ],
        }

    def test_named_ordinal_decorated_unknown_signature_and_error_counts(self) -> None:
        atoms, source_counts, artifacts = atomize_scan(self.scan)
        self.assertEqual(source_counts["plugin_modules"], 2)
        self.assertEqual(source_counts["host_modules"], 1)
        self.assertEqual(source_counts["plugin_exports"], 3)
        self.assertEqual(source_counts["host_exports"], 1)
        self.assertEqual(source_counts["named_exports"], 3)
        self.assertEqual(source_counts["ordinal_only_exports"], 1)
        self.assertEqual(source_counts["decorated_exports"], 1)
        self.assertEqual(source_counts["standard_entries"], 2)
        self.assertEqual(source_counts["sdk_headers"], 0)
        self.assertEqual(source_counts["coff_import_libs"], 0)
        self.assertEqual(source_counts["pe_read_errors"], 1)
        self.assertIn("pe:V24/broken.arx", {item["artifact_id"] for item in artifacts})
        self.assertFalse(any(atom["source_artifact"]["artifact_id"] == "pe:V24/broken.arx" for atom in atoms))

        named = next(atom for atom in atoms if atom["member"]["name"] == "acrxEntryPoint")
        self.assertEqual(named["atom_kind"], "native_export")
        self.assertIsNone(named["member"]["return_type"])
        self.assertEqual(named["member"]["parameters"], [])
        self.assertEqual(named["source_artifact"]["version"], "5, 0, 0, 0")
        self.assertEqual(named["source_artifact"]["sha256"], sha("a"))
        self.assertEqual(named["surface_metadata"]["architecture"], "x64")
        self.assertEqual(named["surface_metadata"]["evidence"], "pe_export_symbol")
        self.assertTrue(named["surface_metadata"]["not_a_calling_contract"])
        self.assertTrue(named["surface_metadata"]["standard_entry"])
        self.assertFalse(named["surface_metadata"]["ordinal_only"])
        self.assertEqual(
            named["canonical_key"],
            canonical_native_key(
                relative_path="V24/THCadToolKit.arx",
                identity="acrxEntryPoint",
                ordinal=1,
            ),
        )
        self.assertEqual(named["atom_id"], canonical_atom_id("native", named["canonical_key"]))

        ordinal = next(atom for atom in atoms if atom["surface_metadata"].get("ordinal_only"))
        self.assertEqual(ordinal["member"]["name"], "ordinal:2")
        self.assertEqual(export_identity("", 2), "ordinal:2")
        self.assertEqual(ordinal["member"]["signature"], "PE EXPORT ordinal:2")
        self.assertEqual(ordinal["member"]["parameters"], [])

        decorated = next(
            atom
            for atom in atoms
            if atom["member"]["name"].startswith("?AddBox@")
        )
        self.assertTrue(decorated["surface_metadata"]["decorated"])
        self.assertEqual(decorated["member"]["parameters"], [])
        self.assertIsNone(decorated["member"]["return_type"])
        self.assertTrue(decorated["member"]["signature"].startswith("PE EXPORT "))
        self.assertEqual(decorated["member"]["signature"], f"PE EXPORT {decorated['member']['name']}")
        self.assertEqual(decorated["provenance"]["extractor"], EXTRACTOR_NAME)

        host = next(atom for atom in atoms if atom["source_artifact"]["name"] == "THCAD/brx23.dll")
        self.assertEqual(host["source_artifact"]["kind"], "pe_module")
        self.assertEqual(len(atoms), 4)

    def test_emit_inventory_is_stable_valid_and_path_free(self) -> None:
        with tempfile.TemporaryDirectory() as first_dir, tempfile.TemporaryDirectory() as second_dir:
            first = Path(first_dir)
            second = Path(second_dir)
            first_manifest = emit_inventory(self.scan, first, captured_at="2026-08-28T00:00:00Z")
            second_manifest = emit_inventory(self.scan, second, captured_at="2026-08-28T01:00:00Z")
            first_bytes = (first / "capability-atoms.jsonl").read_bytes()
            second_bytes = (second / "capability-atoms.jsonl").read_bytes()
            self.assertEqual(first_bytes, second_bytes)
            self.assertTrue(first_bytes.endswith(b"\n"))
            self.assertNotIn(b"\r", first_bytes)
            self.assertNotRegex(first_bytes.decode("utf-8"), r"(?i)[a-z]:\\")
            snapshot = load_catalog(
                first / "inventory-manifest.json",
                first / "capability-atoms.jsonl",
                [],
            )
            self.assertEqual(snapshot.progress()["raw_total"], 4)
            self.assertEqual(snapshot.progress()["pending"], 4)
            self.assertEqual(first_manifest["counts"]["by_kind"], {"native_export": 4})
            self.assertEqual(first_manifest["counts"]["source"]["pe_read_errors"], 1)
            self.assertEqual(first_manifest["surface"], "native")
            self.assertNotEqual(first_manifest["captured_at"], second_manifest["captured_at"])
            self.assertEqual(first_manifest["atoms_sha256"], hashlib.sha256(first_bytes).hexdigest())
            for line in first_bytes.decode("utf-8").splitlines():
                record = json.loads(line)
                self.assertEqual(record["atom_id"], canonical_atom_id("native", record["canonical_key"]))
                self.assertEqual(record["member"]["parameters"], [])
                self.assertIsNone(record["member"]["return_type"])


if __name__ == "__main__":
    unittest.main()
