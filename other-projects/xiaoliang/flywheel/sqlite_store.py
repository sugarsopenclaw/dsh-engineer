"""Local sqlite catalog. Bytes stay in the blob store / user tree."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS pull_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  user_filter TEXT,
  stats_json TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  is_active INTEGER,
  created_at TEXT,
  has_messages INTEGER NOT NULL DEFAULT 0,
  has_usage_runs INTEGER NOT NULL DEFAULT 0,
  archive_gap TEXT,
  local_dir TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  owner_user_id TEXT,
  local_project_id TEXT,
  name TEXT,
  description TEXT,
  root_name TEXT,
  sync_status TEXT,
  file_count INTEGER,
  total_bytes INTEGER,
  last_synced_at TEXT,
  created_at TEXT,
  local_dir TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_archive_id TEXT,
  source_user_id TEXT,
  local_conversation_id TEXT,
  title TEXT,
  creation_source TEXT,
  conversation_mode TEXT,
  drawing_id TEXT,
  drawing_name TEXT,
  preferred_model_id TEXT,
  preferred_thinking_mode TEXT,
  parent_local_conversation_id TEXT,
  forked_from_entry_id TEXT,
  last_synced_at TEXT,
  created_at TEXT,
  is_deleted INTEGER,
  message_count INTEGER,
  has_pi_session INTEGER,
  local_dir TEXT
);

CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_archive_id TEXT NOT NULL,
  relative_path TEXT,
  normalized_path TEXT,
  filename TEXT,
  extension TEXT,
  media_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  storage_key TEXT,
  upload_status TEXT,
  is_deleted INTEGER,
  download_status TEXT,
  skip_reason TEXT,
  blob_sha256 TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_files_sha ON project_files(sha256);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_archive_id);
CREATE INDEX IF NOT EXISTS idx_project_files_status ON project_files(download_status);

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  first_storage_key TEXT,
  source_kind TEXT,
  local_path TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS oss_objects (
  storage_key TEXT PRIMARY KEY,
  sha256 TEXT,
  size_bytes INTEGER,
  source_kind TEXT
);
CREATE INDEX IF NOT EXISTS idx_oss_objects_sha ON oss_objects(sha256);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  local_message_id TEXT,
  client_run_id TEXT,
  pi_session_id TEXT,
  pi_entry_id TEXT,
  source_key TEXT,
  ordinal INTEGER,
  role TEXT,
  tool_name TEXT,
  content_chars INTEGER,
  thinking_chars INTEGER,
  jsonl_offset INTEGER,
  source_created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS pi_sessions (
  id TEXT PRIMARY KEY,
  conversation_archive_id TEXT,
  project_archive_id TEXT,
  pi_session_id TEXT,
  parent_pi_session_id TEXT,
  sha256 TEXT,
  size_bytes INTEGER,
  storage_key TEXT,
  upload_status TEXT,
  entry_count INTEGER,
  uploaded_at TEXT,
  is_latest INTEGER,
  download_status TEXT,
  blob_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  project_archive_id TEXT,
  conversation_archive_id TEXT,
  child_run_id TEXT,
  parent_session_id TEXT,
  parent_pi_session_id TEXT,
  parent_pi_entry_id TEXT,
  client_run_id TEXT,
  agent_type TEXT,
  status TEXT,
  model TEXT,
  storage_key TEXT,
  upload_status TEXT,
  trace_sha256 TEXT,
  trace_size_bytes INTEGER,
  assigned INTEGER,
  download_status TEXT,
  blob_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS trace_blobs (
  id TEXT PRIMARY KEY,
  trace_archive_id TEXT,
  sha256 TEXT,
  media_type TEXT,
  size_bytes INTEGER,
  storage_key TEXT,
  upload_status TEXT,
  download_status TEXT,
  blob_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  conversation_id TEXT,
  local_attachment_id TEXT,
  filename TEXT,
  media_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  storage_key TEXT,
  upload_status TEXT,
  download_status TEXT,
  blob_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS skill_archives (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  owner_user_id TEXT,
  skill_count INTEGER,
  file_count INTEGER,
  total_bytes INTEGER,
  skills_root_name TEXT,
  sync_status TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS skill_entries (
  id TEXT PRIMARY KEY,
  archive_id TEXT,
  slug TEXT,
  name TEXT,
  description TEXT,
  enabled INTEGER,
  validation_status TEXT,
  file_count INTEGER,
  is_deleted INTEGER
);

CREATE TABLE IF NOT EXISTS skill_files (
  id TEXT PRIMARY KEY,
  archive_id TEXT,
  skill_slug TEXT,
  relative_path TEXT,
  normalized_path TEXT,
  filename TEXT,
  extension TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  storage_key TEXT,
  upload_status TEXT,
  is_deleted INTEGER,
  download_status TEXT,
  skip_reason TEXT,
  blob_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS usage_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  organization_id TEXT,
  client_run_id TEXT,
  source TEXT,
  status TEXT,
  local_conversation_id TEXT,
  task_preview TEXT,
  original_question TEXT,
  final_answer TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS usage_calls (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT,
  user_id TEXT,
  client_run_id TEXT,
  child_run_id TEXT,
  call_purpose TEXT,
  model_alias TEXT,
  provider_model TEXT,
  status TEXT,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  image_count INTEGER,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  agent_run_id TEXT,
  client_run_id TEXT,
  pi_session_id TEXT,
  pi_entry_id TEXT,
  local_conversation_id TEXT,
  local_message_id TEXT,
  vote TEXT,
  outcome TEXT,
  issue_codes_json TEXT,
  comment TEXT,
  app_version TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS document_analyses (
  id TEXT PRIMARY KEY,
  project_file_id TEXT,
  project_archive_id TEXT,
  requested_by_user_id TEXT,
  instruction TEXT,
  status TEXT,
  content TEXT,
  truncated INTEGER,
  model TEXT,
  error_message TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  organization_id TEXT,
  title TEXT,
  description TEXT,
  content TEXT,
  storage_key TEXT,
  content_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS judge_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  model TEXT,
  user_filter TEXT,
  limit_n INTEGER,
  force_judge INTEGER NOT NULL DEFAULT 0,
  stats_json TEXT
);

CREATE TABLE IF NOT EXISTS task_cases (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  user_id TEXT,
  email TEXT,
  conversation_id TEXT,
  local_conversation_id TEXT,
  user_message_id TEXT,
  user_ordinal INTEGER,
  source TEXT,
  question TEXT,
  final_answer TEXT,
  local_dir TEXT,
  pack_json TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_cases_fp ON task_cases(fingerprint);
CREATE INDEX IF NOT EXISTS idx_task_cases_conv ON task_cases(conversation_id);

CREATE TABLE IF NOT EXISTS task_metrics (
  case_id TEXT PRIMARY KEY,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  tokens_by_purpose_json TEXT,
  tool_ok INTEGER,
  tool_fail INTEGER,
  tool_counts_json TEXT,
  run_status TEXT,
  run_error TEXT
);

CREATE TABLE IF NOT EXISTS software_signals (
  case_id TEXT PRIMARY KEY,
  signals_json TEXT
);

CREATE TABLE IF NOT EXISTS judge_opinions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  judge_run_id INTEGER,
  schema_version TEXT,
  verdict TEXT,
  software_level TEXT,
  intent TEXT,
  task_type TEXT,
  evidence_use TEXT,
  recovery TEXT,
  capability_family TEXT,
  quality_label TEXT,
  product_note TEXT,
  opinion_json TEXT,
  raw_text TEXT,
  judge_model TEXT,
  judge_duration_ms INTEGER,
  judge_input_tokens INTEGER,
  judge_output_tokens INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_judge_opinions_case ON judge_opinions(case_id);
CREATE INDEX IF NOT EXISTS idx_judge_opinions_fp ON judge_opinions(fingerprint);

CREATE TABLE IF NOT EXISTS review_followups (
  fingerprint TEXT PRIMARY KEY,
  case_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_followups_status ON review_followups(status);
CREATE INDEX IF NOT EXISTS idx_review_followups_case ON review_followups(case_id);
"""


def _placeholders(row: dict[str, Any]) -> tuple[str, str, list[Any]]:
    cols = list(row.keys())
    return (
        ", ".join(cols),
        ", ".join("?" for _ in cols),
        [row[c] for c in cols],
    )


class LocalStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.Lock()
        self.init_schema()

    def init_schema(self) -> None:
        with self._lock:
            self.conn.executescript(SCHEMA)
            self.conn.commit()

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    def execute(self, sql: str, params: Iterable[Any] = (), *, commit: bool = True) -> sqlite3.Cursor:
        with self._lock:
            cur = self.conn.execute(sql, tuple(params))
            if commit:
                self.conn.commit()
            return cur

    def commit(self) -> None:
        with self._lock:
            self.conn.commit()

    def executemany(self, sql: str, rows: Iterable[Iterable[Any]], *, commit: bool = True) -> None:
        with self._lock:
            self.conn.executemany(sql, list(rows))
            if commit:
                self.conn.commit()

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self.conn.execute(sql, tuple(params)))

    def upsert(self, table: str, row: dict[str, Any]) -> None:
        cols, marks, values = _placeholders(row)
        pk = "id" if "id" in row else next(iter(row))
        updates = ", ".join(f"{c}=excluded.{c}" for c in row if c != pk)
        sql = f"INSERT INTO {table} ({cols}) VALUES ({marks}) ON CONFLICT({pk}) DO UPDATE SET {updates}"
        self.execute(sql, values, commit=False)

    def upsert_many(self, table: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        for row in rows:
            self.upsert(table, row)

    def start_run(self, *, dry_run: bool, force: bool, user_filter: str | None) -> int:
        cur = self.execute(
            "INSERT INTO pull_runs (started_at, status, dry_run, force, user_filter) VALUES (datetime('now'), 'running', ?, ?, ?)",
            (int(dry_run), int(force), user_filter),
        )
        return int(cur.lastrowid)

    def finish_run(self, run_id: int, status: str, stats: dict[str, Any]) -> None:
        self.execute(
            "UPDATE pull_runs SET finished_at=datetime('now'), status=?, stats_json=? WHERE id=?",
            (status, json.dumps(stats, ensure_ascii=False, default=str), run_id),
        )

    def latest_run(self) -> sqlite3.Row | None:
        rows = self.query("SELECT * FROM pull_runs ORDER BY id DESC LIMIT 1")
        return rows[0] if rows else None

    def counts(self) -> dict[str, int]:
        tables = [
            "users", "projects", "conversations", "project_files", "messages",
            "pi_sessions", "traces", "trace_blobs", "attachments", "blobs",
            "oss_objects", "skill_archives", "skill_files", "usage_runs",
            "feedback", "prompt_templates", "document_analyses",
        ]
        out: dict[str, int] = {}
        for table in tables:
            out[table] = int(self.query(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"])
        return out

    def file_status_counts(self) -> dict[str, int]:
        rows = self.query(
            "SELECT download_status, COUNT(*) AS n FROM project_files GROUP BY download_status"
        )
        return {row["download_status"] or "null": int(row["n"]) for row in rows}

    def update_download(self, table: str, record_id: str, status: str, blob_sha256: str | None) -> None:
        self.execute(
            f"UPDATE {table} SET download_status=?, blob_sha256=? WHERE id=?",
            (status, blob_sha256, record_id),
            commit=False,
        )

    def record_blob(self, sha256: str, size_bytes: int, storage_key: str | None, source_kind: str, local_path: str) -> None:
        self.execute(
            """
            INSERT INTO blobs (sha256, size_bytes, first_storage_key, source_kind, local_path, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(sha256) DO UPDATE SET
              size_bytes=excluded.size_bytes,
              local_path=excluded.local_path
            """,
            (sha256, size_bytes, storage_key, source_kind, local_path),
            commit=False,
        )

    def record_oss_object(self, storage_key: str, sha256: str | None, size_bytes: int | None, source_kind: str) -> None:
        if not storage_key:
            return
        self.execute(
            """
            INSERT INTO oss_objects (storage_key, sha256, size_bytes, source_kind)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(storage_key) DO UPDATE SET
              sha256=excluded.sha256,
              size_bytes=excluded.size_bytes,
              source_kind=excluded.source_kind
            """,
            (storage_key, sha256, size_bytes, source_kind),
            commit=False,
        )
