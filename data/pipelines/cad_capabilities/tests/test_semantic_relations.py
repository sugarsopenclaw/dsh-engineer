from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from data.pipelines.cad_capabilities.catalog_queue import canonical_atom_id
from data.pipelines.cad_capabilities.semantic_relations import (
    generate_dataset,
    high_confidence_from_name_alone,
    layout_position,
    make_implements,
    make_logic_uses,
    match_semantic_family,
    validate_relation,
)


def sha(fill: str) -> str:
    return (fill * 64)[:64]


class SemanticRelationTests(unittest.TestCase):
    def make_atom(
        self,
        *,
        surface: str,
        name: str,
        signature: str,
        declaring: str,
        atom_kind: str = "method",
        inventory_id: str | None = None,
    ) -> dict[str, object]:
        inventory_id = inventory_id or f"thcad-v24.{surface}.test"
        key = f"{surface}|{declaring}|{atom_kind}|{signature}"
        return {
            "schema_version": "1.0",
            "inventory_id": inventory_id,
            "atom_id": canonical_atom_id(surface, key),
            "canonical_key": key,
            "surface": surface,
            "atom_kind": atom_kind,
            "observed_host_ids": ["thcad-v24"],
            "source_artifact": {
                "artifact_id": f"src:{surface}",
                "kind": "test",
                "name": surface,
                "version": "1",
                "sha256": sha("a"),
            },
            "declaring_symbol": {
                "symbol_id": f"type:{declaring}",
                "full_name": declaring,
                "kind": "class",
            },
            "member": {
                "name": name,
                "signature": signature,
                "return_type": "System.Void",
                "parameters": [],
                "is_static": False,
            },
            "provenance": {
                "extractor": "test",
                "extractor_version": "1.0",
                "source_locator": {"member": name},
            },
            "surface_metadata": {},
        }

    def test_same_name_different_declaring_is_not_high_confidence(self) -> None:
        left = self.make_atom(
            surface="dotnet",
            name="GetString",
            signature="System.String GetString()",
            declaring="Bricscad.Ifc.IfcString",
        )
        right = self.make_atom(
            surface="dotnet",
            name="GetString",
            signature="System.String GetString()",
            declaring="Bricscad.Ifc.IfcBinary",
        )
        self.assertFalse(high_confidence_from_name_alone(left, right))
        self.assertIsNone(match_semantic_family(left, {"operation_kinds": ["read"]}))
        self.assertIsNone(match_semantic_family(right, {"operation_kinds": ["read"]}))

    def test_erase_family_shares_semantic_keeps_atom_ids(self) -> None:
        dotnet = self.make_atom(
            surface="dotnet",
            name="Erase",
            signature="System.Void Erase()",
            declaring="Teigha.DatabaseServices.Entity",
        )
        com_erase = self.make_atom(
            surface="com",
            name="Erase",
            signature="System.Void Erase()",
            declaring="BricscadDb.Interop.IAcadEntity",
        )
        com_delete = self.make_atom(
            surface="com",
            name="Delete",
            signature="System.Void Delete()",
            declaring="BricscadDb.Interop.IAcadEntity",
        )
        command = self.make_atom(
            surface="command",
            name="ERASE",
            signature="COMMAND TOKEN ERASE",
            declaring="cui:default_2D.CUI",
            atom_kind="command",
        )
        enrichment = {"operation_kinds": ["delete", "invoke"], "summary": "删除", "evidence": []}
        ids = []
        semantic_ids = set()
        for atom in (dotnet, com_erase, com_delete, command):
            family = match_semantic_family(atom, enrichment)
            self.assertEqual(family, "sem:cad.entity.delete")
            relation = make_implements(atom, enrichment, family)
            ids.append(relation["atom_id"])
            semantic_ids.add(relation["semantic_capability_id"])
        self.assertEqual(len(ids), 4)
        self.assertEqual(len(set(ids)), 4)
        self.assertEqual(semantic_ids, {"sem:cad.entity.delete"})

    def test_erased_and_delete_subentity_paths_are_not_entity_delete(self) -> None:
        erased = self.make_atom(
            surface="dotnet",
            name="Erased",
            signature="System.Void Erased(Teigha.DatabaseServices.DBObject dbObject)",
            declaring="Teigha.DatabaseServices.DimAssoc",
        )
        delete_paths = self.make_atom(
            surface="dotnet",
            name="DeleteSubentityPaths",
            signature=(
                "System.Void DeleteSubentityPaths("
                "Teigha.DatabaseServices.FullSubentityPath[] paths)"
            ),
            declaring="Teigha.DatabaseServices.Entity",
        )
        overrule = self.make_atom(
            surface="dotnet",
            name="Erase",
            signature="System.Void Erase(Teigha.DatabaseServices.DBObject dbObject)",
            declaring="Teigha.DatabaseServices.ObjectOverrule",
        )
        enrichment = {"operation_kinds": ["delete", "invoke"], "summary": "删除", "evidence": []}
        for atom in (erased, delete_paths, overrule):
            self.assertIsNone(match_semantic_family(atom, enrichment))
            self.assertIsNone(match_semantic_family(atom, None))

    def test_logic_uses_refuses_resemblance_accepts_source_call(self) -> None:
        atom = self.make_atom(
            surface="dotnet",
            name="ExplodeGeometry",
            signature="System.Void ExplodeGeometry(DBObjectCollection entitySet)",
            declaring="Teigha.DatabaseServices.Entity",
        )
        refused = make_logic_uses(
            logic_id="cad-02",
            source_ref="DrawingFrameDetector.cs:1",
            atom=atom,
            semantic_id="sem:cad.entity.explode_geometry",
            evidence_kind="member_name",
            claim="core might use ExplodeGeometry",
            confidence=0.2,
            basis="resemblance only",
        )
        self.assertIsNone(refused)
        accepted = make_logic_uses(
            logic_id="cad-01",
            source_ref="XuhaoAnnotationCoordinateExtractor.cs:91",
            atom=atom,
            semantic_id="sem:cad.entity.explode_geometry",
            evidence_kind="source_code",
            claim="entity.ExplodeGeometry(exploded)",
            confidence=0.75,
            basis="source call ExplodeGeometry",
        )
        self.assertIsNotNone(accepted)
        self.assertEqual(accepted["atom_id"], atom["atom_id"])
        self.assertEqual(accepted["logic_id"], "cad-01")
        self.assertNotEqual(accepted["atom_id"], None)

    def test_layout_stable_and_not_written_on_atom(self) -> None:
        atom = self.make_atom(
            surface="dotnet",
            name="Erase",
            signature="System.Void Erase()",
            declaring="Teigha.DatabaseServices.Entity",
        )
        first = layout_position("view:semantic", atom["inventory_id"], atom["atom_id"])
        second = layout_position("view:semantic", atom["inventory_id"], atom["atom_id"])
        self.assertEqual(first, second)
        self.assertNotIn("x", atom)
        self.assertNotIn("y", atom)
        self.assertNotIn("z", atom)
        other_view = layout_position("view:surface", atom["inventory_id"], atom["atom_id"])
        self.assertNotEqual((first["x"], first["y"], first["z"]), (other_view["x"], other_view["y"], other_view["z"]))

    def test_relation_missing_status_or_basis_fails(self) -> None:
        record = {
            "schema_version": "1.0",
            "relation_id": "impl:test",
            "kind": "IMPLEMENTS",
            "confidence": 0.5,
            "basis": "ok",
            "producer": "test",
            "semantic_capability_id": "sem:cad.entity.delete",
            "atom_id": "cap:dotnet:" + "a" * 24,
            "inventory_id": "thcad-v24.dotnet",
            "evidence": [],
        }
        with self.assertRaisesRegex(Exception, "status"):
            validate_relation(record)
        record["status"] = "proposed"
        del record["basis"]
        with self.assertRaisesRegex(Exception, "basis"):
            validate_relation(record)
        record["basis"] = "ok"
        del record["producer"]
        with self.assertRaisesRegex(Exception, "producer"):
            validate_relation(record)
        record["producer"] = "test"
        del record["confidence"]
        with self.assertRaisesRegex(Exception, "confidence"):
            validate_relation(record)


class SemanticGenerateFixtureTests(unittest.TestCase):
    def test_generate_from_synthetic_inventories(self) -> None:
        helper = SemanticRelationTests()
        explode = helper.make_atom(
            surface="dotnet",
            name="ExplodeGeometry",
            signature="System.Void ExplodeGeometry(DBObjectCollection entitySet)",
            declaring="Teigha.DatabaseServices.Entity",
            inventory_id="thcad-v24.dotnet.test",
        )
        explode["atom_id"] = canonical_atom_id("dotnet", explode["canonical_key"])
        erase = helper.make_atom(
            surface="dotnet",
            name="Erase",
            signature="System.Void Erase()",
            declaring="Teigha.DatabaseServices.Entity",
            inventory_id="thcad-v24.dotnet.test",
        )
        erased_event = helper.make_atom(
            surface="dotnet",
            name="Erased",
            signature="System.Void Erased(Teigha.DatabaseServices.DBObject dbObject)",
            declaring="Teigha.DatabaseServices.DimAssoc",
            inventory_id="thcad-v24.dotnet.test",
        )
        delete_paths = helper.make_atom(
            surface="dotnet",
            name="DeleteSubentityPaths",
            signature="System.Void DeleteSubentityPaths(Teigha.DatabaseServices.FullSubentityPath[] paths)",
            declaring="Teigha.DatabaseServices.Entity",
            inventory_id="thcad-v24.dotnet.test",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            logic = root / "local-dev" / "cad" / "adapters" / "thcad" / "01-full-entity-extraction"
            logic.mkdir(parents=True)
            (logic / "Call.cs").write_text(
                "using Teigha.DatabaseServices;\nclass C { void F(Entity entity) { entity.ExplodeGeometry(null); } }\n",
                encoding="utf-8",
            )
            core = root / "local-dev" / "cad" / "core" / "02-drawing-frame-detection"
            core.mkdir(parents=True)
            (core / "DrawingFrameDetector.cs").write_text(
                "namespace Shb.Cad.Core { class DrawingFrameDetector { } }\n",
                encoding="utf-8",
            )
            atoms_path = root / "atoms.jsonl"
            atoms_path.write_text(
                "".join(
                    json.dumps(atom, ensure_ascii=False) + "\n"
                    for atom in (explode, erase, erased_event, delete_paths)
                ),
                encoding="utf-8",
                newline="\n",
            )
            enrich_path = root / "enrichments.jsonl"
            enrich_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "inventory_id": explode["inventory_id"],
                        "atom_id": explode["atom_id"],
                        "status": "classified",
                        "operation_kinds": ["compute", "read"],
                        "domain_tags": ["geometry"],
                        "summary": "分解几何",
                        "classification_confidence": 0.8,
                        "semantic_candidates": [],
                        "evidence": [
                            {
                                "kind": "runtime_probe",
                                "ref": "docs",
                                "claim": "TH_XuHaoEntity ExplodeGeometry",
                            }
                        ],
                        "processor": {"kind": "rule", "name": "t", "run_id": "t"},
                        "processed_at": "2026-08-28T00:00:00Z",
                        "notes": "",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
                newline="\n",
            )
            out = root / "out"
            generate_dataset(
                inventories={"dotnet": (atoms_path, enrich_path)},
                logic_root=root / "local-dev" / "cad",
                output_dir=out,
            )
            implements = [
                json.loads(line) for line in (out / "implements.jsonl").read_text(encoding="utf-8").splitlines() if line
            ]
            self.assertTrue(any(item["semantic_capability_id"] == "sem:cad.entity.explode_geometry" for item in implements))
            self.assertTrue(any(item["semantic_capability_id"] == "sem:cad.entity.delete" for item in implements))
            delete_ids = {
                item["atom_id"]
                for item in implements
                if item["semantic_capability_id"] == "sem:cad.entity.delete"
                and item["confidence"] >= 0.62
            }
            self.assertIn(erase["atom_id"], delete_ids)
            self.assertNotIn(erased_event["atom_id"], delete_ids)
            self.assertNotIn(delete_paths["atom_id"], delete_ids)
            self.assertFalse(any(item["atom_id"] == erased_event["atom_id"] for item in implements))
            self.assertFalse(any(item["atom_id"] == delete_paths["atom_id"] for item in implements))
            logic_uses = [
                json.loads(line)
                for line in (out / "logic-uses-capability.jsonl").read_text(encoding="utf-8").splitlines()
                if line
            ]
            self.assertTrue(any(item["logic_id"] == "cad-01" for item in logic_uses))
            self.assertFalse(any(item["logic_id"] == "cad-02" for item in logic_uses))
            first = hashlib.sha256((out / "implements.jsonl").read_bytes()).hexdigest()
            generate_dataset(
                inventories={"dotnet": (atoms_path, enrich_path)},
                logic_root=root / "local-dev" / "cad",
                output_dir=out / "second",
            )
            second = hashlib.sha256((out / "second" / "implements.jsonl").read_bytes()).hexdigest()
            self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
