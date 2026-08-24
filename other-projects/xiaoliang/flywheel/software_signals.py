"""Deterministic failure / tool / token stats for one user turn."""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

FAIL_HINT = re.compile(
    r"(失败|error|aborted|timeout|timed out|traceback|exception|"
    r"请先登录|413 |502 |503 |target_not_resolved|未获得有效|"
    r"outside the runtime ceiling|模型服务返回)",
    re.IGNORECASE,
)

ABORT_HINT = re.compile(r"abort|中止|取消|cancelled|canceled", re.IGNORECASE)


def analyze_turn(
    messages: list[dict[str, Any]],
    usage_runs: list[dict[str, Any]],
    usage_calls: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    tool_ok = 0
    tool_fail = 0
    tool_counts: Counter[str] = Counter()
    tool_errors: list[str] = []
    for row in messages:
        name = (row.get("tool_name") or "").strip()
        if not name:
            continue
        tool_counts[name] += 1
        blob = "\n".join(
            part for part in (row.get("tool_result"), row.get("content")) if part
        )
        if FAIL_HINT.search(blob or ""):
            tool_fail += 1
            tool_errors.append(f"{name}: {(row.get('tool_result') or blob)[:240]}")
        else:
            tool_ok += 1

    run_statuses = [item.get("status") for item in usage_runs]
    run_errors = [item.get("error_message") for item in usage_runs if item.get("error_message")]
    duration_ms = sum(int(item.get("duration_ms") or 0) for item in usage_runs) or None
    tokens_by_purpose: dict[str, int] = {}
    input_tokens = output_tokens = total_tokens = 0
    for call in usage_calls:
        purpose = call.get("call_purpose") or "unknown"
        tokens_by_purpose[purpose] = tokens_by_purpose.get(purpose, 0) + int(call.get("total_tokens") or 0)
        input_tokens += int(call.get("input_tokens") or 0)
        output_tokens += int(call.get("output_tokens") or 0)
        total_tokens += int(call.get("total_tokens") or 0)

    hard_fail = False
    aborted = False
    kinds: list[str] = []
    if any(status == "failed" for status in run_statuses):
        hard_fail = True
        kinds.append("usage_run_failed")
    if any(ABORT_HINT.search(err or "") for err in run_errors):
        aborted = True
        kinds.append("aborted")
    if any("timeout" in (err or "").lower() or "timed out" in (err or "").lower() for err in run_errors):
        kinds.append("timeout")
    if tool_fail:
        kinds.append("tool_error")
    if any("请先登录" in (err or "") for err in run_errors):
        kinds.append("auth_required")

    level = "clean"
    if hard_fail or aborted:
        level = "hard_fail"
    elif tool_fail or kinds:
        level = "degraded"
    if not usage_runs and not messages:
        level = "unobserved"

    metrics = {
        "duration_ms": duration_ms,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "tokens_by_purpose": tokens_by_purpose,
        "tool_ok": tool_ok,
        "tool_fail": tool_fail,
        "tool_counts": dict(tool_counts),
        "run_status": ",".join(sorted({s for s in run_statuses if s})) or None,
        "run_error": (run_errors[0][:500] if run_errors else None),
    }
    signals = {
        "level_hint": level,
        "kinds": kinds,
        "hard_fail": hard_fail,
        "aborted": aborted,
        "run_errors": [err[:400] for err in run_errors[:6]],
        "tool_errors": tool_errors[:8],
        "failed_call_purposes": [
            call.get("call_purpose")
            for call in usage_calls
            if call.get("status") in {"failed", "stopped"}
        ],
    }
    return metrics, signals


def metrics_fingerprint(metrics: dict[str, Any]) -> str:
    return json.dumps(
        {
            "duration_ms": metrics.get("duration_ms"),
            "total_tokens": metrics.get("total_tokens"),
            "tool_ok": metrics.get("tool_ok"),
            "tool_fail": metrics.get("tool_fail"),
            "run_status": metrics.get("run_status"),
        },
        sort_keys=True,
    )
