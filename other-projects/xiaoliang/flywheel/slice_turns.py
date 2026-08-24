"""Slice corpus conversations into per-user-question turns."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from flywheel.software_signals import analyze_turn, metrics_fingerprint

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
TEXT_LIMIT_PER_FIELD = 4000
TURN_TEXT_BUDGET = 24000
MAX_IMAGES = 24


@dataclass
class TurnCase:
    case_id: str
    fingerprint: str
    user_id: str
    email: str
    conversation_id: str | None
    local_conversation_id: str | None
    user_message_id: str | None
    user_ordinal: int
    source: str
    question: str
    final_answer: str
    previous_user: str
    local_dir: str | None
    turn_dir: Path | None
    messages: list[dict[str, Any]]
    metrics: dict[str, Any]
    signals: dict[str, Any]
    feedback: list[dict[str, Any]]
    image_paths: list[Path] = field(default_factory=list)
    omitted_images: int = 0
    artifact_hints: list[str] = field(default_factory=list)


def _norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    buf = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line and not buf:
            continue
        candidate = line if not buf else buf + "\\n" + line
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError:
            buf = candidate
            continue
        if isinstance(obj, dict):
            rows.append(obj)
        buf = ""
    return rows


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _last_assistant_text(messages: list[dict[str, Any]]) -> str:
    texts = [
        (row.get("content") or "").strip()
        for row in messages
        if row.get("role") == "assistant" and (row.get("content") or "").strip()
    ]
    return texts[-1] if texts else ""


def _bind_usage(
    question: str,
    messages: list[dict[str, Any]],
    conv_runs: list[dict[str, Any]],
    conv_calls: list[dict[str, Any]],
    next_user_time: datetime | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    run_ids_from_msg = {
        row.get("client_run_id")
        for row in messages
        if row.get("client_run_id")
    }
    matched = [run for run in conv_runs if run.get("client_run_id") in run_ids_from_msg]
    if not matched:
        qn = _norm(question)
        matched = [run for run in conv_runs if _norm(run.get("original_question")) == qn]
    if not matched:
        start = _parse_time(messages[0].get("source_created_at")) if messages else None
        if start is not None:
            window = []
            for run in conv_runs:
                ts = _parse_time(run.get("started_at"))
                if ts is None:
                    continue
                if ts < start:
                    continue
                if next_user_time is not None and ts >= next_user_time:
                    continue
                window.append(run)
            matched = window
    run_ids = {item.get("id") for item in matched}
    client_ids = {item.get("client_run_id") for item in matched}
    calls = [
        call
        for call in conv_calls
        if call.get("agent_run_id") in run_ids or call.get("client_run_id") in client_ids
    ]
    return matched, calls


def _bind_feedback(
    messages: list[dict[str, Any]],
    feedback_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    local_ids = {row.get("local_message_id") for row in messages if row.get("local_message_id")}
    pi_entries = {row.get("pi_entry_id") for row in messages if row.get("pi_entry_id")}
    client_ids = {row.get("client_run_id") for row in messages if row.get("client_run_id")}
    hit = []
    for item in feedback_rows:
        if item.get("local_message_id") and item.get("local_message_id") in local_ids:
            hit.append(item)
        elif item.get("pi_entry_id") and item.get("pi_entry_id") in pi_entries:
            hit.append(item)
        elif item.get("client_run_id") and item.get("client_run_id") in client_ids:
            hit.append(item)
    return hit


def _artifact_hints(messages: list[dict[str, Any]]) -> list[str]:
    hints = []
    for row in messages:
        name = (row.get("tool_name") or "").strip()
        if name in {
            "project_artifact_create",
            "project_quantity_excel_write",
            "cad_evidence_image",
            "write",
        }:
            preview = (row.get("tool_args") or row.get("tool_result") or "")[:180]
            hints.append(f"{name}: {preview}")
    return hints[:12]


def _collect_images(
    *,
    conv_dir: Path,
    blobs_root: Path,
    turn_messages: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
) -> tuple[list[Path], int]:
    ranked: list[tuple[int, Path]] = []
    seen: set[str] = set()

    def add(path: Path | None, rank: int) -> None:
        if path is None or not path.is_file():
            return
        if path.suffix.lower() not in IMAGE_EXT:
            return
        key = str(path.resolve())
        if key in seen:
            return
        seen.add(key)
        ranked.append((rank, path))

    msg_ids = {row.get("id") for row in turn_messages}
    for att in attachments:
        if att.get("message_id") and att.get("message_id") not in msg_ids:
            continue
        sha = att.get("blob_sha256") or att.get("sha256")
        if sha:
            add(blobs_root / sha[:2] / sha, 0)
        name = att.get("filename") or ""
        if name:
            add(conv_dir / "attachments" / name, 0)
        local_id = att.get("local_attachment_id") or att.get("id") or ""
        if local_id:
            for ext in IMAGE_EXT:
                add(conv_dir / "attachments" / f"{local_id[:12]}{ext}", 0)

    if (conv_dir / "attachments").is_dir() and not attachments:
        for path in sorted((conv_dir / "attachments").iterdir()):
            add(path, 1)

    child_ids = set()
    for row in turn_messages:
        blob = " ".join(
            part for part in (row.get("tool_args"), row.get("tool_result"), row.get("content")) if part
        )
        for match in re.finditer(r"child-[0-9a-f-]{8,}", blob, re.IGNORECASE):
            child_ids.add(match.group(0).lower())

    traces_dir = conv_dir / "traces"
    if traces_dir.is_dir():
        for folder in traces_dir.iterdir():
            if not folder.is_dir():
                continue
            name = folder.name.lower()
            meta_path = folder / "meta.json"
            meta = {}
            if meta_path.is_file():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    meta = {}
            child = str(meta.get("child_run_id") or "")
            belongs = False
            if child and any(child in (row.get("tool_args") or "") + (row.get("tool_result") or "") for row in turn_messages):
                belongs = True
            if any(cid in name for cid in child_ids):
                belongs = True
            client = meta.get("client_run_id")
            if client and any(row.get("client_run_id") == client for row in turn_messages):
                belongs = True
            if not belongs and child_ids:
                continue
            if not belongs and not child_ids:
                # 无法对齐时不把整场对话截图塞进每一轮
                continue
            blob_dir = folder / "blobs"
            if blob_dir.is_dir():
                for path in sorted(blob_dir.iterdir()):
                    add(path, 2)

    ranked.sort(key=lambda item: (item[0], str(item[1])))
    chosen = [path for _, path in ranked[:MAX_IMAGES]]
    omitted = max(0, len(ranked) - len(chosen))
    return chosen, omitted


def _fingerprint(question: str, final_answer: str, metrics: dict[str, Any]) -> str:
    raw = "\n".join([_norm(question), _norm(final_answer)[:2000], metrics_fingerprint(metrics)])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _compact_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact = []
    budget = TURN_TEXT_BUDGET
    for row in messages:
        item = {
            "ordinal": row.get("ordinal"),
            "role": row.get("role"),
            "tool_name": row.get("tool_name") or None,
            "content": (row.get("content") or "")[:TEXT_LIMIT_PER_FIELD],
            "tool_args": (row.get("tool_args") or "")[:2000],
            "tool_result": (row.get("tool_result") or "")[:TEXT_LIMIT_PER_FIELD],
        }
        used = len(item["content"]) + len(item["tool_args"]) + len(item["tool_result"])
        if budget <= 0:
            item["content"] = item["content"][:200]
            item["tool_result"] = (item["tool_result"] or "")[:200]
        budget -= used
        compact.append(item)
    return compact


def slice_conversation_turns(
    *,
    user_id: str,
    email: str,
    conversation: dict[str, Any],
    conv_dir: Path,
    blobs_root: Path,
    attachments: list[dict[str, Any]],
    usage_runs: list[dict[str, Any]],
    usage_calls: list[dict[str, Any]],
    feedback_rows: list[dict[str, Any]],
) -> list[TurnCase]:
    messages = _load_jsonl(conv_dir / "messages.jsonl")
    if not messages:
        return []
    user_indexes = [i for i, row in enumerate(messages) if row.get("role") == "user"]
    cases: list[TurnCase] = []
    for pos, start in enumerate(user_indexes):
        end = user_indexes[pos + 1] if pos + 1 < len(user_indexes) else len(messages)
        turn = messages[start:end]
        user_row = turn[0]
        question = (user_row.get("content") or "").strip()
        if not question:
            continue
        next_time = None
        if pos + 1 < len(user_indexes):
            next_time = _parse_time(messages[user_indexes[pos + 1]].get("source_created_at"))
        prev = ""
        if pos > 0:
            prev = (messages[user_indexes[pos - 1]].get("content") or "").strip()
        runs, calls = _bind_usage(question, turn, usage_runs, usage_calls, next_time)
        metrics, signals = analyze_turn(turn, runs, calls)
        final_answer = _last_assistant_text(turn)
        ordinal = int(user_row.get("ordinal") or start)
        fingerprint = _fingerprint(question, final_answer, metrics)
        case_id = f"{conversation.get('id')}:{ordinal}"
        images, omitted = _collect_images(
            conv_dir=conv_dir,
            blobs_root=blobs_root,
            turn_messages=turn,
            attachments=attachments,
        )
        cases.append(
            TurnCase(
                case_id=case_id,
                fingerprint=fingerprint,
                user_id=user_id,
                email=email,
                conversation_id=conversation.get("id"),
                local_conversation_id=conversation.get("local_conversation_id"),
                user_message_id=user_row.get("id"),
                user_ordinal=ordinal,
                source="conversation",
                question=question,
                final_answer=final_answer,
                previous_user=prev,
                local_dir=str(conv_dir),
                turn_dir=conv_dir / "turns" / f"{ordinal:04d}",
                messages=_compact_messages(turn),
                metrics=metrics,
                signals=signals,
                feedback=_bind_feedback(turn, feedback_rows),
                image_paths=images,
                omitted_images=omitted,
                artifact_hints=_artifact_hints(turn),
            )
        )
    return cases


def slice_usage_only_turns(
    *,
    user_id: str,
    email: str,
    local_dir: Path,
    usage_runs: list[dict[str, Any]],
    usage_calls: list[dict[str, Any]],
) -> list[TurnCase]:
    """Users with agent runs but no archived conversation."""
    cases: list[TurnCase] = []
    by_client: dict[str, list[dict[str, Any]]] = {}
    for call in usage_calls:
        by_client.setdefault(call.get("client_run_id") or "", []).append(call)
    for run in usage_runs:
        question = (run.get("original_question") or run.get("task_preview") or "").strip()
        if not question:
            continue
        calls = by_client.get(run.get("client_run_id") or "", [])
        fake_messages = [
            {"role": "user", "content": question, "ordinal": 0, "id": run.get("id")},
            {
                "role": "assistant",
                "content": run.get("final_answer") or "",
                "ordinal": 1,
                "client_run_id": run.get("client_run_id"),
            },
        ]
        metrics, signals = analyze_turn(fake_messages, [run], calls)
        final_answer = (run.get("final_answer") or "").strip()
        fingerprint = _fingerprint(question, final_answer, metrics)
        ordinal = 0
        case_id = f"usage:{run.get('id')}"
        cases.append(
            TurnCase(
                case_id=case_id,
                fingerprint=fingerprint,
                user_id=user_id,
                email=email,
                conversation_id=None,
                local_conversation_id=run.get("local_conversation_id"),
                user_message_id=run.get("id"),
                user_ordinal=ordinal,
                source="usage_only",
                question=question,
                final_answer=final_answer,
                previous_user="",
                local_dir=str(local_dir),
                turn_dir=local_dir / "turns" / (run.get("id") or "run")[:12],
                messages=_compact_messages(fake_messages),
                metrics=metrics,
                signals=signals,
                feedback=[],
                image_paths=[],
                omitted_images=0,
                artifact_hints=[],
            )
        )
    return cases
