from __future__ import annotations

import os
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from app.api.dependencies import get_agent_gateway_service
from app.api.routes import agent_gateway
from app.main import create_app
from app.models.user import CurrentUserData, OrganizationView, UserView


def _current_user() -> CurrentUserData:
    return CurrentUserData(
        user=UserView(id="user-1", email="tester@example.com", display_name="Tester"),
        organization=OrganizationView(id="org-1", name="Test Org", slug="test-org"),
        role="owner",
    )


class AgentGatewaySessionLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            future=True,
            poolclass=QueuePool,
            pool_size=1,
            max_overflow=0,
            connect_args={"check_same_thread": False},
        )
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            autocommit=False,
            future=True,
        )
        self.sessions: list[Session] = []
        self.events: list[tuple[str, int]] = []
        self.app = create_app()
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        self.client.close()
        self.engine.dispose()

    def _service_patches(self):
        owner = self

        class _AuthService:
            def __init__(self, session: Session) -> None:
                self.session = session
                owner.sessions.append(session)

            def resolve_current_user(self, _access_token: str) -> CurrentUserData:
                self.session.execute(text("SELECT 1"))
                owner.events.append(("auth", owner.engine.pool.checkedout()))
                return _current_user()

        class _Ledger:
            def __init__(self, session: Session) -> None:
                self.session = session

            def assert_can_spend(self, _organization_id: str) -> None:
                self.session.execute(text("SELECT 1"))

        class _UsageService:
            def __init__(self, session: Session) -> None:
                self.session = session
                self.ledger = _Ledger(session)
                owner.sessions.append(session)

            def assert_active_run(self, _organization_id: str, client_run_id: str):
                self.session.execute(text("SELECT 1"))
                return SimpleNamespace(id="run-db-1", client_run_id=client_run_id, user_id="user-1")

            def get_started_run(self, _organization_id: str, client_run_id: str):
                return self.assert_active_run(_organization_id, client_run_id)

            def start_gateway_call(self, _run, **_kwargs):
                self.session.execute(text("SELECT 1"))
                owner.events.append(("start", owner.engine.pool.checkedout()))
                return SimpleNamespace(id="call-1")

            def finish_gateway_call(self, _call_id: str, **_kwargs):
                self.session.execute(text("SELECT 1"))
                owner.events.append(("finish", owner.engine.pool.checkedout()))
                return SimpleNamespace(id="call-1")

        return (
            patch("app.core.database.SessionLocal", self.session_factory),
            patch("app.api.routes.agent_gateway.AuthService", _AuthService),
            patch("app.api.routes.agent_gateway.AgentUsageService", _UsageService),
        )

    def _request_payload(self, *, stream: bool) -> dict[str, object]:
        return {
            "model": "xiaoliang-agent-default",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": stream,
            "xiaoliang_client_run_id": "run-1",
        }

    def test_stream_does_not_hold_database_connection_during_sse_io(self) -> None:
        owner = self

        class _Gateway:
            def resolve_provider_model(self, _model_alias: str) -> str:
                return "qwen3.8-max"

            def stream(self, _payload, _call_purpose):
                owner.events.append(("stream", owner.engine.pool.checkedout()))
                yield 'data: {"usage":{"total_tokens":2}}\n\n'
                yield "data: [DONE]\n\n"

        self.app.dependency_overrides[get_agent_gateway_service] = _Gateway
        patches = self._service_patches()
        with patches[0], patches[1], patches[2]:
            with self.client.stream(
                "POST",
                "/agent/v1/chat/completions",
                headers={"Authorization": "Bearer xl.run-1.test-token"},
                json=self._request_payload(stream=True),
            ) as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.engine.pool.checkedout(), 0)
                response.read()
                self.assertIn("[DONE]", response.text)

        self.assertIn(("stream", 0), self.events)
        self.assertEqual(self.events[-1][0], "finish")
        self.assertEqual(self.engine.pool.checkedout(), 0)
        self.assertIsNot(self.sessions[0], self.sessions[-1])

    def test_non_streaming_io_and_finish_use_separate_transactions(self) -> None:
        owner = self

        class _Gateway:
            def resolve_provider_model(self, _model_alias: str) -> str:
                return "qwen3.8-max"

            def complete(self, _payload, _call_purpose):
                owner.events.append(("complete", owner.engine.pool.checkedout()))
                return {"choices": [], "usage": {"total_tokens": 3}}

        self.app.dependency_overrides[get_agent_gateway_service] = _Gateway
        patches = self._service_patches()
        with patches[0], patches[1], patches[2]:
            response = self.client.post(
                "/agent/v1/chat/completions",
                headers={"Authorization": "Bearer xl.run-1.test-token"},
                json=self._request_payload(stream=False),
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn(("complete", 0), self.events)
        self.assertEqual([name for name, _ in self.events], ["auth", "start", "complete", "finish"])
        self.assertEqual(self.engine.pool.checkedout(), 0)
        self.assertIsNot(self.sessions[0], self.sessions[-1])

    def test_finish_retries_a_lost_pool_checkout_then_charges(self) -> None:
        attempts: list[int] = []
        slept: list[float] = []

        @contextmanager
        def flaky_session_scope():
            attempts.append(len(attempts))
            if len(attempts) <= 2:
                raise SQLAlchemyTimeoutError("QueuePool limit reached")
            yield object()

        finished: list[dict[str, object]] = []

        class _UsageService:
            def __init__(self, _session: object) -> None:
                pass

            def finish_gateway_call(self, call_id: str, **kwargs: object) -> None:
                finished.append({"call_id": call_id, **kwargs})

        with (
            patch("app.api.routes.agent_gateway.session_scope", flaky_session_scope),
            patch("app.api.routes.agent_gateway.AgentUsageService", _UsageService),
            patch("app.api.routes.agent_gateway.time.sleep", slept.append),
        ):
            agent_gateway.finish_gateway_call_durably(
                "call-1",
                status="completed",
                usage={"total_tokens": 7},
            )

        self.assertEqual(len(attempts), 3)
        self.assertEqual(slept, list(agent_gateway.GATEWAY_FINISH_RETRY_DELAYS_SECONDS))
        self.assertEqual(
            finished,
            [{"call_id": "call-1", "status": "completed", "usage": {"total_tokens": 7}, "error_code": None}],
        )

    def test_finish_gives_up_without_raising_when_the_pool_stays_saturated(self) -> None:
        @contextmanager
        def always_busy_session_scope():
            raise SQLAlchemyTimeoutError("QueuePool limit reached")
            yield  # pragma: no cover - unreachable, keeps this a generator

        with (
            patch("app.api.routes.agent_gateway.session_scope", always_busy_session_scope),
            patch("app.api.routes.agent_gateway.time.sleep", lambda _delay: None),
        ):
            agent_gateway.finish_gateway_call_durably("call-1", status="completed")

    def test_invalid_json_is_rejected_before_invalid_credentials(self) -> None:
        class _Gateway:
            def resolve_provider_model(self, _model_alias: str) -> str:
                return "qwen3.8-max"

        self.app.dependency_overrides[get_agent_gateway_service] = _Gateway
        response = self.client.post(
            "/agent/v1/chat/completions",
            headers={
                "Authorization": "Bearer invalid",
                "Content-Type": "application/json",
            },
            content="{invalid-json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["code"], "invalid_agent_request")


if __name__ == "__main__":
    unittest.main()
