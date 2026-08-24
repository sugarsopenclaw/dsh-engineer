"""Judge output contract (judge_v1)."""

from __future__ import annotations

from typing import Any

SCHEMA_VERSION = "judge_v1"

VERDICTS = ("good", "ordinary", "poor", "software_fail", "not_a_task")
SOFTWARE_LEVELS = ("clean", "degraded", "hard_fail", "unobserved")
INTENTS = (
    "new_task",
    "clarification",
    "correction",
    "retry_similar",
    "dissatisfied",
    "chitchat",
    "other",
)
TASK_TYPES = (
    "cad_read",
    "cad_locate",
    "cad_count",
    "cad_draft",
    "write_table",
    "search_spec",
    "chitchat",
    "other",
)
EVIDENCE_USE = ("used_evidence", "empty_talk", "unobserved")
RECOVERY = ("recovered", "not_recovered", "not_applicable", "unobserved")
QUALITY = ("good", "ordinary", "poor", "unobserved")


def empty_opinion() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "software_level": "unobserved",
        "software_summary": "",
        "intent": "other",
        "intent_summary": "",
        "user_sentiment": "neutral",
        "task_type": "other",
        "evidence_use": "unobserved",
        "recovery": "not_applicable",
        "capability_family": "",
        "quality_label": "unobserved",
        "quality_summary": "",
        "verdict": "ordinary",
        "verdict_reason": "",
        "product_note": "",
        "publish": {
            "question": "",
            "final_answer": "",
            "user_feedback": None,
            "llm_judge": "",
        },
    }


def normalize_opinion(raw: dict[str, Any], *, question: str, final_answer: str, feedback: Any) -> dict[str, Any]:
    out = empty_opinion()
    out.update({k: raw[k] for k in out if k in raw and k != "publish"})
    if out["verdict"] not in VERDICTS:
        out["verdict"] = "ordinary"
    if out["software_level"] not in SOFTWARE_LEVELS:
        out["software_level"] = "unobserved"
    if out["intent"] not in INTENTS:
        out["intent"] = "other"
    if out["task_type"] not in TASK_TYPES:
        out["task_type"] = "other"
    if out["evidence_use"] not in EVIDENCE_USE:
        out["evidence_use"] = "unobserved"
    if out["recovery"] not in RECOVERY:
        out["recovery"] = "not_applicable"
    if out["quality_label"] not in QUALITY:
        out["quality_label"] = "unobserved"
    publish = raw.get("publish") if isinstance(raw.get("publish"), dict) else {}
    out["publish"] = {
        "question": (publish.get("question") or question or "")[:4000],
        "final_answer": (publish.get("final_answer") or final_answer or "")[:8000],
        "user_feedback": publish.get("user_feedback") if publish.get("user_feedback") is not None else feedback,
        "llm_judge": (publish.get("llm_judge") or out.get("verdict_reason") or "")[:2000],
    }
    return out
