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
from data.pipelines.cad_capabilities.dotnet_atoms import (
    EXTRACTOR_NAME,
    atomize_scan,
    canonical_dotnet_key,
    emit_inventory,
    format_signature,
)


def sha(fill: str) -> str:
    return (fill * 64)[:64]


class DotNetAtomizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scan = {
            "inventory_id": "thcad-v24.dotnet.test",
            "observed_host_id": "thcad-v24",
            "assemblies": [
                {
                    "name": "TD_Mgd",
                    "file_name": "TD_Mgd.dll",
                    "version": "23.9.0.0",
                    "sha256": sha("a"),
                    "public_type_count": 3,
                    "declared_method_overload_count": 4,
                    "declared_property_count": 2,
                    "declared_event_count": 1,
                    "declared_constructor_count": 2,
                    "declared_field_count": 5,
                    "enum_literal_count": 2,
                    "reflection_errors": [],
                    "types": [
                        {
                            "name": "Entity",
                            "full_name": "Teigha.DatabaseServices.Entity",
                            "kind": "class",
                            "is_enum": False,
                            "methods": [
                                {
                                    "name": "Explode",
                                    "return_type": "System.Void",
                                    "is_static": False,
                                    "parameters": [],
                                },
                                {
                                    "name": "Explode",
                                    "return_type": "System.Void",
                                    "is_static": False,
                                    "parameters": [
                                        {
                                            "name": "entitySet",
                                            "type": "System.Collections.Generic.List`1[Teigha.DatabaseServices.Entity]",
                                            "direction": "out",
                                            "optional": False,
                                        }
                                    ],
                                },
                                {
                                    "name": "FromHandle",
                                    "return_type": "Teigha.DatabaseServices.Entity",
                                    "is_static": True,
                                    "parameters": [
                                        {
                                            "name": "handle",
                                            "type": "System.String",
                                            "direction": "in",
                                            "optional": False,
                                        }
                                    ],
                                },
                            ],
                            "properties": [
                                {
                                    "name": "Layer",
                                    "type": "System.String",
                                    "can_read": True,
                                    "can_write": False,
                                    "is_static": False,
                                    "parameters": [],
                                },
                                {
                                    "name": "ColorIndex",
                                    "type": "System.Int32",
                                    "can_read": True,
                                    "can_write": True,
                                    "is_static": False,
                                    "parameters": [],
                                },
                            ],
                            "events": [
                                {
                                    "name": "Modified",
                                    "handler_type": "Teigha.DatabaseServices.ObjectEventHandler",
                                    "is_static": False,
                                }
                            ],
                            "constructors": [],
                            "fields": [
                                {
                                    "name": "DefaultColor",
                                    "type": "System.Int32",
                                    "is_static": True,
                                    "is_literal": False,
                                    "is_init_only": False,
                                    "is_special_name": False,
                                },
                                {
                                    "name": "ReadonlyFlag",
                                    "type": "System.Boolean",
                                    "is_static": False,
                                    "is_literal": False,
                                    "is_init_only": True,
                                    "is_special_name": False,
                                },
                                {
                                    "name": "AccessState",
                                    "type": "System.Int32",
                                    "is_static": True,
                                    "is_literal": True,
                                    "is_init_only": False,
                                    "is_special_name": False,
                                },
                            ],
                        },
                        {
                            "name": "Line",
                            "full_name": "Teigha.DatabaseServices.Line",
                            "kind": "class",
                            "is_enum": False,
                            "methods": [
                                {
                                    "name": "SetFrom",
                                    "return_type": "System.Void",
                                    "is_static": False,
                                    "parameters": [
                                        {
                                            "name": "start",
                                            "type": "Teigha.Geometry.Point3d",
                                            "direction": "ref",
                                            "optional": False,
                                        }
                                    ],
                                }
                            ],
                            "properties": [],
                            "events": [],
                            "constructors": [
                                {
                                    "name": ".ctor",
                                    "is_static": False,
                                    "parameters": [],
                                },
                                {
                                    "name": ".ctor",
                                    "is_static": False,
                                    "parameters": [
                                        {
                                            "name": "start",
                                            "type": "Teigha.Geometry.Point3d",
                                            "direction": "in",
                                            "optional": False,
                                        },
                                        {
                                            "name": "end",
                                            "type": "Teigha.Geometry.Point3d",
                                            "direction": "in",
                                            "optional": False,
                                        },
                                    ],
                                },
                            ],
                            "fields": [],
                        },
                        {
                            "name": "OpenMode",
                            "full_name": "Teigha.DatabaseServices.OpenMode",
                            "kind": "enum",
                            "is_enum": True,
                            "methods": [],
                            "properties": [],
                            "events": [],
                            "constructors": [],
                            "fields": [
                                {
                                    "name": "ForRead",
                                    "type": "Teigha.DatabaseServices.OpenMode",
                                    "is_static": True,
                                    "is_literal": True,
                                    "is_init_only": False,
                                    "is_special_name": False,
                                },
                                {
                                    "name": "ForWrite",
                                    "type": "Teigha.DatabaseServices.OpenMode",
                                    "is_static": True,
                                    "is_literal": True,
                                    "is_init_only": False,
                                    "is_special_name": False,
                                },
                            ],
                        },
                    ],
                }
            ],
            "conversion_errors": [],
            "reflection_errors": [],
        }

    def atoms_named(self, atoms: list[dict], name: str, declaring: str | None = None) -> list[dict]:
        selected = [atom for atom in atoms if atom["member"]["name"] == name]
        if declaring is not None:
            selected = [
                atom
                for atom in selected
                if atom["declaring_symbol"] and atom["declaring_symbol"]["full_name"] == declaring
            ]
        return selected

    def test_overloads_static_ctor_properties_events_ref_inheritance_enum(self) -> None:
        atoms, source_counts, _artifacts = atomize_scan(self.scan)
        self.assertEqual(source_counts["public_types"], 3)
        self.assertEqual(source_counts["declared_method_overloads"], 4)
        self.assertEqual(source_counts["declared_properties"], 2)
        self.assertEqual(source_counts["declared_events"], 1)
        self.assertEqual(source_counts["declared_constructors"], 2)
        self.assertEqual(source_counts["declared_fields"], 5)
        self.assertEqual(source_counts["enum_literals"], 2)
        self.assertEqual(source_counts["reflection_errors"], 0)

        entity = "Teigha.DatabaseServices.Entity"
        explodes = self.atoms_named(atoms, "Explode", entity)
        self.assertEqual(len(explodes), 2)
        self.assertEqual({atom["atom_kind"] for atom in explodes}, {"method"})
        signatures = {atom["member"]["signature"] for atom in explodes}
        self.assertEqual(len(signatures), 2)
        self.assertTrue(any("out " in atom["member"]["signature"] for atom in explodes))
        self.assertEqual(len({atom["atom_id"] for atom in explodes}), 2)

        static = self.atoms_named(atoms, "FromHandle", entity)
        self.assertEqual(len(static), 1)
        self.assertTrue(static[0]["member"]["is_static"])

        layers = self.atoms_named(atoms, "Layer", entity)
        self.assertEqual([atom["atom_kind"] for atom in layers], ["property_get"])

        colors = self.atoms_named(atoms, "ColorIndex", entity)
        self.assertEqual(sorted(atom["atom_kind"] for atom in colors), ["property_get", "property_set"])

        events = self.atoms_named(atoms, "Modified", entity)
        self.assertEqual(
            sorted(atom["atom_kind"] for atom in events),
            ["event_subscribe", "event_unsubscribe"],
        )

        line = "Teigha.DatabaseServices.Line"
        ctors = [atom for atom in atoms if atom["atom_kind"] == "constructor"]
        self.assertEqual(len(ctors), 2)
        self.assertTrue(all(atom["declaring_symbol"]["full_name"] == line for atom in ctors))

        ref_method = self.atoms_named(atoms, "SetFrom", line)
        self.assertEqual(len(ref_method), 1)
        self.assertEqual(ref_method[0]["member"]["parameters"][0]["direction"], "ref")

        explode_declaring = {atom["declaring_symbol"]["full_name"] for atom in explodes}
        self.assertEqual(explode_declaring, {entity})
        self.assertFalse(any(atom["declaring_symbol"]["full_name"] == line and atom["member"]["name"] == "Explode" for atom in atoms))

        enum_atoms = [
            atom
            for atom in atoms
            if atom["declaring_symbol"]["full_name"] == "Teigha.DatabaseServices.OpenMode"
        ]
        self.assertEqual(enum_atoms, [])
        self.assertFalse(any(atom["member"]["name"] in {"ForRead", "ForWrite"} for atom in atoms))

        field_reads = [atom for atom in atoms if atom["atom_kind"] == "field_read"]
        field_writes = [atom for atom in atoms if atom["atom_kind"] == "field_write"]
        self.assertEqual(
            {atom["member"]["name"] for atom in field_reads},
            {"DefaultColor", "ReadonlyFlag", "AccessState"},
        )
        self.assertEqual({atom["member"]["name"] for atom in field_writes}, {"DefaultColor"})
        const_reads = self.atoms_named(atoms, "AccessState", entity)
        self.assertEqual([atom["atom_kind"] for atom in const_reads], ["field_read"])
        self.assertTrue(const_reads[0]["member"]["is_static"])

        for atom in atoms:
            self.assertEqual(atom["atom_id"], canonical_atom_id("dotnet", atom["canonical_key"]))
            self.assertEqual(atom["surface"], "dotnet")
            self.assertEqual(atom["provenance"]["extractor"], EXTRACTOR_NAME)
            expected_key = canonical_dotnet_key(
                assembly_name=atom["source_artifact"]["name"],
                declaring=atom["declaring_symbol"]["full_name"],
                atom_kind=atom["atom_kind"],
                signature=atom["member"]["signature"],
            )
            self.assertEqual(atom["canonical_key"], expected_key)

        self.assertEqual(format_signature("System.Void", "Erase", []), "System.Void Erase()")

    def test_emit_inventory_is_stable_valid_and_path_free(self) -> None:
        with tempfile.TemporaryDirectory() as first_dir, tempfile.TemporaryDirectory() as second_dir:
            first = Path(first_dir)
            second = Path(second_dir)
            first_manifest = emit_inventory(self.scan, first, captured_at="2026-08-27T00:00:00Z")
            second_manifest = emit_inventory(self.scan, second, captured_at="2026-08-27T01:00:00Z")
            first_bytes = (first / "capability-atoms.jsonl").read_bytes()
            second_bytes = (second / "capability-atoms.jsonl").read_bytes()
            self.assertEqual(hashlib.sha256(first_bytes).hexdigest(), hashlib.sha256(second_bytes).hexdigest())
            self.assertEqual(first_bytes, second_bytes)
            self.assertTrue(first_bytes.endswith(b"\n"))
            self.assertNotIn(b"\r", first_bytes)
            snapshot = load_catalog(
                first / "inventory-manifest.json",
                first / "capability-atoms.jsonl",
                [],
            )
            self.assertEqual(snapshot.progress()["raw_total"], first_manifest["counts"]["atoms"])
            self.assertEqual(first_manifest["atoms_sha256"], hashlib.sha256(first_bytes).hexdigest())
            self.assertNotEqual(first_manifest["captured_at"], second_manifest["captured_at"])
            text = first_bytes.decode("utf-8")
            self.assertNotRegex(text, r"(?i)[a-z]:[\\/]")
            for line in text.splitlines():
                record = json.loads(line)
                self.assertEqual(record["atom_id"], canonical_atom_id("dotnet", record["canonical_key"]))


if __name__ == "__main__":
    unittest.main()
