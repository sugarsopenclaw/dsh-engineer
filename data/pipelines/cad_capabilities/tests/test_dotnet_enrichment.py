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
    run_loop,
    semantic_candidate_allowed,
)
from data.pipelines.cad_capabilities.dotnet_enrichment import (
    classify_atom,
    is_entity_explode_geometry,
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


class DotNetEnrichmentRuleTests(unittest.TestCase):
    def make_atom(
        self,
        name: str,
        signature: str,
        atom_kind: str,
        *,
        declaring: str = "Teigha.DatabaseServices.Entity",
        artifact: str = "TD_Mgd",
        return_type: str | None = None,
    ) -> dict[str, object]:
        canonical_key = f"dotnet|{artifact}|{declaring}|{atom_kind}|{signature}"
        return {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.dotnet.test",
            "atom_id": canonical_atom_id("dotnet", canonical_key),
            "canonical_key": canonical_key,
            "surface": "dotnet",
            "atom_kind": atom_kind,
            "observed_host_ids": ["thcad-v24"],
            "source_artifact": {
                "artifact_id": f"assembly:{artifact}",
                "kind": "assembly",
                "name": artifact,
                "version": "23.9.0.0",
                "sha256": "a" * 64,
            },
            "declaring_symbol": {
                "symbol_id": f"dotnet-type:{artifact}:{declaring}",
                "full_name": declaring,
                "kind": "class",
            },
            "member": {
                "name": name,
                "signature": signature,
                "return_type": return_type or signature.split(" ", 1)[0],
                "parameters": [],
                "is_static": False,
            },
            "provenance": {
                "extractor": "test-exporter",
                "extractor_version": "1.0",
                "source_locator": {"member": name},
            },
            "surface_metadata": {"assembly": artifact, "declaring_type": declaring},
        }

    def classify(self, atom: dict[str, object]) -> dict[str, object]:
        return classify_atom(atom, processed_at="2026-08-27T00:00:00Z")

    def test_property_get_and_field_read_are_read(self) -> None:
        prop = self.classify(self.make_atom("Layer", "System.String get_Layer()", "property_get"))
        field = self.classify(self.make_atom("DefaultColor", "System.Int32 get_DefaultColor()", "field_read"))
        self.assertIn("read", prop["operation_kinds"])
        self.assertIn("read", field["operation_kinds"])

    def test_property_set_and_field_write_are_edit(self) -> None:
        prop = self.classify(self.make_atom("ColorIndex", "System.Void set_ColorIndex(System.Int32 value)", "property_set"))
        field = self.classify(self.make_atom("Flag", "System.Void set_Flag(System.Int32 value)", "field_write"))
        self.assertIn("edit", prop["operation_kinds"])
        self.assertIn("edit", field["operation_kinds"])

    def test_constructor_is_create_or_lifecycle(self) -> None:
        atom = self.make_atom(
            ".ctor",
            "Teigha.DatabaseServices.Line .ctor()",
            "constructor",
            declaring="Teigha.DatabaseServices.Line",
        )
        enrichment = self.classify(atom)
        self.assertTrue({"create", "lifecycle"} & set(enrichment["operation_kinds"]))

    def test_events_are_event(self) -> None:
        subscribe = self.classify(
            self.make_atom("Modified", "System.Void add_Modified(Handler handler)", "event_subscribe")
        )
        unsubscribe = self.classify(
            self.make_atom("Modified", "System.Void remove_Modified(Handler handler)", "event_unsubscribe")
        )
        self.assertIn("event", subscribe["operation_kinds"])
        self.assertIn("event", unsubscribe["operation_kinds"])

    def test_geometric_get_is_not_edit_or_verified(self) -> None:
        atom = self.make_atom(
            "GetClosestPointTo",
            "Teigha.Geometry.Point3d GetClosestPointTo(Teigha.Geometry.Point3d givenPoint)",
            "method",
            declaring="Teigha.DatabaseServices.Curve",
            return_type="Teigha.Geometry.Point3d",
        )
        enrichment = self.classify(atom)
        self.assertNotIn("edit", enrichment["operation_kinds"])
        self.assertTrue({"read", "compute", "invoke"} & set(enrichment["operation_kinds"]))
        self.assertFalse(any(candidate["status"] == "verified" for candidate in enrichment["semantic_candidates"]))
        self.assertLess(enrichment["classification_confidence"], 0.8)

    def test_erase_proposes_delete_but_not_verified(self) -> None:
        atom = self.make_atom("Erase", "System.Void Erase()", "method")
        enrichment = self.classify(atom)
        self.assertIn("delete", enrichment["operation_kinds"])
        evidence_kinds = {item["kind"] for item in enrichment["evidence"]}
        self.assertTrue(evidence_kinds & {"member_name", "signature"})
        self.assertLess(enrichment["classification_confidence"], 0.8)
        self.assertFalse(any(candidate["status"] == "verified" for candidate in enrichment["semantic_candidates"]))

    def test_explode_geometry_probe_is_atom_specific(self) -> None:
        explode_geometry = self.make_atom(
            "ExplodeGeometry",
            "System.Void ExplodeGeometry(Teigha.DatabaseServices.DBObjectCollection entitySet)",
            "method",
            declaring="Teigha.DatabaseServices.Entity",
            return_type="System.Void",
        )
        explode = self.make_atom(
            "Explode",
            "System.Void Explode(Teigha.DatabaseServices.DBObjectCollection entitySet)",
            "method",
            declaring="Teigha.DatabaseServices.Entity",
            return_type="System.Void",
        )
        geo = self.classify(explode_geometry)
        sibling = self.classify(explode)
        self.assertTrue(is_entity_explode_geometry(explode_geometry))
        self.assertFalse(is_entity_explode_geometry(explode))
        self.assertTrue(any(item["kind"] == "runtime_probe" for item in geo["evidence"]))
        self.assertTrue(any(candidate["status"] == "verified" for candidate in geo["semantic_candidates"]))
        self.assertTrue(semantic_candidate_allowed(geo["semantic_candidates"][0], geo["evidence"]))
        self.assertFalse(any(item["kind"] == "runtime_probe" for item in sibling["evidence"]))
        self.assertFalse(any(candidate["status"] == "verified" for candidate in sibling["semantic_candidates"]))


class DotNetEnrichmentQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.atoms_path = self.root / "capability-atoms.jsonl"
        self.manifest_path = self.root / "inventory-manifest.json"
        self.enrichments = self.root / "enrichments"
        self.batches = self.root / "batches"
        helper = DotNetEnrichmentRuleTests()
        self.atoms = [
            helper.make_atom("Layer", "System.String get_Layer()", "property_get"),
            helper.make_atom("ColorIndex", "System.Void set_ColorIndex(System.Int32 value)", "property_set"),
            helper.make_atom("Erase", "System.Void Erase()", "method"),
            helper.make_atom("Modified", "System.Void add_Modified(Handler handler)", "event_subscribe"),
            helper.make_atom(
                ".ctor",
                "Teigha.DatabaseServices.Line .ctor()",
                "constructor",
                declaring="Teigha.DatabaseServices.Line",
            ),
        ]
        self.atoms.sort(key=lambda atom: str(atom["atom_id"]))
        write_jsonl(self.atoms_path, self.atoms)
        counts: dict[str, int] = {}
        for atom in self.atoms:
            kind = str(atom["atom_kind"])
            counts[kind] = counts.get(kind, 0) + 1
        artifacts = []
        seen: set[str] = set()
        for atom in self.atoms:
            item = atom["source_artifact"]
            if item["artifact_id"] not in seen:
                artifacts.append(item)
                seen.add(str(item["artifact_id"]))
        manifest = {
            "schema_version": "1.0",
            "inventory_id": "thcad-v24.dotnet.test",
            "surface": "dotnet",
            "observed_host_id": "thcad-v24",
            "captured_at": "2026-08-27T00:00:00Z",
            "extractor": {"name": "test-exporter", "version": "1.0"},
            "source_artifacts": artifacts,
            "atoms_file": "capability-atoms.jsonl",
            "atoms_sha256": hashlib.sha256(self.atoms_path.read_bytes()).hexdigest(),
            "counts": {"atoms": len(self.atoms), "by_kind": counts, "source": {"public_types": 2}},
        }
        self.manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_verified_without_probe_is_rejected(self) -> None:
        enrichment = classify_atom(self.atoms[0], processed_at="2026-08-27T00:00:00Z")
        enrichment["semantic_candidates"] = [
            {
                "semantic_capability_id": "sem:cad.property.read",
                "label": "读取成员",
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
        write_jsonl(
            self.enrichments / "part-000001.jsonl",
            [classify_atom(atom, processed_at="2026-08-27T00:00:00Z") for atom in first_atoms],
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
            classify=classify_atom,
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
        self.assertEqual(hashlib.sha256(self.atoms_path.read_bytes()).hexdigest(), original_hash)


if __name__ == "__main__":
    unittest.main()
