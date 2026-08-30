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
from data.pipelines.cad_capabilities.com_atoms import (
    EXTRACTOR_NAME,
    atomize_scan,
    canonical_com_key,
    emit_inventory,
    format_signature,
)


def sha(fill: str) -> str:
    return (fill * 64)[:64]


class ComAtomizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scan = {
            "inventory_id": "thcad-v24.com.test",
            "observed_host_id": "thcad-v24",
            "type_libraries": [
                {
                    "label": "BricscadDb",
                    "bitness": "64-bit",
                    "file_name": "axbricscaddb1.dll",
                    "version": "23.0",
                    "sha256": sha("a"),
                    "interface_count": 2,
                    "declared_method_count": 4,
                    "declared_property_count": 2,
                    "declared_event_count": 1,
                    "reflection_errors": [],
                    "interfaces": [
                        {
                            "name": "IAcadEntity",
                            "full_name": "BricscadDb.Interop.IAcadEntity",
                            "kind": "interface",
                            "methods": [
                                {
                                    "name": "Add",
                                    "return_type": "System.Int32",
                                    "is_static": False,
                                    "dispid": 10,
                                    "parameters": [
                                        {
                                            "name": "index",
                                            "type": "System.Int32",
                                            "direction": "in",
                                            "optional": False,
                                        }
                                    ],
                                },
                                {
                                    "name": "Add",
                                    "return_type": "System.Int32",
                                    "is_static": False,
                                    "dispid": 11,
                                    "parameters": [
                                        {
                                            "name": "name",
                                            "type": "System.String",
                                            "direction": "in",
                                            "optional": False,
                                        }
                                    ],
                                },
                                {
                                    "name": "Erase",
                                    "return_type": "System.Void",
                                    "is_static": False,
                                    "dispid": 12,
                                    "parameters": [],
                                },
                            ],
                            "properties": [
                                {
                                    "name": "Name",
                                    "type": "System.String",
                                    "can_read": True,
                                    "can_write": False,
                                    "is_static": False,
                                    "dispid": 20,
                                    "parameters": [],
                                },
                                {
                                    "name": "Color",
                                    "type": "System.Int32",
                                    "can_read": True,
                                    "can_write": True,
                                    "is_static": False,
                                    "dispid": 21,
                                    "parameters": [],
                                },
                            ],
                            "events": [
                                {
                                    "name": "Modified",
                                    "handler_type": "BricscadDb.Interop.ModifiedEventHandler",
                                    "is_static": False,
                                    "dispid": 30,
                                }
                            ],
                        },
                        {
                            "name": "IAcadObject",
                            "full_name": "BricscadDb.Interop.IAcadObject",
                            "kind": "interface",
                            "methods": [
                                {
                                    "name": "Erase",
                                    "return_type": "System.Void",
                                    "is_static": False,
                                    "dispid": 40,
                                    "parameters": [],
                                }
                            ],
                            "properties": [],
                            "events": [],
                        },
                    ],
                },
                {
                    "label": "THCADPickUp",
                    "bitness": "32-bit",
                    "file_name": "THCADPickUp.ocx",
                    "version": "1.0",
                    "sha256": sha("b"),
                    "interface_count": 1,
                    "declared_method_count": 1,
                    "declared_property_count": 0,
                    "declared_event_count": 0,
                    "reflection_errors": [],
                    "interfaces": [
                        {
                            "name": "IPickUpConfig",
                            "full_name": "THCADPickUp.Interop.IPickUpConfig",
                            "kind": "interface",
                            "methods": [
                                {
                                    "name": "Extract",
                                    "return_type": "System.Int32",
                                    "is_static": False,
                                    "dispid": 1,
                                    "parameters": [],
                                }
                            ],
                            "properties": [],
                            "events": [],
                        }
                    ],
                },
            ],
            "progids": [
                {
                    "prog_id": "BricscadApp.AcadApplication",
                    "clsid": "{BC27895B-1197-40D7-9C9A-C94EB52B1F48}",
                    "server_kind": "local",
                    "type_lib": "{96586CB6-6D0C-416C-A680-B6D55C40C09C}",
                    "registry_view": "64-bit",
                },
                {
                    "prog_id": "THCADPickUp.PickUpConfig",
                    "clsid": "{11111111-1111-1111-1111-111111111111}",
                    "server_kind": "inproc",
                    "type_lib": "{22222222-2222-2222-2222-222222222222}",
                    "registry_view": "32-bit",
                },
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

    def test_overloads_readonly_writable_events_32bit_and_non_merge(self) -> None:
        atoms, source_counts, artifacts = atomize_scan(self.scan)
        self.assertEqual(source_counts["interfaces"], 3)
        self.assertEqual(source_counts["declared_methods"], 5)
        self.assertEqual(source_counts["declared_properties"], 2)
        self.assertEqual(source_counts["declared_events"], 1)
        self.assertEqual(source_counts["progids"], 2)
        self.assertEqual(source_counts["conversion_errors"], 0)
        self.assertEqual(source_counts["reflection_errors"], 0)
        self.assertEqual({item["artifact_id"] for item in artifacts}, {
            "registry:hkcr-progid",
            "typelib:BricscadDb",
            "typelib:THCADPickUp",
        })

        entity = "BricscadDb.Interop.IAcadEntity"
        adds = self.atoms_named(atoms, "Add", entity)
        self.assertEqual(len(adds), 2)
        self.assertEqual({atom["atom_kind"] for atom in adds}, {"method"})
        signatures = {atom["member"]["signature"] for atom in adds}
        self.assertEqual(
            signatures,
            {
                "System.Int32 Add(System.Int32 index)",
                "System.Int32 Add(System.String name)",
            },
        )
        self.assertEqual(len({atom["atom_id"] for atom in adds}), 2)

        names = self.atoms_named(atoms, "Name", entity)
        self.assertEqual([atom["atom_kind"] for atom in names], ["property_get"])
        self.assertTrue(names[0]["member"]["signature"].startswith("System.String get_Name("))

        colors = self.atoms_named(atoms, "Color", entity)
        self.assertEqual(
            sorted(atom["atom_kind"] for atom in colors),
            ["property_get", "property_set"],
        )

        events = self.atoms_named(atoms, "Modified", entity)
        self.assertEqual(
            sorted(atom["atom_kind"] for atom in events),
            ["event_subscribe", "event_unsubscribe"],
        )

        extract = self.atoms_named(atoms, "Extract", "THCADPickUp.Interop.IPickUpConfig")
        self.assertEqual(len(extract), 1)
        self.assertEqual(extract[0]["surface_metadata"]["bitness"], "32-bit")
        self.assertEqual(extract[0]["source_artifact"]["name"], "THCADPickUp")

        erases = self.atoms_named(atoms, "Erase")
        self.assertEqual(len(erases), 2)
        declaring = {atom["declaring_symbol"]["full_name"] for atom in erases}
        self.assertEqual(
            declaring,
            {"BricscadDb.Interop.IAcadEntity", "BricscadDb.Interop.IAcadObject"},
        )
        self.assertEqual(len({atom["atom_id"] for atom in erases}), 2)

        for atom in atoms:
            self.assertEqual(atom["atom_id"], canonical_atom_id("com", atom["canonical_key"]))
            expected_key = canonical_com_key(
                artifact_id=atom["source_artifact"]["artifact_id"],
                declaring=atom["declaring_symbol"]["full_name"],
                atom_kind=atom["atom_kind"],
                signature=atom["member"]["signature"],
            )
            self.assertEqual(atom["canonical_key"], expected_key)
            self.assertEqual(atom["provenance"]["extractor"], EXTRACTOR_NAME)

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
            self.assertEqual(first_manifest["counts"]["atoms"], 12)
            self.assertEqual(
                first_manifest["counts"]["by_kind"],
                {
                    "event_subscribe": 1,
                    "event_unsubscribe": 1,
                    "method": 5,
                    "progid_activation": 2,
                    "property_get": 2,
                    "property_set": 1,
                },
            )
            snapshot = load_catalog(
                first / "inventory-manifest.json",
                first / "capability-atoms.jsonl",
                [],
            )
            self.assertEqual(snapshot.progress()["raw_total"], 12)
            self.assertEqual(snapshot.progress()["pending"], 12)
            self.assertEqual(first_manifest["atoms_sha256"], hashlib.sha256(first_bytes).hexdigest())
            self.assertNotEqual(first_manifest["captured_at"], second_manifest["captured_at"])

            text = first_bytes.decode("utf-8")
            self.assertNotRegex(text, r"(?i)[a-z]:[\\/]")
            self.assertNotIn("\\\\", text)
            for line in text.splitlines():
                record = json.loads(line)
                self.assertEqual(record["atom_id"], canonical_atom_id("com", record["canonical_key"]))
                self.assertEqual(record["schema_version"], "1.0")


if __name__ == "__main__":
    unittest.main()
