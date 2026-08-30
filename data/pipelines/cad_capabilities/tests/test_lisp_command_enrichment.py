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
)
from data.pipelines.cad_capabilities.com_enrichment import (
    run_loop,
    semantic_candidate_allowed,
)
from data.pipelines.cad_capabilities.lisp_command_enrichment import classify_atom


def write_jsonl(path: Path, records: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
        newline="\n",
    )


class LispCommandEnrichmentRuleTests(unittest.TestCase):
    def make_atom(
        self,
        *,
        name: str,
        atom_kind: str,
        evidence_path: str,
        inventory_id: str = "thcad-v24.lisp.test",
        surface: str = "lisp",
        file_name: str | None = None,
        line: int | None = None,
        command: str | None = None,
        tokens: list[str] | None = None,
        signature: str | None = None,
    ) -> dict[str, object]:
        locator: dict[str, object] = {"evidence_path": evidence_path, "symbol": name}
        metadata: dict[str, object] = {"evidence_path": evidence_path}
        if file_name is not None:
            locator["file"] = file_name
            metadata["file"] = file_name
        if line is not None:
            locator["line"] = line
            metadata["line"] = line
        if atom_kind == "macro":
            locator["macro_name"] = name
            metadata["command"] = command or ""
            metadata["command_tokens"] = tokens or []
        if evidence_path == "cui_token":
            locator["token"] = name
            metadata["token"] = name
        if signature is None:
            if atom_kind == "macro":
                signature = f"MACRO {name} :: {command or ''}"
            elif atom_kind == "command" and evidence_path == "cui_token":
                signature = f"COMMAND TOKEN {name}"
            elif atom_kind == "command" and evidence_path == "runtime":
                signature = name
            else:
                signature = f"(defun {name})"
        canonical_key = f"{surface}|{evidence_path}|{atom_kind}|{name}|{file_name or 'runtime'}|{line or 0}|{command or ''}"
        artifact_id = f"lsp:{file_name}" if file_name and evidence_path in {"lsp_source", "source_defun"} else (
            f"cui:{file_name}" if file_name else "session:thcad-v24"
        )
        return {
            "schema_version": "1.0",
            "inventory_id": inventory_id,
            "atom_id": canonical_atom_id(surface, canonical_key),
            "canonical_key": canonical_key,
            "surface": surface,
            "atom_kind": atom_kind,
            "observed_host_ids": ["thcad-v24"],
            "source_artifact": {
                "artifact_id": artifact_id,
                "kind": "lsp" if artifact_id.startswith("lsp:") else ("cui" if artifact_id.startswith("cui:") else "runtime-session"),
                "name": file_name or "THCAD (试用)",
                "version": None,
                "sha256": "a" * 64,
            },
            "declaring_symbol": {
                "symbol_id": f"{surface}:{file_name or 'runtime'}",
                "full_name": file_name or "runtime.atoms-family",
                "kind": "lsp" if file_name else "runtime-session",
            },
            "member": {
                "name": name,
                "signature": signature,
                "return_type": None,
                "parameters": [],
                "is_static": True,
            },
            "provenance": {
                "extractor": "test-exporter",
                "extractor_version": "1.0",
                "source_locator": locator,
            },
            "surface_metadata": metadata,
        }

    def classify(self, atom: dict[str, object]) -> dict[str, object]:
        return classify_atom(atom, processed_at="2026-08-28T00:00:00Z")

    def test_source_lisp_function_attaches_source_code_file_line(self) -> None:
        atom = self.make_atom(
            name="Helper",
            atom_kind="lisp_function",
            evidence_path="lsp_source",
            file_name="custom.lsp",
            line=4,
        )
        enrichment = self.classify(atom)
        self.assertEqual(enrichment["status"], "classified")
        self.assertIn("invoke", enrichment["operation_kinds"])
        refs = [item["ref"] for item in enrichment["evidence"] if item["kind"] == "source_code"]
        self.assertEqual(refs, ["custom.lsp:4"])
        self.assertTrue(any("第 4 行" in item["claim"] for item in enrichment["evidence"]))
        self.assertFalse(any(candidate["status"] == "verified" for candidate in enrichment["semantic_candidates"]))

    def test_runtime_only_name_is_deferred_not_verified(self) -> None:
        atom = self.make_atom(
            name="ACDIMENABLEUPDATE",
            atom_kind="lisp_function",
            evidence_path="runtime",
        )
        enrichment = self.classify(atom)
        self.assertEqual(enrichment["status"], "deferred")
        self.assertIn("unknown", enrichment["operation_kinds"])
        self.assertIn("参数协议", enrichment["notes"])
        self.assertFalse(any(candidate["status"] == "verified" for candidate in enrichment["semantic_candidates"]))
        runtime_command = self.make_atom(
            name="C:LINE",
            atom_kind="command",
            evidence_path="runtime",
            inventory_id="thcad-v24.command.test",
            surface="command",
        )
        command_enrichment = self.classify(runtime_command)
        self.assertEqual(command_enrichment["status"], "deferred")
        self.assertIn("unknown", command_enrichment["operation_kinds"])
        self.assertFalse(
            any(candidate["status"] == "verified" for candidate in command_enrichment["semantic_candidates"])
        )

    def test_macro_summary_is_orchestration_not_inner_command(self) -> None:
        atom = self.make_atom(
            name="打印...",
            atom_kind="macro",
            evidence_path="cui_macro",
            inventory_id="thcad-v24.command.test",
            surface="command",
            file_name="default_2D.CUI",
            command="^c^c_print;_qsave",
            tokens=["PRINT", "QSAVE"],
        )
        enrichment = self.classify(atom)
        self.assertEqual(enrichment["status"], "classified")
        summary = enrichment["summary"]
        self.assertIsInstance(summary, str)
        self.assertIn("编排入口", summary)
        self.assertIn("^c^c_print;_qsave", summary)
        self.assertIn("不得把串内多个命令的综合效果归到其中任意单个命令", summary)
        self.assertNotIn("该宏就是 PRINT", summary)
        self.assertTrue(all(candidate["status"] == "proposed" for candidate in enrichment["semantic_candidates"]))
        self.assertTrue(any(candidate["semantic_capability_id"] == "sem:cad.macro.sequence" for candidate in enrichment["semantic_candidates"]))

    def test_name_title_and_macro_candidates_are_proposed_only(self) -> None:
        token = self.make_atom(
            name="LINE",
            atom_kind="command",
            evidence_path="cui_token",
            inventory_id="thcad-v24.command.test",
            surface="command",
            file_name="PCCAD.cui",
        )
        source_cmd = self.make_atom(
            name="c:DrawLine",
            atom_kind="command",
            evidence_path="source_defun",
            inventory_id="thcad-v24.command.test",
            surface="command",
            file_name="custom.lsp",
            line=12,
        )
        for atom in (token, source_cmd):
            enrichment = self.classify(atom)
            self.assertEqual(enrichment["status"], "classified")
            self.assertTrue(enrichment["semantic_candidates"])
            self.assertTrue(all(candidate["status"] == "proposed" for candidate in enrichment["semantic_candidates"]))
            self.assertTrue(all(semantic_candidate_allowed(candidate, enrichment["evidence"]) for candidate in enrichment["semantic_candidates"]))

    def test_same_name_different_sources_stay_two_enrichments(self) -> None:
        source = self.make_atom(
            name="c:DrawLine",
            atom_kind="command",
            evidence_path="source_defun",
            inventory_id="thcad-v24.command.test",
            surface="command",
            file_name="custom.lsp",
            line=12,
        )
        runtime = self.make_atom(
            name="C:DrawLine",
            atom_kind="command",
            evidence_path="runtime",
            inventory_id="thcad-v24.command.test",
            surface="command",
        )
        token = self.make_atom(
            name="DRAWLINE",
            atom_kind="command",
            evidence_path="cui_token",
            inventory_id="thcad-v24.command.test",
            surface="command",
            file_name="PCCAD.cui",
        )
        enrichments = [self.classify(atom) for atom in (source, runtime, token)]
        ids = [item["atom_id"] for item in enrichments]
        self.assertEqual(len(ids), 3)
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual({item["atom_id"] for item in enrichments}, {atom["atom_id"] for atom in (source, runtime, token)})


class LispCommandEnrichmentQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.atoms_path = self.root / "capability-atoms.jsonl"
        self.manifest_path = self.root / "inventory-manifest.json"
        self.enrichments = self.root / "enrichments"
        self.batches = self.root / "batches"
        helper = LispCommandEnrichmentRuleTests()
        self.atoms = [
            helper.make_atom(
                name="Helper",
                atom_kind="lisp_function",
                evidence_path="lsp_source",
                file_name="custom.lsp",
                line=4,
            ),
            helper.make_atom(name="RUNTIMEFN", atom_kind="lisp_function", evidence_path="runtime"),
            helper.make_atom(
                name="c:DrawLine",
                atom_kind="command",
                evidence_path="source_defun",
                inventory_id="thcad-v24.lisp.test",
                surface="lisp",
                file_name="custom.lsp",
                line=12,
            ),
            helper.make_atom(
                name="打印...",
                atom_kind="macro",
                evidence_path="cui_macro",
                inventory_id="thcad-v24.lisp.test",
                surface="lisp",
                file_name="menu.cui",
                command="^C^C_LINE",
                tokens=["LINE"],
            ),
            helper.make_atom(
                name="LINE",
                atom_kind="command",
                evidence_path="cui_token",
                inventory_id="thcad-v24.lisp.test",
                surface="lisp",
                file_name="menu.cui",
            ),
        ]
        for atom in self.atoms:
            atom["inventory_id"] = "thcad-v24.lisp.test"
            atom["surface"] = "lisp"
        self.atoms.sort(key=lambda atom: str(atom["atom_id"]))
        write_jsonl(self.atoms_path, self.atoms)
        counts: dict[str, int] = {}
        artifacts = []
        seen: set[str] = set()
        for atom in self.atoms:
            kind = str(atom["atom_kind"])
            counts[kind] = counts.get(kind, 0) + 1
            item = atom["source_artifact"]
            if item["artifact_id"] not in seen:
                artifacts.append(item)
                seen.add(item["artifact_id"])
        self.manifest_path.write_text(
            json.dumps(
                {
                    "schema_version": "1.0",
                    "inventory_id": "thcad-v24.lisp.test",
                    "surface": "lisp",
                    "observed_host_id": "thcad-v24",
                    "captured_at": "2026-08-28T00:00:00Z",
                    "extractor": {"name": "test-exporter", "version": "1.0"},
                    "source_artifacts": artifacts,
                    "atoms_file": "capability-atoms.jsonl",
                    "atoms_sha256": hashlib.sha256(self.atoms_path.read_bytes()).hexdigest(),
                    "counts": {"atoms": len(self.atoms), "by_kind": counts, "source": {"lsp_files": 1}},
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_verified_without_probe_is_rejected(self) -> None:
        enrichment = classify_atom(self.atoms[0], processed_at="2026-08-28T00:00:00Z")
        enrichment["semantic_candidates"] = [
            {
                "semantic_capability_id": "sem:cad.lisp.function",
                "label": "函数",
                "confidence": 0.9,
                "status": "verified",
                "basis": "no probe",
            }
        ]
        write_jsonl(self.enrichments / "part-000001.jsonl", [enrichment])
        with self.assertRaisesRegex(CatalogValidationError, "verified requires"):
            load_catalog(self.manifest_path, self.atoms_path, [str(self.enrichments)])

    def test_run_loop_parts_are_disjoint_and_do_not_rewrite(self) -> None:
        original = hashlib.sha256(self.atoms_path.read_bytes()).hexdigest()
        first = run_loop(
            self.manifest_path,
            self.atoms_path,
            self.enrichments,
            self.batches,
            limit=2,
            processed_at="2026-08-28T00:00:00Z",
            classify=classify_atom,
        )
        self.assertEqual(first["pending"], 0)
        parts = sorted(self.enrichments.glob("part-*.jsonl"))
        self.assertGreaterEqual(len(parts), 2)
        first_ids = {
            json.loads(line)["atom_id"]
            for line in parts[0].read_text(encoding="utf-8").splitlines()
            if line
        }
        second_ids = {
            json.loads(line)["atom_id"]
            for line in parts[1].read_text(encoding="utf-8").splitlines()
            if line
        }
        self.assertTrue(first_ids.isdisjoint(second_ids))
        first_bytes = parts[0].read_bytes()
        run_loop(
            self.manifest_path,
            self.atoms_path,
            self.enrichments,
            self.batches,
            limit=2,
            processed_at="2026-08-28T00:00:00Z",
            classify=classify_atom,
        )
        self.assertEqual(parts[0].read_bytes(), first_bytes)
        self.assertEqual(hashlib.sha256(self.atoms_path.read_bytes()).hexdigest(), original)


if __name__ == "__main__":
    unittest.main()
