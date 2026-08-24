import json
import tempfile
import unittest
from pathlib import Path

from flywheel.slice_turns import slice_conversation_turns


class SliceTurnsTests(unittest.TestCase):
    def test_splits_on_user_messages(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            conv_dir = Path(tmp)
            rows = [
                {"id": "u1", "ordinal": 0, "role": "user", "content": "看排水沟尺寸", "tool_name": ""},
                {
                    "id": "a1",
                    "ordinal": 1,
                    "role": "assistant",
                    "content": "沟宽 300",
                    "tool_name": "cad_task_probe",
                    "tool_result": "ok",
                    "client_run_id": "run-1",
                },
                {"id": "u2", "ordinal": 2, "role": "user", "content": "不对，再看一次", "tool_name": ""},
                {"id": "a2", "ordinal": 3, "role": "assistant", "content": "沟宽 450", "tool_name": ""},
            ]
            (conv_dir / "messages.jsonl").write_text(
                "\n".join(json.dumps(row, ensure_ascii=False) for row in rows),
                encoding="utf-8",
            )
            cases = slice_conversation_turns(
                user_id="u",
                email="a@b.com",
                conversation={"id": "c1", "local_conversation_id": "loc"},
                conv_dir=conv_dir,
                blobs_root=conv_dir / "blobs",
                attachments=[],
                usage_runs=[
                    {
                        "id": "r1",
                        "client_run_id": "run-1",
                        "status": "completed",
                        "duration_ms": 1000,
                        "original_question": "看排水沟尺寸",
                    }
                ],
                usage_calls=[{"agent_run_id": "r1", "client_run_id": "run-1", "total_tokens": 10, "input_tokens": 6, "output_tokens": 4, "call_purpose": "main"}],
                feedback_rows=[],
            )
            self.assertEqual(len(cases), 2)
            self.assertEqual(cases[0].question, "看排水沟尺寸")
            self.assertEqual(cases[0].final_answer, "沟宽 300")
            self.assertEqual(cases[0].metrics["total_tokens"], 10)
            self.assertEqual(cases[1].question, "不对，再看一次")
            self.assertEqual(cases[1].previous_user, "看排水沟尺寸")
            self.assertNotEqual(cases[0].fingerprint, cases[1].fingerprint)

    def test_recovers_jsonl_split_by_newlines_inside_string(self) -> None:
        from flywheel.slice_turns import _load_jsonl

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "messages.jsonl"
            path.write_text(
                '{"id":"1","role":"user","content":"hello\nworld","ordinal":0}\n{"id":"2","role":"assistant","content":"ok","ordinal":1}\n',
                encoding="utf-8",
            )
            # The first object is one valid jsonl line with escaped newline; also test a physically split line.
            path.write_text(
                '{"id":"1","role":"user","content":"hello\n'
                'world","ordinal":0}\n{"id":"2","role":"assistant","content":"ok","ordinal":1}\n',
                encoding="utf-8",
            )
            rows = _load_jsonl(path)
            self.assertEqual(len(rows), 2)
            self.assertIn("hello", rows[0]["content"])
            self.assertEqual(rows[1]["role"], "assistant")


if __name__ == "__main__":
    unittest.main()
