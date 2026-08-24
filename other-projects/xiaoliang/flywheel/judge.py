"""Run grok-4.5 as judge over sliced user-question turns."""

from __future__ import annotations

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from flywheel.config import corpus_dir
from flywheel.judge_prompt import SYSTEM_PROMPT
from flywheel.judge_schema import SCHEMA_VERSION, normalize_opinion
from flywheel.layout import utc_now, write_json
from flywheel.llm import LlmError, chat_json, is_transient_llm_error, llm_settings
from flywheel.slice_turns import TurnCase, slice_conversation_turns, slice_usage_only_turns
from flywheel.sqlite_store import LocalStore

log = logging.getLogger("flywheel")

CORRECTION_HINT = re.compile(r"不对|不正确|错了|重新|再看|再来|尺寸很多|不满意|不是这样")
DEFAULT_WORKERS = 5
MAX_WORKERS = 5


@dataclass
class JudgeOptions:
    limit: int | None = None
    user_filter: str | None = None
    force: bool = False
    corpus: Path | None = None
    smoke: bool = False
    workers: int = DEFAULT_WORKERS


def _rows(store: LocalStore, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    return [dict(row) for row in store.query(sql, params)]


def collect_cases(store: LocalStore, corpus: Path, user_filter: str | None) -> list[TurnCase]:
    blobs_root = corpus / "blobs" / "sha256"
    users = _rows(store, "SELECT * FROM users ORDER BY email")
    if user_filter:
        users = [u for u in users if (u.get("email") or "").lower() == user_filter.lower()]
    cases: list[TurnCase] = []
    for user in users:
        email = user["email"]
        user_id = user["id"]
        email_dir = Path(user["local_dir"]) if user.get("local_dir") else corpus / "users" / email
        convs = _rows(
            store,
            "SELECT * FROM conversations WHERE source_user_id=? AND IFNULL(message_count,0)>0",
            (user_id,),
        )
        runs = _rows(store, "SELECT * FROM usage_runs WHERE user_id=?", (user_id,))
        calls = _rows(store, "SELECT * FROM usage_calls WHERE user_id=?", (user_id,))
        feedback = _rows(store, "SELECT * FROM feedback WHERE user_id=?", (user_id,))
        if convs:
            for conv in convs:
                local_dir = conv.get("local_dir")
                if not local_dir:
                    continue
                conv_dir = Path(local_dir)
                if not conv_dir.is_dir():
                    continue
                attachments = _rows(
                    store,
                    "SELECT * FROM attachments WHERE conversation_id=?",
                    (conv["id"],),
                )
                conv_runs = [
                    run
                    for run in runs
                    if run.get("local_conversation_id") == conv.get("local_conversation_id")
                ]
                conv_calls = [
                    call
                    for call in calls
                    if call.get("client_run_id")
                    in {run.get("client_run_id") for run in conv_runs}
                ]
                conv_fb = [
                    item
                    for item in feedback
                    if item.get("local_conversation_id") == conv.get("local_conversation_id")
                ]
                cases.extend(
                    slice_conversation_turns(
                        user_id=user_id,
                        email=email,
                        conversation=conv,
                        conv_dir=conv_dir,
                        blobs_root=blobs_root,
                        attachments=attachments,
                        usage_runs=conv_runs or runs,
                        usage_calls=conv_calls or calls,
                        feedback_rows=conv_fb or feedback,
                    )
                )
        elif user.get("archive_gap"):
            cases.extend(
                slice_usage_only_turns(
                    user_id=user_id,
                    email=email,
                    local_dir=email_dir,
                    usage_runs=runs,
                    usage_calls=calls,
                )
            )
        log.info("sliced user=%s cases=%s", email, sum(1 for c in cases if c.email == email))
    return cases


def _bucket(case: TurnCase) -> str:
    if any((item.get("outcome") == "failure") or (item.get("vote") == "down") for item in case.feedback):
        return "neg_feedback"
    if case.signals.get("hard_fail") or case.metrics.get("run_status") == "failed":
        return "software_fail"
    if CORRECTION_HINT.search(case.question or ""):
        return "correction"
    if any((item.get("vote") == "up") or (item.get("outcome") == "success") for item in case.feedback):
        return "pos_feedback"
    if case.signals.get("kinds"):
        return "degraded"
    return "ordinary"


def select_unevaluated(
    cases: list[TurnCase] | list[Any],
    judged_fingerprints: set[str],
    limit: int | None,
) -> list[Any]:
    """Return turns with no successful opinion yet, capped at *limit* new items."""
    pending = [case for case in cases if getattr(case, "fingerprint", "") not in judged_fingerprints]
    if limit is None:
        return pending
    return pending[: max(0, int(limit))]


def clamp_workers(n: int | None) -> int:
    if n is None:
        return DEFAULT_WORKERS
    return max(1, min(MAX_WORKERS, int(n)))


def claim_pending_wave(
    cases: list[TurnCase] | list[Any],
    judged_fingerprints: set[str],
    workers: int,
) -> list[list[Any]]:
    """Assign at most one exclusive pending fingerprint to each worker (one wave)."""
    n = max(0, int(workers))
    taken = set(judged_fingerprints)
    used: set[str] = set()
    assigned: list[list[Any]] = []
    for case in cases:
        fingerprint = getattr(case, "fingerprint", "") or ""
        if not fingerprint or fingerprint in taken or fingerprint in used:
            continue
        used.add(fingerprint)
        assigned.append([case])
        if len(assigned) >= n:
            break
    return assigned


def load_judged_fingerprints(store: LocalStore) -> set[str]:
    rows = store.query(
        """
        SELECT fingerprint FROM judge_opinions
        WHERE fingerprint IS NOT NULL AND fingerprint != ''
          AND verdict IS NOT NULL AND verdict != '' AND verdict != 'error'
        """
    )
    return {str(row["fingerprint"]) for row in rows}


def sample_cases(cases: list[TurnCase], limit: int) -> list[TurnCase]:
    order = ["neg_feedback", "software_fail", "correction", "pos_feedback", "degraded", "ordinary"]
    buckets: dict[str, list[TurnCase]] = {name: [] for name in order}
    for case in cases:
        buckets[_bucket(case)].append(case)
    picked: list[TurnCase] = []
    seen: set[str] = set()
    while len(picked) < limit:
        progressed = False
        for name in order:
            bucket = buckets[name]
            while bucket:
                case = bucket.pop(0)
                if case.case_id in seen:
                    continue
                seen.add(case.case_id)
                picked.append(case)
                progressed = True
                break
            if len(picked) >= limit:
                break
        if not progressed:
            break
    return picked


def _pack_prompt(case: TurnCase) -> str:
    payload = {
        "case_id": case.case_id,
        "source": case.source,
        "question": case.question,
        "previous_user_message": case.previous_user or None,
        "final_answer": case.final_answer,
        "metrics": case.metrics,
        "software_signals": case.signals,
        "feedback": case.feedback,
        "artifact_hints": case.artifact_hints,
        "image_count": len(case.image_paths),
        "omitted_images": case.omitted_images,
        "transcript": case.messages,
    }
    return json.dumps(payload, ensure_ascii=False, default=str)


def _existing_fingerprint(store: LocalStore, fingerprint: str) -> bool:
    if not fingerprint:
        return False
    rows = store.query(
        """
        SELECT id FROM judge_opinions
        WHERE fingerprint=?
          AND verdict IS NOT NULL AND verdict != '' AND verdict != 'error'
        LIMIT 1
        """,
        (fingerprint,),
    )
    return bool(rows)


def _write_case(store: LocalStore, case: TurnCase) -> None:
    store.upsert(
        "task_cases",
        {
            "id": case.case_id,
            "fingerprint": case.fingerprint,
            "user_id": case.user_id,
            "email": case.email,
            "conversation_id": case.conversation_id,
            "local_conversation_id": case.local_conversation_id,
            "user_message_id": case.user_message_id,
            "user_ordinal": case.user_ordinal,
            "source": case.source,
            "question": case.question,
            "final_answer": case.final_answer,
            "local_dir": case.local_dir,
            "pack_json": json.dumps(
                {
                    "metrics": case.metrics,
                    "signals": case.signals,
                    "feedback": case.feedback,
                    "images": [str(path) for path in case.image_paths],
                    "omitted_images": case.omitted_images,
                },
                ensure_ascii=False,
                default=str,
            ),
            "created_at": utc_now(),
        },
    )
    store.upsert(
        "task_metrics",
        {
            "case_id": case.case_id,
            "duration_ms": case.metrics.get("duration_ms"),
            "input_tokens": case.metrics.get("input_tokens"),
            "output_tokens": case.metrics.get("output_tokens"),
            "total_tokens": case.metrics.get("total_tokens"),
            "tokens_by_purpose_json": json.dumps(case.metrics.get("tokens_by_purpose") or {}, ensure_ascii=False),
            "tool_ok": case.metrics.get("tool_ok"),
            "tool_fail": case.metrics.get("tool_fail"),
            "tool_counts_json": json.dumps(case.metrics.get("tool_counts") or {}, ensure_ascii=False),
            "run_status": case.metrics.get("run_status"),
            "run_error": case.metrics.get("run_error"),
        },
    )
    store.upsert(
        "software_signals",
        {
            "case_id": case.case_id,
            "signals_json": json.dumps(case.signals, ensure_ascii=False, default=str),
        },
    )


def _cap_images(case: TurnCase) -> None:
    before_images = list(case.image_paths)
    images: list[Path] = []
    for path in before_images:
        if len(images) >= 4:
            break
        try:
            if path.stat().st_size > 800_000:
                continue
        except OSError:
            continue
        images.append(path)
    case.omitted_images += len(before_images) - len(images)
    case.image_paths = images


def _evaluate_llm(case: TurnCase, settings: dict[str, str]) -> dict[str, Any]:
    """HTTP-only judge call. Must not touch sqlite."""
    _cap_images(case)
    log.info(
        "judging %s images=%s q=%s",
        case.case_id,
        len(case.image_paths),
        (case.question or "")[:80].replace("\n", " "),
    )
    try:
        has_images = bool(case.image_paths)
        try:
            result = chat_json(
                system=SYSTEM_PROMPT,
                user_text=_pack_prompt(case),
                image_paths=case.image_paths,
                model=settings["i2t"] if has_images else settings["t2t"],
                timeout=45 if has_images else 90,
                retries=2,
            )
        except LlmError as exc:
            if case.image_paths and is_transient_llm_error(exc):
                log.warning("retry without images case=%s err=%s", case.case_id, exc)
                case.omitted_images += len(case.image_paths)
                case.image_paths = []
                result = chat_json(
                    system=SYSTEM_PROMPT,
                    user_text=_pack_prompt(case) + "\n\n(本轮证据图因网关超时未送出，按文本评价。)",
                    image_paths=[],
                    model=settings["t2t"],
                    timeout=90,
                    retries=3,
                )
            else:
                raise
        opinion = normalize_opinion(
            result["parsed"],
            question=case.question,
            final_answer=case.final_answer,
            feedback=case.feedback or None,
        )
        return {"ok": True, "result": result, "opinion": opinion}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": exc}


def _persist_eval(
    store: LocalStore,
    case: TurnCase,
    run_id: int,
    settings: dict[str, str],
    payload: dict[str, Any],
    stats: dict[str, Any],
    index: int,
    total: int,
) -> None:
    if payload.get("ok"):
        result = payload["result"]
        opinion = payload["opinion"]
        usage = result.get("usage") or {}
        store.execute(
            """
            INSERT INTO judge_opinions (
              case_id, fingerprint, judge_run_id, schema_version, verdict, software_level,
              intent, task_type, evidence_use, recovery, capability_family, quality_label,
              product_note, opinion_json, raw_text, judge_model, judge_duration_ms,
              judge_input_tokens, judge_output_tokens, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                case.case_id,
                case.fingerprint,
                run_id,
                SCHEMA_VERSION,
                opinion.get("verdict"),
                opinion.get("software_level"),
                opinion.get("intent"),
                opinion.get("task_type"),
                opinion.get("evidence_use"),
                opinion.get("recovery"),
                opinion.get("capability_family"),
                opinion.get("quality_label"),
                opinion.get("product_note"),
                json.dumps(opinion, ensure_ascii=False),
                result.get("raw_text"),
                result.get("model"),
                result.get("duration_ms"),
                usage.get("prompt_tokens") or usage.get("input_tokens"),
                usage.get("completion_tokens") or usage.get("output_tokens"),
                utc_now(),
            ),
            commit=False,
        )
        if case.turn_dir is not None:
            write_json(
                case.turn_dir / "judge.json",
                {
                    "case_id": case.case_id,
                    "fingerprint": case.fingerprint,
                    "metrics": case.metrics,
                    "software_signals": case.signals,
                    "feedback": case.feedback,
                    "images": [str(path) for path in case.image_paths],
                    "omitted_images": case.omitted_images,
                    "opinion": opinion,
                    "judge_model": result.get("model"),
                },
            )
        stats["judged"] += 1
        log.info(
            "judged %s/%s %s verdict=%s images=%s model=%s",
            index,
            total,
            case.case_id,
            opinion.get("verdict"),
            len(case.image_paths),
            result.get("model"),
        )
        return
    exc = payload.get("error")
    stats["failed"] += 1
    log.warning("judge failed case=%s err=%s", case.case_id, exc)
    body = exc.body[:400] if isinstance(exc, LlmError) and getattr(exc, "body", None) else ""
    if body:
        log.warning("llm body %s", body)
    store.execute(
        """
        INSERT INTO judge_opinions (
          case_id, fingerprint, judge_run_id, schema_version, verdict,
          opinion_json, raw_text, judge_model, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
        """,
        (
            case.case_id,
            "",
            run_id,
            SCHEMA_VERSION,
            "error",
            json.dumps({"error": str(exc), "body": body}, ensure_ascii=False),
            str(exc)[:2000],
            settings["t2t"],
            utc_now(),
        ),
        commit=False,
    )


def run_judge(options: JudgeOptions) -> dict[str, Any]:
    corpus = options.corpus or corpus_dir()
    store = LocalStore(corpus / "index.sqlite")
    settings = llm_settings()
    stats: dict[str, Any] = {
        "sliced": 0,
        "selected": 0,
        "skipped_unchanged": 0,
        "judged": 0,
        "failed": 0,
        "model": settings["t2t"],
    }
    run_id = None
    workers = clamp_workers(options.workers)
    stats["workers"] = workers
    try:
        cur = store.execute(
            """
            INSERT INTO judge_runs (started_at, status, model, user_filter, limit_n, force_judge)
            VALUES (?, 'running', ?, ?, ?, ?)
            """,
            (utc_now(), settings["t2t"], options.user_filter, options.limit, int(options.force)),
        )
        run_id = int(cur.lastrowid)
        cases = collect_cases(store, corpus, options.user_filter)
        stats["sliced"] = len(cases)
        judged_fps = set() if options.force else load_judged_fingerprints(store)
        selected = select_unevaluated(cases, judged_fps, options.limit)
        stats["selected"] = len(selected)
        stats["already_judged"] = len(judged_fps)
        log.info(
            "judge sliced=%s already_judged=%s selected=%s model=%s workers=%s",
            stats["sliced"],
            stats["already_judged"],
            stats["selected"],
            settings["t2t"],
            workers,
        )
        pending = list(selected)
        claimed: set[str] = set()
        done = 0
        total = len(selected)
        while pending:
            wave_groups = claim_pending_wave(pending, judged_fps | claimed, workers)
            wave = [group[0] for group in wave_groups if group]
            if not wave:
                break
            for case in wave:
                claimed.add(case.fingerprint)
            pending = [case for case in pending if case.fingerprint not in claimed]
            to_run: list[TurnCase] = []
            for case in wave:
                if not options.force and _existing_fingerprint(store, case.fingerprint):
                    stats["skipped_unchanged"] += 1
                    log.info("skip unchanged %s %s", case.email, case.case_id)
                    continue
                _write_case(store, case)
                to_run.append(case)
            if not to_run:
                continue
            log.info("wave size=%s workers=%s", len(to_run), workers)
            with ThreadPoolExecutor(max_workers=len(to_run)) as pool:
                futures: dict = {}
                for i, case in enumerate(to_run):
                    if i:
                        time.sleep(0.5)
                    futures[pool.submit(_evaluate_llm, case, settings)] = case
                for future in as_completed(futures):
                    case = futures[future]
                    done += 1
                    try:
                        payload = future.result()
                    except Exception as exc:  # noqa: BLE001
                        payload = {"ok": False, "error": exc}
                    _persist_eval(store, case, run_id, settings, payload, stats, done, total)
                    store.commit()
                    if payload.get("ok") and case.fingerprint:
                        judged_fps.add(case.fingerprint)
        store.commit()
        stats["remaining"] = len(
            select_unevaluated(cases, load_judged_fingerprints(store), None)
        )
        store.execute(
            "UPDATE judge_runs SET finished_at=?, status=?, stats_json=? WHERE id=?",
            (utc_now(), "success", json.dumps(stats, ensure_ascii=False), run_id),
        )
        return {"run_id": run_id, "stats": stats}
    except Exception:
        if run_id is not None:
            store.execute(
                "UPDATE judge_runs SET finished_at=?, status=?, stats_json=? WHERE id=?",
                (utc_now(), "failed", json.dumps(stats, ensure_ascii=False), run_id),
            )
        raise
    finally:
        store.close()


def judge_status(corpus: Path | None = None) -> dict[str, Any]:
    root = corpus or corpus_dir()
    store = LocalStore(root / "index.sqlite")
    try:
        latest = store.query("SELECT * FROM judge_runs ORDER BY id DESC LIMIT 1")
        verdicts = store.query(
            "SELECT verdict, COUNT(*) AS n FROM judge_opinions GROUP BY verdict"
        )
        judged = int(
            store.query(
                """
                SELECT COUNT(DISTINCT fingerprint) AS n FROM judge_opinions
                WHERE fingerprint IS NOT NULL AND fingerprint != ''
                  AND verdict IS NOT NULL AND verdict != '' AND verdict != 'error'
                """
            )[0]["n"]
        )
        sliced = judged
        remaining = max(0, sliced - judged)
        if latest:
            raw = latest[0]["stats_json"] if "stats_json" in latest[0].keys() else None
            if raw:
                try:
                    parsed = json.loads(raw)
                    sliced = int(parsed.get("sliced") or judged)
                    if parsed.get("remaining") is not None:
                        remaining = int(parsed["remaining"])
                    else:
                        remaining = max(0, sliced - judged)
                except (TypeError, ValueError, json.JSONDecodeError):
                    remaining = max(0, sliced - judged)
        return {
            "latest_run": dict(latest[0]) if latest else None,
            "opinions": int(store.query("SELECT COUNT(*) AS n FROM judge_opinions")[0]["n"]),
            "successful_opinions": judged,
            "remaining": remaining,
            "cases": int(store.query("SELECT COUNT(*) AS n FROM task_cases")[0]["n"]),
            "verdicts": {row["verdict"] or "null": int(row["n"]) for row in verdicts},
        }
    finally:
        store.close()
