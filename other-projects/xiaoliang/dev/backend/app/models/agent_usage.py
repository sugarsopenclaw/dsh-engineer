from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

AgentRunSource = Literal[
    "desktop_chat",
    "desktop_visual_index",
    "subagent_completion",
    "message_channel",
    "unknown",
]
AgentRunStatus = Literal["started", "completed", "stopped", "failed"]
AgentRunFinishStatus = Literal["completed", "stopped", "failed"]
AgentCallStatus = Literal["started", "completed", "stopped", "failed"]


class AgentUsageRunStartRequest(BaseModel):
    client_run_id: str = Field(..., min_length=1, max_length=128)
    source: AgentRunSource = "unknown"
    local_conversation_id: str | None = Field(default=None, max_length=128)
    task_preview: str | None = Field(default=None, max_length=500)
    original_question: str | None = None
    started_at: datetime | None = None

    @field_validator("client_run_id")
    @classmethod
    def normalize_client_run_id(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("client_run_id is required")
        return trimmed

    @field_validator("local_conversation_id", "task_preview", "original_question")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None


class AgentUsageRunFinishRequest(BaseModel):
    status: AgentRunFinishStatus
    final_answer: str | None = None
    error_message: str | None = None
    ended_at: datetime | None = None

    @field_validator("final_answer", "error_message")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None


class AgentUsageRunView(BaseModel):
    id: str
    organization_id: str
    user_id: str
    client_run_id: str
    source: str
    status: str
    local_conversation_id: str | None = None
    task_preview: str | None = None
    original_question: str | None = None
    final_answer: str | None = None
    started_at: datetime
    ended_at: datetime | None = None
    duration_ms: int | None = None
    error_message: str | None = None


class AgentUsageTokenTotals(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    image_count: int = 0


class AgentUsageCallView(AgentUsageTokenTotals):
    id: str
    child_run_id: str | None = None
    call_purpose: str
    model_alias: str
    provider_model: str
    status: AgentCallStatus
    started_at: datetime
    ended_at: datetime | None = None
    duration_ms: int | None = None
    error_code: str | None = None


class AgentUsageBreakdownView(AgentUsageTokenTotals):
    call_purpose: str
    child_run_id: str | None = None
    call_count: int


class AgentUsageRunDetailView(BaseModel):
    run: AgentUsageRunView
    call_count: int
    totals: AgentUsageTokenTotals
    credits_charged: int = 0
    breakdown: list[AgentUsageBreakdownView]
    calls: list[AgentUsageCallView]
    truncated: bool = False
