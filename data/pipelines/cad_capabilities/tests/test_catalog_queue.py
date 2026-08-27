from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from data.pipelines.cad_capabilities.catalog_queue import (
    CatalogValidationError,
    canonical_atom_id,
    load_catalog,
    main,
)


def write_jsonl(path: Path, records: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(
            json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
            for record in records
        ),
        encoding="utf-8",
        newline="\n",
    )


class CatalogQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.atoms_path = self.root / "capability-atoms.jsonl"
        self.manifest_path = self.root / "inventory-manifest.json"
        self.enrichment_directory = self.root / "enrichments"

        self.atoms = [
            self.make_atom("ReadName", "System.String ReadName()", "property_get"),
            self.make_atom("Erase", "System.Void Erase()", "method"),
        ]
        self.atoms.sort(key=lambda atom: str(atom["atom_id"]))
        write_jsonl(self.atoms_path, self.atoms)
        self.write_manifest()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def make_atom(
        self, name: str, signature: str, atom_kind: str
    ) -> dict[str, object]:
        canonical_key = f"com|BricscadDb|IAcadEntity|{atom_kind}|{signature}"
        return {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.com.test",
            "atom_id": canonical_atom_id("com", canonical_key),
            "canonical_key": canonical_key,
            "surface": "com",
            "atom_kind": atom_kind,
            "observed_host_ids": ["thcad-v24"],
            "source_artifact": {
                "artifact_id": "typelib:BricscadDb",
                "kind": "type_library",
                "name": "BricscadDb",
                "version": "23.0",
                "sha256": "a" * 64,
            },
            "declaring_symbol": {
                "symbol_id": "com-type:BricscadDb:IAcadEntity",
                "full_name": "BricscadDb.Interop.IAcadEntity",
                "kind": "interface",
            },
            "member": {
                "name": name,
                "signature": signature,
                "return_type": signature.split(" ", 1)[0],
                "parameters": [],
                "is_static": False,
            },
            "provenance": {
                "extractor": "test-exporter",
                "extractor_version": "1.0",
                "source_locator": {"interface": "IAcadEntity", "member": name},
            },
            "surface_metadata": {},
        }

    def write_manifest(self) -> None:
        atoms_sha256 = hashlib.sha256(self.atoms_path.read_bytes()).hexdigest()
        manifest = {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.com.test",
            "surface": "com",
            "observed_host_id": "thcad-v24",
            "captured_at": "2026-08-27T00:00:00Z",
            "extractor": {"name": "test-exporter", "version": "1.0"},
            "source_artifacts": [
                {
                    "artifact_id": "typelib:BricscadDb",
                    "kind": "type_library",
                    "name": "BricscadDb",
                    "version": "23.0",
                    "sha256": "a" * 64,
                }
            ],
            "atoms_file": "capability-atoms.jsonl",
            "atoms_sha256": atoms_sha256,
            "counts": {
                "atoms": 2,
                "by_kind": {"method": 1, "property_get": 1},
                "source": {"interfaces": 1},
            },
        }
        self.manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def make_enrichment(self, atom: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.com.test",
            "atom_id": atom["atom_id"],
            "status": "classified",
            "operation_kinds": ["read"],
            "domain_tags": ["entity"],
            "summary": "读取实体名称。",
            "classification_confidence": 0.9,
            "semantic_candidates": [],
            "evidence": [
                {
                    "kind": "signature",
                    "ref": str(atom["atom_id"]),
                    "claim": "签名返回字符串且不包含输入参数。",
                }
            ],
            "processor": {
                "kind": "agent",
                "name": "test-agent",
                "run_id": "test-run",
            },
            "processed_at": "2026-08-27T00:00:00Z",
            "notes": None,
        }

    def test_partial_progress_and_next_batch_resume(self) -> None:
        enrichment = self.make_enrichment(self.atoms[0])
        write_jsonl(self.enrichment_directory / "part-000001.jsonl", [enrichment])
        snapshot = load_catalog(
            self.manifest_path,
            self.atoms_path,
            [str(self.enrichment_directory)],
        )
        self.assertEqual(snapshot.progress()["processed"], 1)
        self.assertEqual(snapshot.progress()["pending"], 1)

        batch_path = self.root / "batches" / "next.jsonl"
        exit_code = main(
            [
                "next-batch",
                "--manifest",
                str(self.manifest_path),
                "--atoms",
                str(self.atoms_path),
                "--enrichments",
                str(self.enrichment_directory),
                "--limit",
                "100",
                "--output",
                str(batch_path),
            ]
        )
        self.assertEqual(exit_code, 0)
        batch_records = [json.loads(line) for line in batch_path.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([record["atom_id"] for record in batch_records], [self.atoms[1]["atom_id"]])

    def test_unknown_enrichment_atom_is_rejected(self) -> None:
        enrichment = self.make_enrichment(self.atoms[0])
        enrichment["atom_id"] = "cap:com:" + "f" * 24
        write_jsonl(self.enrichment_directory / "part-invalid.jsonl", [enrichment])
        with self.assertRaisesRegex(CatalogValidationError, "unknown atom_id"):
            load_catalog(
                self.manifest_path,
                self.atoms_path,
                [str(self.enrichment_directory)],
            )

    def test_require_complete_fails_while_pending(self) -> None:
        exit_code = main(
            [
                "validate",
                "--manifest",
                str(self.manifest_path),
                "--atoms",
                str(self.atoms_path),
                "--require-complete",
            ]
        )
        self.assertEqual(exit_code, 2)

    def test_duplicate_enrichment_is_rejected(self) -> None:
        enrichment = self.make_enrichment(self.atoms[0])
        write_jsonl(self.enrichment_directory / "part-1.jsonl", [enrichment])
        write_jsonl(self.enrichment_directory / "part-2.jsonl", [enrichment])
        with self.assertRaisesRegex(CatalogValidationError, "duplicate enrichment"):
            load_catalog(
                self.manifest_path,
                self.atoms_path,
                [str(self.enrichment_directory)],
            )

    def test_atom_id_must_match_canonical_key(self) -> None:
        self.atoms[0]["atom_id"] = "cap:com:" + "0" * 24
        write_jsonl(self.atoms_path, self.atoms)
        self.write_manifest()
        with self.assertRaisesRegex(CatalogValidationError, "atom_id must be"):
            load_catalog(self.manifest_path, self.atoms_path, [])

    def test_atoms_must_be_stably_sorted(self) -> None:
        write_jsonl(self.atoms_path, list(reversed(self.atoms)))
        self.write_manifest()
        with self.assertRaisesRegex(CatalogValidationError, "sorted by atom_id"):
            load_catalog(self.manifest_path, self.atoms_path, [])


if __name__ == "__main__":
    unittest.main()
