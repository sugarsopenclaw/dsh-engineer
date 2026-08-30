from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from data.pipelines.cad_capabilities.catalog_queue import canonical_atom_id
from data.pipelines.cad_capabilities.com_atoms import atomize_scan, emit_inventory
from data.pipelines.cad_capabilities.com_enrichment import classify_atom as classify_com
from data.pipelines.cad_capabilities.dotnet_enrichment import (
    classify_atom as classify_dotnet,
    is_entity_explode_geometry,
)
from data.pipelines.cad_capabilities.host_isolation import (
    HostIsolationError,
    guard_inventory_write,
)
from data.pipelines.cad_capabilities.lisp_command_atoms import scan_cui_file


def sha(fill: str) -> str:
    return (fill * 64)[:64]


def com_scan(*, inventory_id: str, observed_host_id: str) -> dict[str, object]:
    return {
        "inventory_id": inventory_id,
        "observed_host_id": observed_host_id,
        "type_libraries": [
            {
                "label": "AutoCAD",
                "bitness": "64-bit",
                "file_name": "acax24chs.tlb",
                "version": "24.3",
                "sha256": sha("a"),
                "interface_count": 1,
                "declared_method_count": 1,
                "declared_property_count": 1,
                "declared_event_count": 0,
                "reflection_errors": [],
                "interfaces": [
                    {
                        "name": "IAcadEntity",
                        "full_name": "Autodesk.AutoCAD.Interop.Common.IAcadEntity",
                        "kind": "interface",
                        "methods": [
                            {
                                "name": "Erase",
                                "return_type": "System.Void",
                                "is_static": False,
                                "dispid": 12,
                                "parameters": [],
                            }
                        ],
                        "properties": [
                            {
                                "name": "Layer",
                                "type": "System.String",
                                "can_read": True,
                                "can_write": True,
                                "is_static": False,
                                "dispid": 20,
                                "parameters": [],
                            }
                        ],
                        "events": [],
                    }
                ],
            }
        ],
        "progids": [
            {
                "prog_id": "AutoCAD.Application.24",
                "clsid": "{8B4929F8-076F-4AEC-AFEE-8928747B7AE3}",
                "server_kind": "local",
                "type_lib": "{AA9A2205-75AA-43AD-9138-1767F1BB5E0C}",
                "registry_view": "64-bit",
            }
        ],
        "conversion_errors": [],
        "reflection_errors": [],
    }


def dotnet_atom(*, host_id: str, inventory_id: str, declaring: str | None = None) -> dict[str, object]:
    if declaring is None:
        declaring = (
            "Teigha.DatabaseServices.Entity"
            if host_id != "autocad-2024"
            else "Autodesk.AutoCAD.DatabaseServices.Entity"
        )
    signature = f"System.Void ExplodeGeometry({declaring.replace('Entity', 'DBObjectCollection')} entitySet)"
    canonical_key = f"dotnet|TD_Mgd|{declaring}|method|{signature}"
    return {
        "schema_version": "1.0",
        "inventory_id": inventory_id,
        "atom_id": canonical_atom_id("dotnet", canonical_key),
        "canonical_key": canonical_key,
        "surface": "dotnet",
        "atom_kind": "method",
        "observed_host_ids": [host_id],
        "source_artifact": {
            "artifact_id": "assembly:acdbmgd",
            "kind": "assembly",
            "name": "acdbmgd",
            "version": "24.3.0.0",
            "sha256": "a" * 64,
        },
        "declaring_symbol": {
            "symbol_id": f"dotnet-type:acdbmgd:{declaring}",
            "full_name": declaring,
            "kind": "class",
        },
        "member": {
            "name": "ExplodeGeometry",
            "signature": signature,
            "return_type": "System.Void",
            "parameters": [],
            "is_static": False,
        },
        "provenance": {
            "extractor": "test-exporter",
            "extractor_version": "1.0",
            "source_locator": {"member": "ExplodeGeometry"},
        },
        "surface_metadata": {"assembly": "acdbmgd"},
    }


class AutoCadIsolationTests(unittest.TestCase):
    def test_guard_rejects_thcad_inventory_for_autocad_host(self) -> None:
        with self.assertRaises(HostIsolationError) as context:
            guard_inventory_write(
                "thcad-v24.com",
                "autocad-2024",
                Path("data/datasets/staging/cad-capabilities/autocad-2024.com"),
            )
        self.assertIn("thcad-v24", str(context.exception))

    def test_emit_rejects_thcad_inventory_and_output_directory(self) -> None:
        scan = com_scan(inventory_id="thcad-v24.com", observed_host_id="autocad-2024")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(Exception) as mixed:
                emit_inventory(scan, Path(directory), captured_at="2026-08-28T00:00:00Z")
            self.assertIn("thcad-v24", str(mixed.exception).casefold() + str(type(mixed.exception)))

        autocad_scan = com_scan(inventory_id="autocad-2024.com", observed_host_id="autocad-2024")
        with tempfile.TemporaryDirectory() as directory:
            forbidden = Path(directory) / "thcad-v24.com"
            with self.assertRaises(Exception) as targeted:
                emit_inventory(autocad_scan, forbidden, captured_at="2026-08-28T00:00:00Z")
            self.assertIn("thcad-v24", str(targeted.exception).casefold())

    def test_atomize_autocad_scan_uses_host_and_canonical_id(self) -> None:
        scan = com_scan(inventory_id="autocad-2024.com", observed_host_id="autocad-2024")
        atoms, _counts, artifacts = atomize_scan(scan)
        self.assertGreater(len(atoms), 0)
        for atom in atoms:
            self.assertEqual(atom["observed_host_ids"], ["autocad-2024"])
            self.assertEqual(atom["inventory_id"], "autocad-2024.com")
            self.assertEqual(atom["atom_id"], canonical_atom_id("com", atom["canonical_key"]))
            blob = json.dumps(atom).casefold()
            self.assertNotIn("thcad-v24", blob)
            self.assertNotIn("bricscad", blob)
            # Shared kernel provenance.extractor may still be ExportThcadComCapabilityAtoms.
            host_fields = json.dumps(
                {
                    "inventory_id": atom["inventory_id"],
                    "observed_host_ids": atom["observed_host_ids"],
                    "source_artifact": atom["source_artifact"],
                    "declaring_symbol": atom["declaring_symbol"],
                    "member": atom["member"],
                    "surface_metadata": atom.get("surface_metadata"),
                }
            ).casefold()
            self.assertNotIn("thcad", host_fields)
            self.assertNotIn("thsoft", host_fields)
        registry = next(item for item in artifacts if item["artifact_id"] == "registry:hkcr-progid")
        self.assertEqual(registry["name"], "HKCR ProgID (AutoCAD.*)")

    def test_classify_autocad_atom_has_empty_semantic_candidates(self) -> None:
        scan = com_scan(inventory_id="autocad-2024.com", observed_host_id="autocad-2024")
        atoms, _, _ = atomize_scan(scan)
        for atom in atoms:
            enrichment = classify_com(atom, processed_at="2026-08-28T00:00:00Z")
            self.assertEqual(enrichment["semantic_candidates"], [])
            self.assertTrue(enrichment["status"] in {"classified", "deferred", "failed"})
            self.assertTrue(enrichment["summary"] or enrichment["notes"])

    def test_classify_autocad_atom_never_attaches_thcad_runtime_evidence(self) -> None:
        lookalike = dotnet_atom(
            host_id="autocad-2024",
            inventory_id="autocad-2024.dotnet",
            declaring="Teigha.DatabaseServices.Entity",
        )
        self.assertFalse(is_entity_explode_geometry(lookalike))
        atom = dotnet_atom(host_id="autocad-2024", inventory_id="autocad-2024.dotnet")
        enrichment = classify_dotnet(atom, processed_at="2026-08-28T00:00:00Z")
        lookalike_enrichment = classify_dotnet(lookalike, processed_at="2026-08-28T00:00:00Z")
        blob = json.dumps(enrichment, ensure_ascii=False).casefold()
        lookalike_blob = json.dumps(lookalike_enrichment, ensure_ascii=False).casefold()
        self.assertEqual(enrichment["semantic_candidates"], [])
        self.assertEqual(lookalike_enrichment["semantic_candidates"], [])
        self.assertFalse(any(item.get("kind") == "runtime_probe" for item in enrichment["evidence"]))
        self.assertFalse(any(item.get("kind") == "runtime_probe" for item in lookalike_enrichment["evidence"]))
        self.assertNotIn("th_xuhaoentity", blob)
        self.assertNotIn("th_xuhaoentity", lookalike_blob)
        self.assertNotIn("teigha", blob)
        self.assertNotIn("thcad", blob)

    def test_thcad_explode_geometry_evidence_still_attaches(self) -> None:
        atom = dotnet_atom(host_id="thcad-v24", inventory_id="thcad-v24.dotnet.test")
        self.assertTrue(is_entity_explode_geometry(atom))
        enrichment = classify_dotnet(atom, processed_at="2026-08-28T00:00:00Z")
        self.assertTrue(any(item.get("kind") == "runtime_probe" for item in enrichment["evidence"]))
        self.assertTrue(enrichment["semantic_candidates"])

    def test_scan_cuix_zip_extracts_macros(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cui_xml = (
                "<CustSection><MenuMacro UID='M1'><Macro>"
                "<Name>Line</Name><Command>^C^C_LINE</Command>"
                "</Macro></MenuMacro></CustSection>"
            )
            archive = root / "acad.cuix"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("MenuGroup.cui", cui_xml)
            scanned = scan_cui_file(archive, root)
            self.assertIsNone(scanned["parse_error"])
            self.assertEqual(len(scanned["macros"]), 1)
            self.assertEqual(scanned["macros"][0]["command_tokens"], ["LINE"])
            self.assertEqual(scanned["macros"][0]["archive_member"], "MenuGroup.cui")


if __name__ == "__main__":
    unittest.main()
