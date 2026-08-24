import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from flywheel.dataset import DatasetExportOptions, derive_label_status, export_dataset


class DatasetFixture:
    image_path = ".xiaoliang/cad/previews/plan--fixture/details/detail-0123456789.png"

    def __init__(self, root: Path) -> None:
        self.corpus = root / "corpus"
        self.project = self.corpus / "users" / "engineer@example.com" / "projects" / "project__demo"
        self.files = self.project / "files"
        self.files.mkdir(parents=True)
        self.database = sqlite3.connect(self.corpus / "index.sqlite")
        self.database.executescript(
            """
            CREATE TABLE traces (
              id TEXT PRIMARY KEY,
              child_run_id TEXT,
              conversation_archive_id TEXT,
              client_run_id TEXT
            );
            CREATE TABLE feedback (
              id TEXT PRIMARY KEY,
              client_run_id TEXT,
              local_conversation_id TEXT,
              local_message_id TEXT,
              pi_entry_id TEXT,
              vote TEXT,
              outcome TEXT,
              issue_codes_json TEXT,
              comment TEXT,
              created_at TEXT
            );
            """
        )

    def close_catalog(self) -> None:
        self.database.commit()
        self.database.close()

    def write_evidence(
        self,
        image_path: str | None = None,
        *,
        channel: str = "com_plot",
        full_payload: bool = False,
        extra_payload: dict | None = None,
    ) -> None:
        image_path = image_path or self.image_path
        image = self.files.joinpath(*image_path.split("/"))
        image.parent.mkdir(parents=True, exist_ok=True)
        image.write_bytes(b"png")
        entities = image.with_name(f"{image.stem}.entities.jsonl")
        entities.write_text('{"handle":"A1"}\n', encoding="utf-8")
        evidence = image.with_name(f"{image.stem}.evidence.json")
        payload = {
            "schema_version": 1,
            "evidence_id": image.stem,
            "image_path": image_path,
            "entities_file": entities.name,
            "dwg_sha256": "a" * 64,
            "plotted_window": {"min": [0, 0], "max": [10, 10]},
            "selection_semantics": "top_level_crossing",
            "channel": channel,
            "index": {"status": "valid"},
            "counts": {"scanned": 10, "matched": 1, "bbox_missing": 0, "parse_failed": 0},
        }
        if full_payload:
            # Every field the TS evidencePayload writer emits, mirroring detail-dataset.ts.
            payload["drawing"] = {
                "name": "plan.dwg",
                "project_relative_path": "drawings/plan.dwg",
                "saved": True,
                "dbmod": 0,
            }
            payload["request"] = {
                "handles": ["A1"],
                "padding_ratio": 0.15,
                "anchors": [{"handle": "A1", "bbox": {"min": [1, 1], "max": [2, 2]}}],
            }
            payload["index"] = {
                "status": "valid",
                "producer": "mlightcad",
                "generated_at": "2026-08-21T00:00:00.000Z",
            }
            payload["duration_ms"] = 42
        if extra_payload:
            payload.update(extra_payload)
        evidence.write_text(json.dumps(payload), encoding="utf-8")

    def write_conversation(
        self,
        *,
        conversation_id: str,
        local_conversation_id: str,
        client_run_id: str,
        include_main_citation: bool = False,
    ) -> Path:
        directory = self.project / "conversations" / f"{conversation_id}__fixture"
        directory.mkdir(parents=True)
        (directory / "conversation.json").write_text(json.dumps({
            "id": conversation_id,
            "local_conversation_id": local_conversation_id,
        }), encoding="utf-8")
        rows = [
            {
                "id": f"{conversation_id}-user",
                "ordinal": 0,
                "role": "user",
                "content": "这个区域的构件是什么？",
                "local_message_id": f"{conversation_id}-local-user",
            },
        ]
        if include_main_citation:
            rows.append({
                "id": f"{conversation_id}-evidence",
                "ordinal": 1,
                "role": "tool",
                "content": "",
                "tool_name": "cad_evidence_image",
                "tool_args": json.dumps({"path": self.image_path}),
                "client_run_id": client_run_id,
            })
        rows.append({
            "id": f"{conversation_id}-answer",
            "ordinal": 2,
            "role": "assistant",
            "content": "这是给排水立管及其尺寸标注。",
            "client_run_id": client_run_id,
            "local_message_id": f"{conversation_id}-local-answer",
            "pi_entry_id": f"{conversation_id}-pi-answer",
        })
        (directory / "messages.jsonl").write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
            encoding="utf-8",
        )
        return directory

    def write_trace(self, conversation_dir: Path, conversation_id: str, client_run_id: str) -> None:
        trace_id = f"trace-{conversation_id}"
        child_run_id = f"child-{conversation_id}"
        directory = conversation_dir / "traces" / f"cad_{child_run_id}"
        directory.mkdir(parents=True)
        (directory / "meta.json").write_text(json.dumps({
            "id": trace_id,
            "child_run_id": child_run_id,
        }), encoding="utf-8")
        tool_text = json.dumps({"ok": True, "data": {"image_path": self.image_path}})
        (directory / "trace.jsonl").write_text(json.dumps({
            "type": "tool_end",
            "toolName": "cad_detail",
            "result": {"content": [{"type": "text", "text": tool_text}]},
        }) + "\n", encoding="utf-8")
        self.database.execute(
            "INSERT INTO traces (id, child_run_id, conversation_archive_id, client_run_id) VALUES (?, ?, ?, ?)",
            (trace_id, child_run_id, conversation_id, client_run_id),
        )

    def catalog_trace(self, conversation_id: str, client_run_id: str, *, child_run_id: str) -> None:
        """Insert only the index.sqlite trace row, with no trace.jsonl on disk."""
        self.database.execute(
            "INSERT INTO traces (id, child_run_id, conversation_archive_id, client_run_id) VALUES (?, ?, ?, ?)",
            (f"trace-{conversation_id}", child_run_id, conversation_id, client_run_id),
        )

    def write_feedback(self, conversation_id: str, local_conversation_id: str, client_run_id: str) -> None:
        self.database.execute(
            """
            INSERT INTO feedback (
              id, client_run_id, local_conversation_id, local_message_id, pi_entry_id,
              vote, outcome, issue_codes_json, comment, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "feedback-1",
                client_run_id,
                local_conversation_id,
                f"{conversation_id}-local-answer",
                f"{conversation_id}-pi-answer",
                "up",
                "success",
                "[]",
                "结论正确",
                "2026-08-22T00:00:00+00:00",
            ),
        )


class DatasetExportTests(unittest.TestCase):
    def test_trace_join_uses_client_run_id_and_exports_stable_schema(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            fixture.write_evidence()
            conversation = fixture.write_conversation(
                conversation_id="conversation-1",
                local_conversation_id="local-1",
                client_run_id="run-1",
            )
            fixture.write_trace(conversation, "conversation-1", "run-1")
            fixture.write_feedback("conversation-1", "local-1", "run-1")
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))
            samples = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]

            self.assertEqual(result["sample_count"], 1)
            self.assertEqual(result["evidence_associations"], 1)
            self.assertEqual(len(samples), 1)
            sample = samples[0]
            self.assertEqual(set(sample), {
                "sample_id", "conversation_id", "client_run_id", "question", "final_answer",
                "evidences", "feedback", "label_status",
            })
            self.assertEqual(sample["conversation_id"], "conversation-1")
            self.assertEqual(sample["client_run_id"], "run-1")
            self.assertEqual(sample["question"], "这个区域的构件是什么？")
            self.assertEqual(sample["final_answer"], "这是给排水立管及其尺寸标注。")
            self.assertEqual(sample["label_status"], "user_confirmed")
            self.assertEqual(set(sample["feedback"]), {"vote", "outcome", "issue_codes", "comment"})
            self.assertEqual(set(sample["evidences"][0]), {
                "evidence_id", "image", "entities", "entity_count", "plotted_window",
                "dwg_sha256", "cited_by_main_agent",
            })
            self.assertFalse(sample["evidences"][0]["cited_by_main_agent"])
            self.assertTrue(sample["evidences"][0]["image"].endswith("detail-0123456789.png"))
            self.assertTrue(sample["evidences"][0]["entities"].endswith("detail-0123456789.entities.jsonl"))

    def test_missing_trace_falls_back_to_exact_main_agent_image_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            fixture.write_evidence()
            fixture.write_conversation(
                conversation_id="conversation-2",
                local_conversation_id="local-2",
                client_run_id="run-2",
                include_main_citation=True,
            )
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))
            sample = json.loads(output.read_text(encoding="utf-8").strip())

            self.assertEqual(result["sample_count"], 1)
            self.assertEqual(sample["client_run_id"], "run-2")
            self.assertTrue(sample["evidences"][0]["cited_by_main_agent"])
            self.assertEqual(sample["label_status"], "unverified")

    def test_label_status_prioritizes_rejection_then_confirmation(self) -> None:
        self.assertEqual(derive_label_status(None), "unverified")
        self.assertEqual(derive_label_status({"vote": None, "outcome": None}), "unverified")
        self.assertEqual(derive_label_status({"vote": "up", "outcome": None}), "user_confirmed")
        self.assertEqual(derive_label_status({"vote": None, "outcome": "success"}), "user_confirmed")
        self.assertEqual(derive_label_status({"vote": "up", "outcome": "failure"}), "user_rejected")
        self.assertEqual(derive_label_status({"vote": "down", "outcome": "success"}), "user_rejected")

    def test_mlight_render_evidence_round_trips_from_any_previews_subdirectory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            fixture.image_path = ".xiaoliang/cad/previews/plan--fixture/mlight/detail-mlight001.png"
            fixture.write_evidence(channel="mlight_render", full_payload=True)
            conversation = fixture.write_conversation(
                conversation_id="conversation-3",
                local_conversation_id="local-3",
                client_run_id="run-3",
            )
            fixture.write_trace(conversation, "conversation-3", "run-3")
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))
            samples = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]

            self.assertEqual(result["sample_count"], 1)
            self.assertEqual(result["evidence_invalid"], 0)
            self.assertEqual(result["warnings"], [])
            evidence = samples[0]["evidences"][0]
            self.assertTrue(evidence["image"].endswith("mlight/detail-mlight001.png"))
            self.assertTrue(evidence["entities"].endswith("detail-mlight001.entities.jsonl"))

    def test_non_detail_image_path_is_counted_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            # The evidence file matches the detail-*.evidence.json scan glob, but its
            # image_path is not a detail artifact and must be rejected.
            evidence_file = fixture.files.joinpath(
                *".xiaoliang/cad/previews/plan--fixture/details/detail-bad001.evidence.json".split("/")
            )
            evidence_file.parent.mkdir(parents=True, exist_ok=True)
            evidence_file.write_text(json.dumps({
                "schema_version": 1,
                "evidence_id": "detail-bad001",
                "image_path": ".xiaoliang/cad/previews/plan--fixture/captures/frame-01/region-1.png",
                "entities_file": None,
                "dwg_sha256": None,
                "plotted_window": {"min": [0, 0], "max": [10, 10]},
                "selection_semantics": "top_level_crossing",
                "channel": "com_plot",
                "index": {"status": "missing"},
                "counts": {"scanned": 0, "matched": 0, "bbox_missing": 0, "parse_failed": 0},
            }), encoding="utf-8")
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))

            self.assertEqual(result["sample_count"], 0)
            self.assertEqual(result["evidence_scanned"], 1)
            self.assertEqual(result["evidence_invalid"], 1)

    def test_missing_sqlite_warns_and_still_exports_via_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            fixture.write_evidence()
            fixture.write_conversation(
                conversation_id="conversation-4",
                local_conversation_id="local-4",
                client_run_id="run-4",
                include_main_citation=True,
            )
            fixture.close_catalog()
            (fixture.corpus / "index.sqlite").unlink()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))

            self.assertEqual(result["sample_count"], 1)
            self.assertTrue(any("index.sqlite" in warning for warning in result["warnings"]))

    def test_unsaved_drawing_evidence_is_skipped_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            fixture.write_evidence(extra_payload={
                "drawing": {"name": "plan.dwg", "saved": False, "dbmod": 3},
            })
            conversation = fixture.write_conversation(
                conversation_id="conversation-5",
                local_conversation_id="local-5",
                client_run_id="run-5",
            )
            fixture.write_trace(conversation, "conversation-5", "run-5")
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))

            self.assertEqual(result["sample_count"], 0)
            self.assertEqual(result["evidence_scanned"], 1)
            self.assertEqual(result["evidence_invalid"], 0)
            self.assertEqual(result["evidence_skipped_unsaved"], 1)
            self.assertEqual(result["evidence_unmatched"], 0)

    def test_unsaved_drawing_evidence_is_kept_with_include_unsaved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            fixture.write_evidence(extra_payload={
                "drawing": {"name": "plan.dwg", "saved": False, "dbmod": 3},
            })
            conversation = fixture.write_conversation(
                conversation_id="conversation-6",
                local_conversation_id="local-6",
                client_run_id="run-6",
            )
            fixture.write_trace(conversation, "conversation-6", "run-6")
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(
                corpus=fixture.corpus, output=output, include_unsaved=True,
            ))

            self.assertEqual(result["sample_count"], 1)
            self.assertEqual(result["evidence_skipped_unsaved"], 0)
            self.assertEqual(result["evidence_associations"], 1)

    def test_optional_run_id_fields_pass_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            # New optional fields from the TS writer must not trip validation; ids that
            # match no catalog row just fall through to the trace.jsonl join.
            fixture.write_evidence(extra_payload={
                "client_run_id": "run-unknown",
                "child_run_id": "child-unknown",
                "tool_call_id": "toolcall-1",
            })
            conversation = fixture.write_conversation(
                conversation_id="conversation-7",
                local_conversation_id="local-7",
                client_run_id="run-7",
            )
            fixture.write_trace(conversation, "conversation-7", "run-7")
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))
            sample = json.loads(output.read_text(encoding="utf-8").strip())

            self.assertEqual(result["evidence_invalid"], 0)
            self.assertEqual(result["sample_count"], 1)
            self.assertEqual(sample["client_run_id"], "run-7")

    def test_child_run_id_joins_catalog_without_trace_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            fixture.write_evidence(extra_payload={"child_run_id": "child-8"})
            fixture.write_conversation(
                conversation_id="conversation-8",
                local_conversation_id="local-8",
                client_run_id="run-8",
            )
            fixture.catalog_trace("conversation-8", "run-8", child_run_id="child-8")
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))
            sample = json.loads(output.read_text(encoding="utf-8").strip())

            self.assertEqual(result["sample_count"], 1)
            self.assertEqual(result["evidence_associations"], 1)
            self.assertEqual(sample["conversation_id"], "conversation-8")
            self.assertEqual(sample["client_run_id"], "run-8")

    def test_client_run_id_joins_catalog_without_trace_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = DatasetFixture(Path(tmp))
            fixture.write_evidence(extra_payload={"client_run_id": "run-9"})
            fixture.write_conversation(
                conversation_id="conversation-9",
                local_conversation_id="local-9",
                client_run_id="run-9",
            )
            fixture.catalog_trace("conversation-9", "run-9", child_run_id="child-9")
            fixture.close_catalog()

            output = fixture.corpus / "export.jsonl"
            result = export_dataset(DatasetExportOptions(corpus=fixture.corpus, output=output))
            sample = json.loads(output.read_text(encoding="utf-8").strip())

            self.assertEqual(result["sample_count"], 1)
            self.assertEqual(result["evidence_associations"], 1)
            self.assertEqual(sample["conversation_id"], "conversation-9")
            self.assertEqual(sample["client_run_id"], "run-9")


if __name__ == "__main__":
    unittest.main()
