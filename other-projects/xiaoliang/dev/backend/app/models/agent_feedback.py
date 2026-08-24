from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

AgentFeedbackVote = Literal["up", "down"]
AgentFeedbackOutcome = Literal["success", "partial", "failure"]
AgentFeedbackIssueCode = Literal[
    "cad_understanding",
    "tool_strategy",
    "incorrect_answer",
    "missed_instruction",
    "incomplete",
    "interaction",
    "other",
]


class AgentMessageFeedbackUpsertRequest(BaseModel):
    local_conversation_id: str = Field(min_length=1, max_length=128)
    local_message_id: str = Field(min_length=1, max_length=128)
    client_run_id: str | None = Field(default=None, max_length=128)
    pi_session_id: str | None = Field(default=None, max_length=128)
    pi_entry_id: str | None = Field(default=None, max_length=128)
    vote: AgentFeedbackVote | None = None
    outcome: AgentFeedbackOutcome | None = None
    issue_codes: list[AgentFeedbackIssueCode] = Field(default_factory=list, max_length=8)
    comment: str | None = Field(default=None, max_length=4_000)
    app_version: str | None = Field(default=None, max_length=64)

    @field_validator("local_conversation_id", "local_message_id")
    @classmethod
    def normalize_required_ids(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value is required")
        return normalized

    @field_validator("client_run_id", "pi_session_id", "pi_entry_id", "comment", "app_version")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("issue_codes")
    @classmethod
    def deduplicate_issue_codes(
        cls,
        value: list[AgentFeedbackIssueCode],
    ) -> list[AgentFeedbackIssueCode]:
        return list(dict.fromkeys(value))

    @model_validator(mode="after")
    def require_feedback_signal(self) -> AgentMessageFeedbackUpsertRequest:
        if self.vote is None and self.outcome is None and not self.issue_codes and self.comment is None:
            raise ValueError("at least one feedback signal is required")
        return self


class AgentMessageFeedbackView(BaseModel):
    id: str
    local_conversation_id: str
    local_message_id: str
    client_run_id: str | None = None
    pi_session_id: str | None = None
    pi_entry_id: str | None = None
    vote: AgentFeedbackVote | None = None
    outcome: AgentFeedbackOutcome | None = None
    issue_codes: list[AgentFeedbackIssueCode] = Field(default_factory=list)
    comment: str | None = None
    app_version: str | None = None
    feedback_schema_version: int
    created_at: datetime
    updated_at: datetime
