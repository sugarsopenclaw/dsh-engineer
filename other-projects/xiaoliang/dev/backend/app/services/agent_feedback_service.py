from __future__ import annotations

import json

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.agent_feedback import (
    AgentFeedbackIssueCode,
    AgentMessageFeedbackUpsertRequest,
    AgentMessageFeedbackView,
)
from app.models.common import OperationStatus
from app.models.user import CurrentUserData
from app.repositories.agent_message_feedback_repository import AgentMessageFeedbackRepository
from app.repositories.agent_usage_run_repository import AgentUsageRunRepository
from app.schemas.agent_message_feedback import AgentMessageFeedback


def _parse_issue_codes(raw: str) -> list[AgentFeedbackIssueCode]:
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    allowed = {
        "cad_understanding",
        "tool_strategy",
        "incorrect_answer",
        "missed_instruction",
        "incomplete",
        "interaction",
        "other",
    }
    return [item for item in parsed if isinstance(item, str) and item in allowed]  # type: ignore[return-value]


def feedback_to_view(feedback: AgentMessageFeedback) -> AgentMessageFeedbackView:
    return AgentMessageFeedbackView(
        id=feedback.id,
        local_conversation_id=feedback.local_conversation_id,
        local_message_id=feedback.local_message_id,
        client_run_id=feedback.client_run_id,
        pi_session_id=feedback.pi_session_id,
        pi_entry_id=feedback.pi_entry_id,
        vote=feedback.vote,  # type: ignore[arg-type]
        outcome=feedback.outcome,  # type: ignore[arg-type]
        issue_codes=_parse_issue_codes(feedback.issue_codes_json),
        comment=feedback.comment,
        app_version=feedback.app_version,
        feedback_schema_version=feedback.feedback_schema_version,
        created_at=feedback.created_at,
        updated_at=feedback.updated_at,
    )


class AgentFeedbackService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.feedback = AgentMessageFeedbackRepository(session)
        self.runs = AgentUsageRunRepository(session)

    def list_for_conversation(
        self,
        current_user: CurrentUserData,
        local_conversation_id: str,
    ) -> list[AgentMessageFeedbackView]:
        records = self.feedback.list_for_conversation(
            organization_id=current_user.organization.id,
            user_id=current_user.user.id,
            local_conversation_id=local_conversation_id,
        )
        return [feedback_to_view(record) for record in records]

    def upsert(
        self,
        current_user: CurrentUserData,
        payload: AgentMessageFeedbackUpsertRequest,
    ) -> AgentMessageFeedbackView:
        organization_id = current_user.organization.id
        user_id = current_user.user.id
        agent_run_id: str | None = None
        if payload.client_run_id is not None:
            run = self.runs.get_by_client_run_id(organization_id, payload.client_run_id)
            if run is not None and run.user_id != user_id:
                raise AppError(
                    404,
                    "未找到这条回答对应的 Agent 运行记录。",
                    error_code="agent_feedback_run_not_found",
                )
            if run is not None and (
                run.local_conversation_id is not None
                and run.local_conversation_id != payload.local_conversation_id
            ):
                raise AppError(
                    409,
                    "这条 Agent 运行记录不属于当前会话。",
                    error_code="agent_feedback_run_conversation_mismatch",
                )
            if run is not None:
                agent_run_id = run.id

        record = self.feedback.get(
            organization_id=organization_id,
            user_id=user_id,
            local_conversation_id=payload.local_conversation_id,
            local_message_id=payload.local_message_id,
        )
        if record is None:
            record = AgentMessageFeedback(
                organization_id=organization_id,
                user_id=user_id,
                local_conversation_id=payload.local_conversation_id,
                local_message_id=payload.local_message_id,
            )
            self.feedback.add(record)

        self._apply(record, payload, agent_run_id)
        try:
            self.session.commit()
        except IntegrityError:
            # Double clicks/retries can race on the unique message key. Re-read and apply
            # the same full-state PUT so the endpoint remains idempotent.
            self.session.rollback()
            record = self.feedback.get(
                organization_id=organization_id,
                user_id=user_id,
                local_conversation_id=payload.local_conversation_id,
                local_message_id=payload.local_message_id,
            )
            if record is None:
                raise
            self._apply(record, payload, agent_run_id)
            self.session.commit()

        self.session.refresh(record)
        return feedback_to_view(record)

    def delete(
        self,
        current_user: CurrentUserData,
        *,
        local_conversation_id: str,
        local_message_id: str,
    ) -> OperationStatus:
        record = self.feedback.get(
            organization_id=current_user.organization.id,
            user_id=current_user.user.id,
            local_conversation_id=local_conversation_id,
            local_message_id=local_message_id,
        )
        if record is not None:
            # Product semantics: “清除反馈” is a hard delete; deleted expert text is not retained.
            self.feedback.delete(record)
            self.session.commit()
        return OperationStatus(ok=True)

    @staticmethod
    def _apply(
        record: AgentMessageFeedback,
        payload: AgentMessageFeedbackUpsertRequest,
        agent_run_id: str | None,
    ) -> None:
        if payload.client_run_id is not None:
            record.client_run_id = payload.client_run_id
            record.agent_run_id = agent_run_id
        if payload.pi_session_id is not None:
            record.pi_session_id = payload.pi_session_id
        if payload.pi_entry_id is not None:
            record.pi_entry_id = payload.pi_entry_id
        record.vote = payload.vote
        record.outcome = payload.outcome
        record.issue_codes_json = json.dumps(payload.issue_codes, ensure_ascii=False)
        record.comment = payload.comment
        if payload.app_version is not None:
            record.app_version = payload.app_version
        record.feedback_schema_version = 2
