from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from data.pipelines.cad_capabilities.catalog_queue import (
    canonical_atom_id,
    load_catalog,
)
from data.pipelines.cad_capabilities.lisp_command_atoms import (
    EXTRACTOR_NAME,
    atomize_scan,
    canonical_lisp_key,
    emit_inventories,
    extract_command_tokens,
    parse_cui_document,
    parse_lsp_definitions,
    sanitize_text,
    scan_cui_file,
    scan_lsp_file,
)


def sha(fill: str) -> str:
    return (fill * 64)[:64]


class LispCommandAtomizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scan = {
            "observed_host_id": "thcad-v24",
            "captured_at": "2026-08-28T00:00:00Z",
            "lisp_inventory_id": "thcad-v24.lisp.test",
            "command_inventory_id": "thcad-v24.command.test",
            "lsp_files": [
                {
                    "relative_path": "custom.lsp",
                    "bytes": 40,
                    "sha256": sha("a"),
                    "definitions": [
                        {"name": "Helper", "line": 4, "is_command": False},
                        {"name": "c:DrawLine", "line": 12, "is_command": True},
                    ],
                },
                {
                    "relative_path": "other.lsp",
                    "bytes": 20,
                    "sha256": sha("b"),
                    "definitions": [
                        {"name": "helper", "line": 2, "is_command": False},
                    ],
                },
            ],
            "cui_files": [
                {
                    "relative_path": "PCCAD.cui",
                    "bytes": 100,
                    "sha256": sha("c"),
                    "parse_error": None,
                    "macros": [
                        {
                            "name": "Line",
                            "command": "^C^C_LINE",
                            "command_tokens": ["LINE"],
                            "menu_macro_uid": "M1",
                        },
                        {
                            "name": "Line Copy",
                            "command": "^c^c_line",
                            "command_tokens": ["LINE"],
                            "menu_macro_uid": "M2",
                        },
                        {
                            "name": "Offset",
                            "command": "^C^C_OFFSET",
                            "command_tokens": ["OFFSET"],
                            "menu_macro_uid": "M3",
                        },
                    ],
                },
                {
                    "relative_path": "broken.cui",
                    "bytes": 8,
                    "sha256": sha("d"),
                    "parse_error": "unclosed token",
                    "macros": [],
                },
            ],
            "runtime": {
                "host": "THCAD (试用)",
                "version": "23.0 THCAD",
                "drawing": "sample.DWG",
                "atoms": ["Helper", "C:DrawLine", "vl-load-com", "C:LINE"],
                "arx": ["td_db.tx"],
                "vlx": ["one.vlx"],
                "variables": ["LISPENABLED=nil"],
            },
        }

    def test_parse_lsp_definitions_file_line_and_command(self) -> None:
        content = "; comment\n(defun Helper (/ x)\n  x)\n(defun-q c:DrawLine () (princ))\n"
        rows = parse_lsp_definitions(content)
        self.assertEqual(
            rows,
            [
                {"name": "Helper", "line": 2, "is_command": False},
                {"name": "c:DrawLine", "line": 4, "is_command": True},
            ],
        )

    def test_extract_tokens_and_cui_parse_error(self) -> None:
        self.assertEqual(extract_command_tokens("^C^C_LINE;^c^c_line;noop"), ["LINE"])
        self.assertEqual(extract_command_tokens("^c^c._vpoint;_rotate"), [])
        self.assertEqual(sanitize_text("^c^c_circle;\\\\"), "^c^c_circle;\\\\")
        self.assertIn("https://", sanitize_text("$M=^c^c_url;https://example.com"))
        self.assertEqual(sanitize_text("open D:\\THSOFT\\file.lsp"), "open [ABS_PATH]")
        macros, error = parse_cui_document("<not xml")
        self.assertEqual(macros, [])
        self.assertIsNotNone(error)
        parsed, ok = parse_cui_document(
            """
            <CustSection>
              <MenuMacro UID="M1">
                <Macro><Name>Line</Name><Command>^C^C_LINE</Command></Macro>
              </MenuMacro>
            </CustSection>
            """
        )
        self.assertIsNone(ok)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["name"], "Line")
        self.assertEqual(parsed[0]["command_tokens"], ["LINE"])
        self.assertEqual(parsed[0]["menu_macro_uid"], "M1")

    def test_scan_helpers_on_temp_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lsp = root / "sample.lsp"
            lsp.write_bytes(b"(defun Foo () 1)\r\n(defun C:Bar () 2)\n")
            cui = root / "menu.cui"
            cui.write_text(
                "<CustSection><Macro><Name>X</Name><Command>^C^C_ERASE</Command></Macro></CustSection>",
                encoding="utf-8",
            )
            broken = root / "bad.cui"
            broken.write_text("<CustSection>", encoding="utf-8")
            lsp_scan = scan_lsp_file(lsp, root)
            self.assertEqual(lsp_scan["relative_path"], "sample.lsp")
            self.assertEqual(lsp_scan["definitions"][0]["line"], 1)
            self.assertTrue(lsp_scan["definitions"][1]["is_command"])
            cui_scan = scan_cui_file(cui, root)
            self.assertEqual(cui_scan["macros"][0]["command_tokens"], ["ERASE"])
            self.assertIsNone(cui_scan["parse_error"])
            broken_scan = scan_cui_file(broken, root)
            self.assertTrue(broken_scan["parse_error"])
            self.assertEqual(broken_scan["macros"], [])

    def _lisp_atoms(self) -> list[dict]:
        atoms, _counts, _artifacts = atomize_scan(self.scan, surface="lisp")
        return atoms

    def _command_pack(self) -> tuple[list[dict], dict[str, int], list[dict]]:
        return atomize_scan(self.scan, surface="command")

    def test_atomizer_source_lisp_function_has_file_line(self) -> None:
        atoms = self._lisp_atoms()
        custom = next(
            atom
            for atom in atoms
            if atom["atom_kind"] == "lisp_function"
            and atom["provenance"]["source_locator"].get("file") == "custom.lsp"
            and atom["member"]["name"] == "Helper"
        )
        locator = custom["provenance"]["source_locator"]
        self.assertEqual(locator["line"], 4)
        self.assertEqual(locator["evidence_path"], "lsp_source")
        self.assertEqual(custom["surface_metadata"]["line"], 4)
        self.assertIn("line:4", custom["canonical_key"])
        self.assertEqual(custom["atom_id"], canonical_atom_id("lisp", custom["canonical_key"]))
        self.assertEqual(
            custom["canonical_key"],
            canonical_lisp_key(
                artifact_id="lsp:custom.lsp",
                atom_kind="lisp_function",
                name="Helper",
                evidence_path="lsp_source",
                line=4,
            ),
        )
        self.assertEqual(custom["provenance"]["extractor"], EXTRACTOR_NAME)

    def test_atomizer_case_normalization(self) -> None:
        lisp_atoms = self._lisp_atoms()
        command_atoms, _counts, _artifacts = self._command_pack()
        source_helpers = [
            atom
            for atom in lisp_atoms
            if atom["provenance"]["source_locator"].get("evidence_path") == "lsp_source"
            and atom["member"]["name"].casefold() == "helper"
        ]
        self.assertEqual(len(source_helpers), 2)
        self.assertEqual({atom["member"]["name"] for atom in source_helpers}, {"Helper", "helper"})
        normalized = {atom["canonical_key"].split("|")[3] for atom in source_helpers}
        self.assertEqual(normalized, {"helper"})
        tokens = [
            atom
            for atom in command_atoms
            if atom["atom_kind"] == "command"
            and atom["provenance"]["source_locator"]["evidence_path"] == "cui_token"
        ]
        line_tokens = [atom for atom in tokens if atom["member"]["name"] == "LINE"]
        self.assertEqual(len(line_tokens), 1)
        macros_line = [
            atom
            for atom in command_atoms
            if atom["atom_kind"] == "macro" and "LINE" in atom["member"]["signature"].upper()
        ]
        self.assertEqual(len(macros_line), 2)

    def test_atomizer_same_name_distinct_sources(self) -> None:
        lisp_atoms = self._lisp_atoms()
        command_atoms, _counts, _artifacts = self._command_pack()
        helpers = [
            atom
            for atom in lisp_atoms
            if atom["atom_kind"] == "lisp_function" and atom["member"]["name"].casefold() == "helper"
        ]
        self.assertEqual(len(helpers), 3)
        self.assertEqual(len({atom["atom_id"] for atom in helpers}), 3)
        evidence = {atom["provenance"]["source_locator"]["evidence_path"] for atom in helpers}
        self.assertEqual(evidence, {"lsp_source", "runtime"})
        files = {
            atom["provenance"]["source_locator"].get("file")
            for atom in helpers
            if atom["provenance"]["source_locator"]["evidence_path"] == "lsp_source"
        }
        self.assertEqual(files, {"custom.lsp", "other.lsp"})
        draw = [
            atom
            for atom in command_atoms
            if atom["atom_kind"] == "command" and atom["member"]["name"].upper().endswith("DRAWLINE")
        ]
        self.assertEqual(
            {atom["provenance"]["source_locator"]["evidence_path"] for atom in draw},
            {"source_defun", "runtime"},
        )
        self.assertEqual(len({atom["atom_id"] for atom in draw}), 2)

    def test_atomizer_macro_not_confused_with_command_token(self) -> None:
        command_atoms, _counts, _artifacts = self._command_pack()
        macros = [atom for atom in command_atoms if atom["atom_kind"] == "macro"]
        tokens = [
            atom
            for atom in command_atoms
            if atom["atom_kind"] == "command"
            and atom["provenance"]["source_locator"]["evidence_path"] == "cui_token"
        ]
        self.assertEqual(len(macros), 3)
        self.assertEqual(len(tokens), 2)
        self.assertEqual({atom["atom_kind"] for atom in macros}, {"macro"})
        self.assertEqual({atom["atom_kind"] for atom in tokens}, {"command"})
        for atom in macros:
            command = atom["surface_metadata"]["command"]
            self.assertIn(command, atom["member"]["signature"])
            self.assertTrue(atom["member"]["signature"].startswith("MACRO "))
        self.assertTrue(all(atom["member"]["signature"].startswith("COMMAND TOKEN ") for atom in tokens))
        self.assertEqual({atom["member"]["name"] for atom in tokens}, {"LINE", "OFFSET"})
        for atom in command_atoms:
            self.assertEqual(atom["atom_id"], canonical_atom_id("command", atom["canonical_key"]))

    def test_atomizer_cui_parse_error_accounted(self) -> None:
        command_atoms, source_counts, artifacts = self._command_pack()
        self.assertEqual(source_counts["cui_parse_errors"], 1)
        self.assertEqual(source_counts["cui_files"], 2)
        self.assertIn("cui:broken.cui", {item["artifact_id"] for item in artifacts})
        self.assertFalse(
            any(
                atom["source_artifact"]["artifact_id"] == "cui:broken.cui"
                for atom in command_atoms
            )
        )
        self.assertEqual(source_counts["menu_macros"], 3)

    def test_emit_two_inventories_stable_valid_path_free(self) -> None:
        with tempfile.TemporaryDirectory() as first_dir, tempfile.TemporaryDirectory() as second_dir:
            first = Path(first_dir)
            second = Path(second_dir)
            first_manifests = emit_inventories(
                self.scan,
                lisp_output_dir=first / "lisp",
                command_output_dir=first / "command",
                captured_at="2026-08-28T00:00:00Z",
            )
            second_manifests = emit_inventories(
                self.scan,
                lisp_output_dir=second / "lisp",
                command_output_dir=second / "command",
                captured_at="2026-08-28T01:00:00Z",
            )
            for surface in ("lisp", "command"):
                first_bytes = (first / surface / "capability-atoms.jsonl").read_bytes()
                second_bytes = (second / surface / "capability-atoms.jsonl").read_bytes()
                self.assertEqual(first_bytes, second_bytes)
                self.assertTrue(first_bytes.endswith(b"\n"))
                self.assertNotIn(b"\r", first_bytes)
                self.assertNotRegex(first_bytes.decode("utf-8"), r"(?i)[a-z]:[\\/]")
                self.assertNotIn("\\\\", first_bytes.decode("utf-8"))
                snapshot = load_catalog(
                    first / surface / "inventory-manifest.json",
                    first / surface / "capability-atoms.jsonl",
                    [],
                )
                self.assertEqual(snapshot.progress()["pending"], snapshot.progress()["raw_total"])
                self.assertGreater(snapshot.progress()["raw_total"], 0)
                self.assertEqual(
                    first_manifests[surface]["atoms_sha256"],
                    hashlib.sha256(first_bytes).hexdigest(),
                )
                self.assertEqual(first_manifests[surface]["surface"], surface)
                self.assertNotEqual(
                    first_manifests[surface]["captured_at"],
                    second_manifests[surface]["captured_at"],
                )
            self.assertEqual(first_manifests["command"]["counts"]["source"]["cui_parse_errors"], 1)
            self.assertIn("macro", first_manifests["command"]["counts"]["by_kind"])
            self.assertIn("command", first_manifests["command"]["counts"]["by_kind"])
            self.assertEqual(first_manifests["lisp"]["counts"]["by_kind"].get("lisp_function"), 4)


if __name__ == "__main__":
    unittest.main()
