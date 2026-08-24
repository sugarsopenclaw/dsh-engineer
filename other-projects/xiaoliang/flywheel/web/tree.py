"""Read-only aggregation of judge opinions: user → project → turn."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import quote

from flywheel.layout import utc_now

UNARCHIVED_PROJECT_ID = "__unarchived__"
UNARCHIVED_PROJECT_NAME = "无归档项目"
QUESTION_PREVIEW = 160
VERDICTS = ("good", "ordinary", "poor", "software_fail", "not_a_task")
FOLLOWUPS = ("open", "plan", "fixed", "accepted")
FOLLOWUP_LABELS = {
    "open": "未处理",
    "plan": "修复方案",
    "fixed": "修复完成",
    "accepted": "验收",
}

_TREE_SQL = """
SELECT
  jo.id AS opinion_id,
  jo.case_id,
  jo.fingerprint,
  jo.verdict,
  jo.quality_label,
  jo.intent,
  jo.task_type,
  jo.capability_family,
  jo.software_level,
  jo.product_note,
  jo.judge_model,
  tc.email AS case_email,
  tc.user_id,
  tc.question,
  tc.user_ordinal,
  tc.source,
  tc.conversation_id,
  u.id AS user_pk,
  u.email AS user_email,
  u.display_name,
  conv.title AS conversation_title,
  conv.project_archive_id,
  p.id AS project_id,
  p.name AS project_name,
  tm.duration_ms,
  tm.total_tokens,
  tm.tool_ok,
  tm.tool_fail,
  rf.status AS followup_status,
  rf.note AS followup_note
FROM judge_opinions jo
JOIN task_cases tc ON tc.id = jo.case_id
LEFT JOIN users u ON u.id = tc.user_id
LEFT JOIN conversations conv ON conv.id = tc.conversation_id
LEFT JOIN projects p ON p.id = conv.project_archive_id
LEFT JOIN task_metrics tm ON tm.case_id = tc.id
LEFT JOIN review_followups rf ON rf.fingerprint = jo.fingerprint
WHERE jo.fingerprint IS NOT NULL AND jo.fingerprint != ''
  AND jo.verdict IS NOT NULL AND jo.verdict != '' AND jo.verdict != 'error'
ORDER BY jo.id DESC
"""

_CASE_SQL = """
SELECT
  jo.id AS opinion_id,
  jo.case_id,
  jo.fingerprint,
  jo.verdict,
  jo.quality_label,
  jo.intent,
  jo.task_type,
  jo.evidence_use,
  jo.recovery,
  jo.capability_family,
  jo.software_level,
  jo.product_note,
  jo.opinion_json,
  jo.judge_model,
  jo.judge_duration_ms,
  jo.judge_input_tokens,
  jo.judge_output_tokens,
  tc.email AS case_email,
  tc.user_id,
  tc.question,
  tc.final_answer,
  tc.user_ordinal,
  tc.source,
  tc.conversation_id,
  tc.local_dir,
  tc.pack_json,
  u.email AS user_email,
  u.display_name,
  conv.title AS conversation_title,
  conv.project_archive_id,
  p.id AS project_id,
  p.name AS project_name,
  tm.duration_ms,
  tm.input_tokens,
  tm.output_tokens,
  tm.total_tokens,
  tm.tokens_by_purpose_json,
  tm.tool_ok,
  tm.tool_fail,
  tm.tool_counts_json,
  tm.run_status,
  tm.run_error,
  ss.signals_json,
  rf.status AS followup_status,
  rf.note AS followup_note,
  rf.updated_at AS followup_updated_at
FROM judge_opinions jo
JOIN task_cases tc ON tc.id = jo.case_id
LEFT JOIN users u ON u.id = tc.user_id
LEFT JOIN conversations conv ON conv.id = tc.conversation_id
LEFT JOIN projects p ON p.id = conv.project_archive_id
LEFT JOIN task_metrics tm ON tm.case_id = tc.id
LEFT JOIN software_signals ss ON ss.case_id = tc.id
LEFT JOIN review_followups rf ON rf.fingerprint = jo.fingerprint
WHERE jo.case_id = ?
  AND jo.fingerprint IS NOT NULL AND jo.fingerprint != ''
  AND jo.verdict IS NOT NULL AND jo.verdict != '' AND jo.verdict != 'error'
ORDER BY jo.id DESC
LIMIT 1
"""


def empty_verdict_counts() -> dict[str, int]:
    return {key: 0 for key in VERDICTS}


def empty_followup_counts() -> dict[str, int]:
    return {key: 0 for key in FOLLOWUPS}


def bump(counts: dict[str, int], verdict: str | None) -> None:
    key = verdict if verdict in counts else None
    if key:
        counts[key] += 1


def _followup_status(row: sqlite3.Row) -> str:
    value = row["followup_status"] if "followup_status" in row.keys() else None
    return value if value in FOLLOWUPS else "open"


def _preview(text: str | None, limit: int = QUESTION_PREVIEW) -> str:
    value = " ".join((text or "").split())
    if len(value) <= limit:
        return value
    return value[: limit - 1] + "…"


def _project_key(row: sqlite3.Row) -> tuple[str, str, bool]:
    source = row["source"] or ""
    project_id = row["project_id"]
    if source == "usage_only" or not project_id:
        return UNARCHIVED_PROJECT_ID, UNARCHIVED_PROJECT_NAME, True
    return str(project_id), (row["project_name"] or "未命名项目"), False


def _user_key(row: sqlite3.Row) -> tuple[str, str, str]:
    user_id = row["user_pk"] or row["user_id"] or row["user_email"] or row["case_email"] or "unknown"
    email = row["user_email"] or row["case_email"] or ""
    name = row["display_name"] or ""
    return str(user_id), email, name


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{Path(db_path).resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def load_tree(conn: sqlite3.Connection) -> dict[str, Any]:
    seen_fps: set[str] = set()
    users: dict[str, dict[str, Any]] = {}
    totals = empty_verdict_counts()
    followups = empty_followup_counts()
    successful = 0

    for row in conn.execute(_TREE_SQL):
        fp = row["fingerprint"]
        if not fp or fp in seen_fps:
            continue
        seen_fps.add(fp)
        successful += 1
        verdict = row["verdict"] or "ordinary"
        follow_status = _followup_status(row)
        bump(totals, verdict)
        bump(followups, follow_status)

        uid, email, display = _user_key(row)
        user = users.get(uid)
        if user is None:
            user = {
                "id": uid,
                "email": email,
                "display_name": display,
                "count": 0,
                "verdicts": empty_verdict_counts(),
                "followups": empty_followup_counts(),
                "projects": {},
            }
            users[uid] = user
        user["count"] += 1
        bump(user["verdicts"], verdict)
        bump(user["followups"], follow_status)

        pid, pname, unarchived = _project_key(row)
        projects: dict[str, Any] = user["projects"]
        project = projects.get(pid)
        if project is None:
            project = {
                "id": pid,
                "name": pname,
                "unarchived": unarchived,
                "count": 0,
                "verdicts": empty_verdict_counts(),
                "followups": empty_followup_counts(),
                "cases": [],
            }
            projects[pid] = project
        project["count"] += 1
        bump(project["verdicts"], verdict)
        bump(project["followups"], follow_status)
        project["cases"].append(
            {
                "id": row["case_id"],
                "fingerprint": fp,
                "verdict": verdict,
                "followup_status": follow_status,
                "followup_note": row["followup_note"] or "",
                "quality_label": row["quality_label"] or "",
                "intent": row["intent"] or "",
                "task_type": row["task_type"] or "",
                "capability_family": row["capability_family"] or "",
                "software_level": row["software_level"] or "",
                "question": _preview(row["question"]),
                "conversation_title": row["conversation_title"] or "",
                "user_ordinal": int(row["user_ordinal"] or 0),
                "source": row["source"] or "",
                "duration_ms": row["duration_ms"],
                "total_tokens": row["total_tokens"],
                "tool_ok": row["tool_ok"],
                "tool_fail": row["tool_fail"],
            }
        )

    user_list = []
    for user in users.values():
        project_list = list(user["projects"].values())
        for project in project_list:
            project["cases"].sort(
                key=lambda item: (
                    item["conversation_title"] or "",
                    item["user_ordinal"],
                    item["id"],
                )
            )
        project_list.sort(key=lambda item: (item["unarchived"], -item["count"], item["name"] or ""))
        user["projects"] = project_list
        user_list.append(user)
    user_list.sort(key=lambda item: (-item["count"], item["email"] or ""))
    return {
        "successful": successful,
        "verdicts": totals,
        "followups": followups,
        "users": user_list,
    }


def load_summary(tree: dict[str, Any]) -> dict[str, Any]:
    return {
        "successful": tree.get("successful", 0),
        "verdicts": tree.get("verdicts") or empty_verdict_counts(),
        "followups": tree.get("followups") or empty_followup_counts(),
        "users": len(tree.get("users") or []),
        "projects": sum(len(user.get("projects") or []) for user in tree.get("users") or []),
    }


def connect_write(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(Path(db_path).resolve()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def save_followup(
    conn: sqlite3.Connection,
    *,
    case_id: str,
    status: str,
    note: str = "",
) -> dict[str, Any] | None:
    if status not in FOLLOWUPS:
        raise ValueError(f"invalid followup status: {status}")
    row = conn.execute(_CASE_SQL, (case_id,)).fetchone()
    if row is None:
        return None
    fingerprint = row["fingerprint"]
    conn.execute(
        """
        INSERT INTO review_followups (fingerprint, case_id, status, note, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          case_id=excluded.case_id,
          status=excluded.status,
          note=excluded.note,
          updated_at=excluded.updated_at
        """,
        (fingerprint, case_id, status, note, utc_now()),
    )
    conn.commit()
    return {
        "case_id": case_id,
        "fingerprint": fingerprint,
        "status": status,
        "note": note,
    }


def _loads(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def corpus_relative(corpus: Path, path: str | None) -> str | None:
    if not path:
        return None
    try:
        resolved = Path(path).resolve()
        root = corpus.resolve()
        if resolved.is_file() and resolved.is_relative_to(root):
            return resolved.relative_to(root).as_posix()
    except (OSError, ValueError):
        return None
    return None


def safe_corpus_file(corpus: Path, rel: str) -> Path | None:
    rel = (rel or "").replace("\\", "/").lstrip("/")
    if not rel or ".." in Path(rel).parts:
        return None
    try:
        root = corpus.resolve()
        target = (root / rel).resolve()
        if target.is_file() and target.is_relative_to(root):
            return target
    except (OSError, ValueError):
        return None
    return None


def load_case(conn: sqlite3.Connection, case_id: str, corpus: Path | None = None) -> dict[str, Any] | None:
    row = conn.execute(_CASE_SQL, (case_id,)).fetchone()
    if row is None:
        return None
    pid, pname, unarchived = _project_key(row)
    opinion = _loads(row["opinion_json"]) or {}
    if not isinstance(opinion, dict):
        opinion = {}
    pack = _loads(row["pack_json"]) or {}
    if not isinstance(pack, dict):
        pack = {}
    publish = opinion.get("publish") if isinstance(opinion.get("publish"), dict) else {}
    question = publish.get("question") or row["question"] or ""
    final_answer = publish.get("final_answer") or row["final_answer"] or ""
    feedback = publish.get("user_feedback")
    if feedback in (None, ""):
        feedback = pack.get("feedback") or []
    raw_images = pack.get("images") or []
    images = []
    root = corpus if corpus is not None else None
    for item in raw_images:
        rel = corpus_relative(root, str(item)) if root is not None else None
        images.append(
            {
                "path": str(item),
                "rel": rel,
                "src": f"/media?p={quote(rel, safe='/')}" if rel else None,
            }
        )
    tokens_by_purpose = _loads(row["tokens_by_purpose_json"]) or {}
    tool_counts = _loads(row["tool_counts_json"]) or {}
    signals = _loads(row["signals_json"]) or pack.get("signals") or {}
    return {
        "id": row["case_id"],
        "fingerprint": row["fingerprint"],
        "email": row["user_email"] or row["case_email"] or "",
        "display_name": row["display_name"] or "",
        "project_id": pid,
        "project_name": pname,
        "unarchived": unarchived,
        "conversation_title": row["conversation_title"] or "",
        "user_ordinal": int(row["user_ordinal"] or 0),
        "source": row["source"] or "",
        "question": question,
        "final_answer": final_answer,
        "feedback": feedback,
        "metrics": {
            "duration_ms": row["duration_ms"],
            "input_tokens": row["input_tokens"],
            "output_tokens": row["output_tokens"],
            "total_tokens": row["total_tokens"],
            "tokens_by_purpose": tokens_by_purpose,
            "tool_ok": row["tool_ok"],
            "tool_fail": row["tool_fail"],
            "tool_counts": tool_counts,
            "run_status": row["run_status"],
            "run_error": row["run_error"],
        },
        "signals": signals,
        "images": images,
        "followup": {
            "status": _followup_status(row),
            "note": row["followup_note"] or "",
            "updated_at": row["followup_updated_at"] or "",
        },
        "opinion": {
            "verdict": opinion.get("verdict") or row["verdict"],
            "verdict_reason": opinion.get("verdict_reason") or "",
            "quality_label": opinion.get("quality_label") or row["quality_label"] or "",
            "quality_summary": opinion.get("quality_summary") or "",
            "product_note": opinion.get("product_note") or row["product_note"] or "",
            "intent": opinion.get("intent") or row["intent"] or "",
            "intent_summary": opinion.get("intent_summary") or "",
            "task_type": opinion.get("task_type") or row["task_type"] or "",
            "evidence_use": opinion.get("evidence_use") or row["evidence_use"] or "",
            "recovery": opinion.get("recovery") or row["recovery"] or "",
            "capability_family": opinion.get("capability_family") or row["capability_family"] or "",
            "software_level": opinion.get("software_level") or row["software_level"] or "",
            "software_summary": opinion.get("software_summary") or "",
            "user_sentiment": opinion.get("user_sentiment") or "",
            "llm_judge": publish.get("llm_judge") or "",
        },
        "judge_model": row["judge_model"] or "",
        "judge_duration_ms": row["judge_duration_ms"],
        "judge_input_tokens": row["judge_input_tokens"],
        "judge_output_tokens": row["judge_output_tokens"],
    }
