"""Judge browser tree: user → project → cases, usage bucket, skip errors/dups."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from flywheel.sqlite_store import LocalStore
from flywheel.web.server import DEFAULT_HOST, JudgeBrowserHandler
from flywheel.web.tree import (
    UNARCHIVED_PROJECT_ID,
    UNARCHIVED_PROJECT_NAME,
    connect_readonly,
    connect_write,
    load_case,
    load_summary,
    load_tree,
    safe_corpus_file,
    save_followup,
)


def _seed(store: LocalStore) -> None:
    store.upsert(
        "users",
        {"id": "u-alice", "email": "alice@test.com", "display_name": "Alice", "has_messages": 1, "has_usage_runs": 0},
    )
    store.upsert(
        "users",
        {"id": "u-bob", "email": "bob@test.com", "display_name": "", "has_messages": 0, "has_usage_runs": 1},
    )
    store.upsert(
        "projects",
        {"id": "p-house", "owner_user_id": "u-alice", "name": "住宅项目"},
    )
    store.upsert(
        "conversations",
        {
            "id": "conv-1",
            "project_archive_id": "p-house",
            "source_user_id": "u-alice",
            "title": "查面积",
        },
    )
    cases = [
        {
            "id": "conv-1:0",
            "fingerprint": "fp-a",
            "user_id": "u-alice",
            "email": "alice@test.com",
            "conversation_id": "conv-1",
            "user_ordinal": 0,
            "source": "conversation",
            "question": "标准层A户型面积是多少",
            "final_answer": "约 120 平",
        },
        {
            "id": "conv-1:1",
            "fingerprint": "fp-b",
            "user_id": "u-alice",
            "email": "alice@test.com",
            "conversation_id": "conv-1",
            "user_ordinal": 1,
            "source": "conversation",
            "question": "再量一次开间",
            "final_answer": "3.6 米",
        },
        {
            "id": "conv-1:2",
            "fingerprint": "",
            "user_id": "u-alice",
            "email": "alice@test.com",
            "conversation_id": "conv-1",
            "user_ordinal": 2,
            "source": "conversation",
            "question": "失败轮次",
            "final_answer": "",
        },
        {
            "id": "conv-1:3",
            "fingerprint": "fp-d",
            "user_id": "u-alice",
            "email": "alice@test.com",
            "conversation_id": "conv-1",
            "user_ordinal": 3,
            "source": "conversation",
            "question": "重复指纹轮次",
            "final_answer": "已改",
        },
        {
            "id": "usage:run1",
            "fingerprint": "fp-c",
            "user_id": "u-bob",
            "email": "bob@test.com",
            "conversation_id": None,
            "user_ordinal": 0,
            "source": "usage_only",
            "question": "帮我算一下此图工程量",
            "final_answer": "未能读图",
        },
    ]
    for case in cases:
        store.upsert("task_cases", case)
        store.upsert(
            "task_metrics",
            {
                "case_id": case["id"],
                "duration_ms": 1200,
                "total_tokens": 80,
                "tool_ok": 1,
                "tool_fail": 0,
            },
        )
    opinions = [
        ("conv-1:0", "fp-a", "good", "cad_read"),
        ("conv-1:1", "fp-b", "ordinary", "cad_read"),
        ("conv-1:2", "", "error", "other"),
        ("conv-1:3", "fp-d", "poor", "cad_read"),
        ("conv-1:3", "fp-d", "good", "cad_read"),
        ("usage:run1", "fp-c", "poor", "cad_read"),
    ]
    for case_id, fingerprint, verdict, task_type in opinions:
        store.execute(
            """
            INSERT INTO judge_opinions (
              case_id, fingerprint, verdict, quality_label, intent, task_type,
              product_note, opinion_json, judge_model
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case_id,
                fingerprint,
                verdict,
                verdict if verdict != "error" else "",
                "new_task",
                task_type,
                "先读图再算量" if verdict != "error" else "",
                json.dumps(
                    {
                        "verdict": verdict,
                        "verdict_reason": f"reason-{verdict}",
                        "product_note": "先读图再算量",
                        "quality_label": verdict,
                        "publish": {
                            "question": "q",
                            "final_answer": "a",
                            "llm_judge": f"reason-{verdict}",
                        },
                    },
                    ensure_ascii=False,
                )
                if verdict != "error"
                else "{}",
                "grok-4.6",
            ),
        )
    store.commit()


class WebTreeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.corpus = Path(self.tmp.name)
        self.db = self.corpus / "index.sqlite"
        self.store = LocalStore(self.db)
        _seed(self.store)
        self.store.close()
        self.conn = connect_readonly(self.db)

    def tearDown(self) -> None:
        self.conn.close()
        self.tmp.cleanup()

    def test_tree_is_user_then_project_then_cases(self) -> None:
        tree = load_tree(self.conn)
        self.assertEqual(tree["successful"], 4)
        self.assertEqual(tree["verdicts"]["good"], 2)
        self.assertEqual(tree["verdicts"]["ordinary"], 1)
        self.assertEqual(tree["verdicts"]["poor"], 1)
        emails = [user["email"] for user in tree["users"]]
        self.assertEqual(emails, ["alice@test.com", "bob@test.com"])
        alice = tree["users"][0]
        self.assertEqual(alice["projects"][0]["name"], "住宅项目")
        alice_ids = [item["id"] for item in alice["projects"][0]["cases"]]
        self.assertEqual(set(alice_ids), {"conv-1:0", "conv-1:1", "conv-1:3"})
        self.assertNotIn("conv-1:2", alice_ids)

    def test_usage_only_lands_in_unarchived_bucket(self) -> None:
        tree = load_tree(self.conn)
        bob = tree["users"][1]
        self.assertEqual(len(bob["projects"]), 1)
        bucket = bob["projects"][0]
        self.assertEqual(bucket["id"], UNARCHIVED_PROJECT_ID)
        self.assertEqual(bucket["name"], UNARCHIVED_PROJECT_NAME)
        self.assertTrue(bucket["unarchived"])
        self.assertEqual(bucket["cases"][0]["id"], "usage:run1")
        self.assertEqual(bucket["cases"][0]["verdict"], "poor")

    def test_error_opinions_hidden_and_duplicate_fingerprint_keeps_latest(self) -> None:
        tree = load_tree(self.conn)
        alice_cases = tree["users"][0]["projects"][0]["cases"]
        by_id = {item["id"]: item for item in alice_cases}
        self.assertEqual(by_id["conv-1:3"]["verdict"], "good")
        fps = [item["fingerprint"] for item in alice_cases]
        self.assertEqual(len(fps), len(set(fps)))

    def test_case_detail_has_reason_and_product_note(self) -> None:
        detail = load_case(self.conn, "conv-1:0", corpus=self.corpus)
        self.assertIsNotNone(detail)
        self.assertEqual(detail["opinion"]["verdict"], "good")
        self.assertIn("reason-good", detail["opinion"]["verdict_reason"])
        self.assertEqual(detail["opinion"]["product_note"], "先读图再算量")
        self.assertEqual(detail["project_name"], "住宅项目")
        self.assertIsNone(load_case(self.conn, "conv-1:2", corpus=self.corpus))

    def test_summary_counts(self) -> None:
        summary = load_summary(load_tree(self.conn))
        self.assertEqual(summary["successful"], 4)
        self.assertEqual(summary["users"], 2)
        self.assertEqual(summary["projects"], 2)
        self.assertEqual(summary["followups"]["open"], 4)

    def test_followup_defaults_open_and_can_be_saved(self) -> None:
        tree = load_tree(self.conn)
        self.assertEqual(tree["users"][0]["projects"][0]["cases"][0]["followup_status"], "open")
        self.conn.close()
        writer = connect_write(self.db)
        saved = save_followup(writer, case_id="conv-1:0", status="plan", note="先修读尺寸链")
        writer.close()
        self.assertEqual(saved["status"], "plan")
        self.conn = connect_readonly(self.db)
        tree = load_tree(self.conn)
        by_id = {item["id"]: item for item in tree["users"][0]["projects"][0]["cases"]}
        self.assertEqual(by_id["conv-1:0"]["followup_status"], "plan")
        self.assertEqual(by_id["conv-1:0"]["followup_note"], "先修读尺寸链")
        self.assertEqual(tree["followups"]["plan"], 1)
        self.assertEqual(tree["followups"]["open"], 3)
        detail = load_case(self.conn, "conv-1:0", corpus=self.corpus)
        self.assertEqual(detail["followup"]["status"], "plan")

    def test_media_rejects_path_escape(self) -> None:
        inside = self.corpus / "users" / "pic.png"
        inside.parent.mkdir(parents=True)
        inside.write_bytes(b"png")
        self.assertEqual(safe_corpus_file(self.corpus, "users/pic.png"), inside.resolve())
        self.assertIsNone(safe_corpus_file(self.corpus, "../secret"))
        self.assertIsNone(safe_corpus_file(self.corpus, "users/../../secret"))


class WebHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.corpus = Path(self.tmp.name)
        db = self.corpus / "index.sqlite"
        store = LocalStore(db)
        _seed(store)
        store.close()
        JudgeBrowserHandler.corpus = self.corpus
        JudgeBrowserHandler.db_path = db
        self.httpd = ThreadingHTTPServer((DEFAULT_HOST, 0), JudgeBrowserHandler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def _get(self, path: str) -> tuple[int, dict | str]:
        url = f"http://{DEFAULT_HOST}:{self.port}{path}"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                raw = resp.read().decode("utf-8")
                if "application/json" in (resp.headers.get("Content-Type") or ""):
                    return resp.status, json.loads(raw)
                return resp.status, raw
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", errors="replace")

    def _post(self, path: str, payload: dict) -> tuple[int, dict | str]:
        url = f"http://{DEFAULT_HOST}:{self.port}{path}"
        raw = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=raw,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return resp.status, body
        except urllib.error.HTTPError as exc:
            text = exc.read().decode("utf-8", errors="replace")
            try:
                return exc.code, json.loads(text)
            except json.JSONDecodeError:
                return exc.code, text

    def test_tree_and_case_endpoints(self) -> None:
        status, tree = self._get("/api/tree")
        self.assertEqual(status, 200)
        self.assertEqual(tree["successful"], 4)
        self.assertEqual(tree["users"][0]["email"], "alice@test.com")
        self.assertEqual(tree["users"][0]["projects"][0]["name"], "住宅项目")
        case_id = urllib.parse.quote("conv-1:0", safe="")
        status, detail = self._get(f"/api/cases/{case_id}")
        self.assertEqual(status, 200)
        self.assertEqual(detail["id"], "conv-1:0")
        self.assertEqual(detail["opinion"]["verdict"], "good")
        status, _ = self._get("/api/cases/missing")
        self.assertEqual(status, 404)
        status, page = self._get("/")
        self.assertEqual(status, 200)
        self.assertIn("飞轮评审", page)
        self.assertEqual(detail["followup"]["status"], "open")

    def test_post_followup_persists(self) -> None:
        case_id = urllib.parse.quote("conv-1:1", safe="")
        status, payload = self._post(
            f"/api/cases/{case_id}/followup",
            {"status": "fixed", "note": "已改测量口径"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "fixed")
        status, detail = self._get(f"/api/cases/{case_id}")
        self.assertEqual(status, 200)
        self.assertEqual(detail["followup"]["status"], "fixed")
        self.assertEqual(detail["followup"]["note"], "已改测量口径")
        status, tree = self._get("/api/tree")
        by_id = {item["id"]: item for item in tree["users"][0]["projects"][0]["cases"]}
        self.assertEqual(by_id["conv-1:1"]["followup_status"], "fixed")
        status, bad = self._post(f"/api/cases/{case_id}/followup", {"status": "nope"})
        self.assertEqual(status, 400)
