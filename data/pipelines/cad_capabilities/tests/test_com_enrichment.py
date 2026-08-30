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
from data.pipelines.cad_capabilities.com_enrichment import (
    classify_atom,
    run_loop,
    semantic_candidate_allowed,
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


class ComEnrichmentRuleTests(unittest.TestCase):
    def make_atom(
        self,
        name: str,
        signature: str,
        atom_kind: str,
        *,
        declaring: str = "BricscadDb.Interop.IAcadEntity",
        artifact: str = "BricscadDb",
    ) -> dict[str, object]:
        canonical_key = f"com|{artifact}|{declaring}|{atom_kind}|{signature}"
        return {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.com.test",
            "atom_id": canonical_atom_id("com", canonical_key),
            "canonical_key": canonical_key,
            "surface": "com",
            "atom_kind": atom_kind,
            "observed_host_ids": ["thcad-v24"],
            "source_artifact": {
                "artifact_id": f"typelib:{artifact}",
                "kind": "type_library",
                "name": artifact,
                "version": "23.0",
                "sha256": "a" * 64,
            },
            "declaring_symbol": {
                "symbol_id": f"com-type:{artifact}:{declaring}",
                "full_name": declaring,
                "kind": "interface",
            },
            "member": {
                "name": name,
                "signature": signature,
                "return_type": signature.split(" ", 1)[0],
                "parameters": [],
                "is_static": atom_kind == "progid_activation",
            },
            "provenance": {
                "extractor": "test-exporter",
                "extractor_version": "1.0",
                "source_locator": {"member": name},
            },
            "surface_metadata": {"type_library": artifact, "declaring_interface": declaring},
        }

    def classify(self, atom: dict[str, object]) -> dict[str, object]:
        return classify_atom(atom, processed_at="2026-08-27T00:00:00Z")

    def test_property_get_is_read(self) -> None:
        atom = self.make_atom("Name", "System.String get_Name()", "property_get")
        enrichment = self.classify(atom)
        self.assertEqual(enrichment["status"], "classified")
        self.assertIn("read", enrichment["operation_kinds"])
        self.assertTrue(enrichment["summary"])
        self.assertGreater(len(enrichment["evidence"]), 0)

    def test_property_set_is_edit(self) -> None:
        atom = self.make_atom("Color", "System.Void set_Color(System.Int32 value)", "property_set")
        enrichment = self.classify(atom)
        self.assertIn("edit", enrichment["operation_kinds"])

    def test_progid_activation_is_create_or_lifecycle(self) -> None:
        atom = self.make_atom(
            "BricscadApp.AcadApplication",
            "System.Object CreateInstance()",
            "progid_activation",
            declaring="BricscadApp.AcadApplication",
            artifact="BricscadApp",
        )
        enrichment = self.classify(atom)
        self.assertTrue({"create", "lifecycle"} & set(enrichment["operation_kinds"]))

    def test_constructor_is_create_or_lifecycle(self) -> None:
        atom = self.make_atom(".ctor", "System.Void .ctor()", "constructor")
        enrichment = self.classify(atom)
        self.assertTrue({"create", "lifecycle"} & set(enrichment["operation_kinds"]))

    def test_events_are_event(self) -> None:
        subscribe = self.classify(
            self.make_atom(
                "Modified",
                "System.Void add_Modified(Handler handler)",
                "event_subscribe",
            )
        )
        unsubscribe = self.classify(
            self.make_atom(
                "Modified",
                "System.Void remove_Modified(Handler handler)",
                "event_unsubscribe",
            )
        )
        self.assertIn("event", subscribe["operation_kinds"])
        self.assertIn("event", unsubscribe["operation_kinds"])

    def test_erase_proposes_delete_but_not_verified(self) -> None:
        atom = self.make_atom("Erase", "System.Void Erase()", "method")
        enrichment = self.classify(atom)
        self.assertIn("delete", enrichment["operation_kinds"])
        evidence_kinds = {item["kind"] for item in enrichment["evidence"]}
        self.assertTrue(evidence_kinds & {"member_name", "signature"})
        self.assertLess(enrichment["classification_confidence"], 0.8)
        for candidate in enrichment["semantic_candidates"]:
            self.assertNotEqual(candidate["status"], "verified")
        self.assertTrue(
            all(semantic_candidate_allowed(candidate, enrichment["evidence"]) for candidate in enrichment["semantic_candidates"])
        )

    def test_delete_method_same_rule(self) -> None:
        atom = self.make_atom("Delete", "System.Void Delete()", "method")
        enrichment = self.classify(atom)
        self.assertIn("delete", enrichment["operation_kinds"])
        self.assertFalse(any(c["status"] == "verified" for c in enrichment["semantic_candidates"]))


class ComEnrichmentQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.atoms_path = self.root / "capability-atoms.jsonl"
        self.manifest_path = self.root / "inventory-manifest.json"
        self.enrichments = self.root / "enrichments"
        self.batches = self.root / "batches"
        helper = ComEnrichmentRuleTests()
        self.atoms = [
            helper.make_atom("Name", "System.String get_Name()", "property_get"),
            helper.make_atom("Color", "System.Void set_Color(System.Int32 value)", "property_set"),
            helper.make_atom("Erase", "System.Void Erase()", "method"),
            helper.make_atom(
                "Modified",
                "System.Void add_Modified(Handler handler)",
                "event_subscribe",
            ),
            helper.make_atom(
                "App",
                "System.Object CreateInstance()",
                "progid_activation",
                declaring="BricscadApp.AcadApplication",
                artifact="BricscadApp",
            ),
        ]
        self.atoms.sort(key=lambda atom: str(atom["atom_id"]))
        write_jsonl(self.atoms_path, self.atoms)
        counts: dict[str, int] = {}
        for atom in self.atoms:
            kind = str(atom["atom_kind"])
            counts[kind] = counts.get(kind, 0) + 1
        artifacts = []
        seen = set()
        for atom in self.atoms:
            item = atom["source_artifact"]
            if item["artifact_id"] not in seen:
                artifacts.append(item)
                seen.add(item["artifact_id"])
        manifest = {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.com.test",
            "surface": "com",
            "observed_host_id": "thcad-v24",
            "captured_at": "2026-08-27T00:00:00Z",
            "extractor": {"name": "test-exporter", "version": "1.0"},
            "source_artifacts": artifacts,
            "atoms_file": "capability-atoms.jsonl",
            "atoms_sha256": hashlib.sha256(self.atoms_path.read_bytes()).hexdigest(),
            "counts": {
                "atoms": len(self.atoms),
                "by_kind": counts,
                "source": {"interfaces": 2},
            },
        }
        self.manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_verified_without_probe_is_rejected(self) -> None:
        enrichment = classify_atom(self.atoms[0], processed_at="2026-08-27T00:00:00Z")
        enrichment["semantic_candidates"] = [
            {
                "semantic_capability_id": "sem:cad.property.read",
                "label": "读取属性",
                "confidence": 0.9,
                "status": "verified",
                "basis": "no probe",
            }
        ]
        write_jsonl(self.enrichments / "part-000001.jsonl", [enrichment])
        with self.assertRaisesRegex(CatalogValidationError, "verified requires"):
            load_catalog(self.manifest_path, self.atoms_path, [str(self.enrichments)])

    def test_next_batch_parts_are_disjoint_and_complete(self) -> None:
        original_hash = hashlib.sha256(self.atoms_path.read_bytes()).hexdigest()
        self.enrichments.mkdir()
        first_batch = self.batches / "next-000001.jsonl"
        self.assertEqual(
            main(
                [
                    "next-batch",
                    "--manifest",
                    str(self.manifest_path),
                    "--atoms",
                    str(self.atoms_path),
                    "--enrichments",
                    str(self.enrichments),
                    "--limit",
                    "2",
                    "--output",
                    str(first_batch),
                ]
            ),
            0,
        )
        first_atoms = [json.loads(line) for line in first_batch.read_text(encoding="utf-8").splitlines() if line]
        first_ids = [atom["atom_id"] for atom in first_atoms]
        records = [classify_atom(atom, processed_at="2026-08-27T00:00:00Z") for atom in first_atoms]
        write_jsonl(self.enrichments / "part-000001.jsonl", records)
        self.assertEqual(
            main(
                [
                    "validate",
                    "--manifest",
                    str(self.manifest_path),
                    "--atoms",
                    str(self.atoms_path),
                    "--enrichments",
                    str(self.enrichments),
                ]
            ),
            0,
        )
        second_batch = self.batches / "next-000002.jsonl"
        self.assertEqual(
            main(
                [
                    "next-batch",
                    "--manifest",
                    str(self.manifest_path),
                    "--atoms",
                    str(self.atoms_path),
                    "--enrichments",
                    str(self.enrichments),
                    "--limit",
                    "2",
                    "--output",
                    str(second_batch),
                ]
            ),
            0,
        )
        second_ids = [
            json.loads(line)["atom_id"]
            for line in second_batch.read_text(encoding="utf-8").splitlines()
            if line
        ]
        self.assertTrue(first_ids)
        self.assertTrue(second_ids)
        self.assertFalse(set(first_ids) & set(second_ids))
        run_loop(
            self.manifest_path,
            self.atoms_path,
            self.enrichments,
            self.batches,
            limit=2,
            processed_at="2026-08-27T00:00:00Z",
        )
        self.assertEqual(
            main(
                [
                    "validate",
                    "--manifest",
                    str(self.manifest_path),
                    "--atoms",
                    str(self.atoms_path),
                    "--enrichments",
                    str(self.enrichments),
                    "--require-complete",
                ]
            ),
            0,
        )
        snapshot = load_catalog(self.manifest_path, self.atoms_path, [str(self.enrichments)])
        self.assertEqual(snapshot.progress()["pending"], 0)
        self.assertEqual(
            snapshot.progress()["raw_total"],
            snapshot.progress()["classified"]
            + snapshot.progress()["deferred"]
            + snapshot.progress()["failed"],
        )
        self.assertEqual(hashlib.sha256(self.atoms_path.read_bytes()).hexdigest(), original_hash)
        self.assertEqual({path.name for path in self.enrichments.glob("part-*.jsonl")}, {
            "part-000001.jsonl",
            "part-000002.jsonl",
            "part-000003.jsonl",
        })


if __name__ == "__main__":
    unittest.main()
