from __future__ import annotations

import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

import app.schemas  # noqa: F401
from app.core.database import Base
from app.core.errors import AppError
from app.api.dependencies import get_agent_feedback_service, get_current_user
from app.main import create_app
from app.models.agent_feedback import (
    AgentMessageFeedbackUpsertRequest,
    AgentMessageFeedbackView,
)
from app.models.common import OperationStatus
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.schemas.agent_message_feedback import AgentMessageFeedback
from app.schemas.agent_usage_run import AgentUsageRun
from app.schemas.organization import Organization
from app.schemas.user import User
from app.services.agent_feedback_service import AgentFeedbackService


class _StubAgentFeedbackService:
    def __init__(self) -> None:
        self.item: AgentMessageFeedbackView | None = None

    def upsert(self, _current_user: object, payload: AgentMessageFeedbackUpsertRequest):
        now = datetime.now(timezone.utc)
        self.item = AgentMessageFeedbackView(
            id="feedback-1",
            local_conversation_id=payload.local_conversation_id,
            local_message_id=payload.local_message_id,
            client_run_id=payload.client_run_id,
            vote=payload.vote,
            outcome=payload.outcome,
            issue_codes=payload.issue_codes,
            comment=payload.comment,
            app_version=payload.app_version,
            feedback_schema_version=1,
            created_at=now,
            updated_at=now,
        )
        return self.item

    def list_for_conversation(self, _current_user: object, local_conversation_id: str):
        if self.item and self.item.local_conversation_id == local_conversation_id:
            return [self.item]
        return []

    def delete(
        self,
        _current_user: object,
        *,
        local_conversation_id: str,
        local_message_id: str,
    ) -> OperationStatus:
        if self.item and (
            self.item.local_conversation_id,
            self.item.local_message_id,
        ) == (local_conversation_id, local_message_id):
            self.item = None
        return OperationStatus(ok=True)


class AgentFeedbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        self.SessionLocal = sessionmaker(
            bind=self.engine,
            autoflush=False,
            autocommit=False,
            future=True,
        )
        Base.metadata.create_all(self.engine)
        self.session = self.SessionLocal()

        self.organization = Organization(name="Feedback Org", slug="feedback-org", plan_tier="free")
        self.user = User(email="expert@example.com", password_hash="hashed")
        self.session.add_all([self.organization, self.user])
        self.session.commit()
        self.current_user = CurrentUserData(
            user=UserView.model_validate(self.user),
            organization=OrganizationView.model_validate(self.organization),
            role="owner",
        )
        self.service = AgentFeedbackService(self.session)

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_upsert_is_message_idempotent_and_preserves_structured_feedback(self) -> None:
        first = self.service.upsert(
            self.current_user,
            AgentMessageFeedbackUpsertRequest(
                local_conversation_id="conversation-1",
                local_message_id="agent-message-1",
                pi_session_id="pi-session-1",
                pi_entry_id="pi-entry-1",
                vote="up",
            ),
        )
        updated = self.service.upsert(
            self.current_user,
            AgentMessageFeedbackUpsertRequest(
                local_conversation_id="conversation-1",
                local_message_id="agent-message-1",
                vote="down",
                outcome="partial",
                issue_codes=["tool_strategy", "incomplete", "tool_strategy"],
                comment="  应先检查图层，再做数量判断。  ",
                app_version="0.8.12",
            ),
        )

        self.assertEqual(updated.id, first.id)
        self.assertEqual(updated.vote, "down")
        self.assertEqual(updated.outcome, "partial")
        self.assertEqual(updated.issue_codes, ["tool_strategy", "incomplete"])
        self.assertEqual(updated.comment, "应先检查图层，再做数量判断。")
        self.assertEqual(updated.app_version, "0.8.12")
        self.assertEqual(updated.pi_session_id, "pi-session-1")
        self.assertEqual(updated.pi_entry_id, "pi-entry-1")
        count = self.session.scalar(select(func.count()).select_from(AgentMessageFeedback))
        self.assertEqual(count, 1)
        self.assertEqual(
            self.service.list_for_conversation(self.current_user, "conversation-1"),
            [updated],
        )

    def test_feedback_can_link_to_owned_run_and_rejects_conversation_mismatch(self) -> None:
        run = AgentUsageRun(
            organization_id=self.organization.id,
            user_id=self.user.id,
            client_run_id="run-1",
            source="desktop_chat",
            local_conversation_id="conversation-1",
            started_at=datetime.now(timezone.utc),
        )
        self.session.add(run)
        self.session.commit()

        linked = self.service.upsert(
            self.current_user,
            AgentMessageFeedbackUpsertRequest(
                local_conversation_id="conversation-1",
                local_message_id="agent-message-1",
                client_run_id="run-1",
                pi_session_id="pi-session-1",
                pi_entry_id="pi-entry-1",
                vote="up",
            ),
        )
        stored = self.session.get(AgentMessageFeedback, linked.id)
        self.assertIsNotNone(stored)
        self.assertEqual(stored.agent_run_id, run.id)
        self.assertEqual(stored.pi_session_id, "pi-session-1")
        self.assertEqual(stored.pi_entry_id, "pi-entry-1")

        with self.assertRaises(AppError) as raised:
            self.service.upsert(
                self.current_user,
                AgentMessageFeedbackUpsertRequest(
                    local_conversation_id="conversation-2",
                    local_message_id="agent-message-2",
                    client_run_id="run-1",
                    vote="down",
                ),
            )
        self.assertEqual(
            raised.exception.error_code,
            "agent_feedback_run_conversation_mismatch",
        )

    def test_missing_usage_run_does_not_block_feedback(self) -> None:
        saved = self.service.upsert(
            self.current_user,
            AgentMessageFeedbackUpsertRequest(
                local_conversation_id="conversation-restored",
                local_message_id="agent-message-restored",
                client_run_id="run-from-another-backend",
                vote="up",
            ),
        )

        stored = self.session.get(AgentMessageFeedback, saved.id)
        self.assertIsNotNone(stored)
        self.assertEqual(stored.client_run_id, "run-from-another-backend")
        self.assertIsNone(stored.agent_run_id)

    def test_run_owned_by_another_user_is_not_linked(self) -> None:
        other_user = User(email="other-expert@example.com", password_hash="hashed")
        self.session.add(other_user)
        self.session.flush()
        self.session.add(
            AgentUsageRun(
                organization_id=self.organization.id,
                user_id=other_user.id,
                client_run_id="other-user-run",
                source="desktop_chat",
                local_conversation_id="conversation-1",
                started_at=datetime.now(timezone.utc),
            )
        )
        self.session.commit()

        with self.assertRaises(AppError) as raised:
            self.service.upsert(
                self.current_user,
                AgentMessageFeedbackUpsertRequest(
                    local_conversation_id="conversation-1",
                    local_message_id="agent-message-1",
                    client_run_id="other-user-run",
                    vote="up",
                ),
            )
        self.assertEqual(raised.exception.error_code, "agent_feedback_run_not_found")

    def test_delete_is_idempotent(self) -> None:
        self.service.upsert(
            self.current_user,
            AgentMessageFeedbackUpsertRequest(
                local_conversation_id="conversation-1",
                local_message_id="agent-message-1",
                comment="需要补充依据",
            ),
        )

        first = self.service.delete(
            self.current_user,
            local_conversation_id="conversation-1",
            local_message_id="agent-message-1",
        )
        second = self.service.delete(
            self.current_user,
            local_conversation_id="conversation-1",
            local_message_id="agent-message-1",
        )

        self.assertTrue(first.ok)
        self.assertTrue(second.ok)
        self.assertEqual(self.service.list_for_conversation(self.current_user, "conversation-1"), [])

    def test_empty_feedback_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            AgentMessageFeedbackUpsertRequest(
                local_conversation_id="conversation-1",
                local_message_id="agent-message-1",
            )

    def test_database_rejects_invalid_vote_and_outcome(self) -> None:
        for field_name, invalid_value in (
            ("vote", "sideways"),
            ("outcome", "mostly"),
        ):
            with self.subTest(field_name=field_name):
                record = AgentMessageFeedback(
                    organization_id=self.organization.id,
                    user_id=self.user.id,
                    local_conversation_id="conversation-constraint",
                    local_message_id=f"message-{field_name}",
                )
                setattr(record, field_name, invalid_value)
                self.session.add(record)
                with self.assertRaises(IntegrityError):
                    self.session.commit()
                self.session.rollback()


class AgentFeedbackRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = _StubAgentFeedbackService()
        self.app = create_app()
        self.app.dependency_overrides[get_current_user] = lambda: object()
        self.app.dependency_overrides[get_agent_feedback_service] = lambda: self.service
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        self.client.close()

    def test_feedback_put_list_and_delete_contract(self) -> None:
        saved = self.client.put(
            "/users/me/agent-feedback",
            json={
                "local_conversation_id": "conversation-1",
                "local_message_id": "agent-message-1",
                "vote": "down",
                "outcome": "partial",
                "issue_codes": ["tool_strategy"],
                "comment": "工具选择需要调整",
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["data"]["vote"], "down")

        listed = self.client.get(
            "/users/me/agent-feedback",
            params={"local_conversation_id": "conversation-1"},
        )
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["data"]), 1)

        deleted = self.client.delete(
            "/users/me/agent-feedback",
            params={
                "local_conversation_id": "conversation-1",
                "local_message_id": "agent-message-1",
            },
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["data"]["ok"])


if __name__ == "__main__":
    unittest.main()
