from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.agent_message_feedback import AgentMessageFeedback


class AgentMessageFeedbackRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(
        self,
        *,
        organization_id: str,
        user_id: str,
        local_conversation_id: str,
        local_message_id: str,
    ) -> AgentMessageFeedback | None:
        return self.session.scalar(
            select(AgentMessageFeedback).where(
                AgentMessageFeedback.organization_id == organization_id,
                AgentMessageFeedback.user_id == user_id,
                AgentMessageFeedback.local_conversation_id == local_conversation_id,
                AgentMessageFeedback.local_message_id == local_message_id,
            )
        )

    def list_for_conversation(
        self,
        *,
        organization_id: str,
        user_id: str,
        local_conversation_id: str,
    ) -> list[AgentMessageFeedback]:
        return list(
            self.session.scalars(
                select(AgentMessageFeedback)
                .where(
                    AgentMessageFeedback.organization_id == organization_id,
                    AgentMessageFeedback.user_id == user_id,
                    AgentMessageFeedback.local_conversation_id == local_conversation_id,
                )
                .order_by(AgentMessageFeedback.created_at.asc())
            )
        )

    def add(self, feedback: AgentMessageFeedback) -> None:
        self.session.add(feedback)

    def delete(self, feedback: AgentMessageFeedback) -> None:
        self.session.delete(feedback)
