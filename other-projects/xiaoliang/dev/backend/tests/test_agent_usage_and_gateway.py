from __future__ import annotations

import unittest
from datetime import timedelta
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

import app.schemas  # noqa: F401
from app.core.database import Base
from app.core.errors import AppError
from app.core.security import utcnow
from app.domain.billing.errors import BillingErrorCode
from app.models.agent_usage import AgentUsageRunFinishRequest, AgentUsageRunStartRequest
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.schemas.organization import Organization
from app.schemas.usage_charge import UsageCharge
from app.schemas.usage_credit_grant import GRANT_TYPE_MANUAL, UsageCreditGrant
from app.schemas.user import User
from app.services.agent_gateway_service import AgentGatewayService
from app.services.agent_usage_service import AgentUsageService


class AgentUsageAndGatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, future=True)
        Base.metadata.create_all(self.engine)
        self.session = self.SessionLocal()

        self.organization = Organization(name="Org", slug="org", plan_tier="free")
        self.user = User(email="agent@example.com", password_hash="hashed")
        self.session.add_all([self.organization, self.user])
        self.session.commit()
        self.current_user = CurrentUserData(
            user=UserView.model_validate(self.user),
            organization=OrganizationView.model_validate(self.organization),
            role="owner",
        )
        self.service = AgentUsageService(self.session)
        self.previous_credits_enforce = self.service.ledger.settings.billing_credits_enforce
        self.service.ledger.settings.billing_credits_enforce = True
        self.grant_credits(10_000)

    def tearDown(self) -> None:
        self.service.ledger.settings.billing_credits_enforce = self.previous_credits_enforce
        self.session.close()
        self.engine.dispose()

    def grant_credits(self, credits: int) -> UsageCreditGrant:
        now = utcnow()
        grant = UsageCreditGrant(
            organization_id=self.organization.id,
            grant_type=GRANT_TYPE_MANUAL,
            plan_tier="starter",
            total_credits=credits,
            used_credits=0,
            period_started_at=now,
            period_ends_at=now + timedelta(days=365),
        )
        self.session.add(grant)
        self.session.commit()
        return grant

    def start_call(self, run, *, call_purpose: str = "main"):
        return self.service.start_gateway_call(
            self.service.get_started_run(self.organization.id, run.client_run_id),
            child_run_id=None,
            call_purpose=call_purpose,
            model_alias="xiaoliang-agent-default",
            provider_model="qwen3.8-max",
            image_count=0,
        )

    def charge_count(self) -> int:
        return self.session.scalar(select(func.count()).select_from(UsageCharge))

    def test_starting_a_run_is_free(self) -> None:
        first = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(client_run_id="run-1", source="desktop_chat"),
        )
        second = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(client_run_id="run-1", source="desktop_chat"),
        )
        self.assertEqual(first.id, second.id)
        self.assertEqual(self.charge_count(), 0)

    def test_subagent_completion_wake_keeps_its_own_run_source(self) -> None:
        started = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(
                client_run_id="run-subagent-wake",
                source="subagent_completion",
                local_conversation_id="conversation-1",
            ),
        )
        self.assertEqual(started.source, "subagent_completion")
        self.assertEqual(self.charge_count(), 0)

    def test_run_start_is_blocked_when_credits_are_gone(self) -> None:
        for grant in self.session.scalars(select(UsageCreditGrant)).all():
            grant.used_credits = grant.total_credits
        self.session.commit()

        with self.assertRaises(AppError) as raised:
            self.service.start_run(
                self.current_user,
                AgentUsageRunStartRequest(client_run_id="run-blocked", source="desktop_chat"),
            )
        self.assertEqual(raised.exception.status_code, 402)
        self.assertEqual(raised.exception.error_code, BillingErrorCode.QUOTA_EXCEEDED)

    def test_gateway_call_charges_reported_tokens(self) -> None:
        run = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(client_run_id="run-charge", source="desktop_chat"),
        )
        call = self.start_call(run)
        self.service.finish_gateway_call(
            call.id,
            status="completed",
            usage={"prompt_tokens": 500, "completion_tokens": 300, "total_tokens": 800},
        )

        charge = self.session.scalars(select(UsageCharge)).one()
        self.assertEqual(charge.credits, 3)
        self.assertEqual(charge.agent_usage_call_id, call.id)
        self.assertEqual(charge.entrypoint, "gateway.main")

        detail = self.service.get_run_detail(self.current_user, "run-charge")
        self.assertEqual(detail.credits_charged, 3)

    def test_cached_prompt_tokens_are_billed_at_the_cache_rate(self) -> None:
        run = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(client_run_id="run-cached", source="desktop_chat"),
        )
        call = self.start_call(run)
        self.service.finish_gateway_call(
            call.id,
            status="completed",
            usage={
                "prompt_tokens": 100_000,
                "completion_tokens": 0,
                "prompt_tokens_details": {"cached_tokens": 100_000},
            },
        )
        charge = self.session.scalars(select(UsageCharge)).one()
        self.assertEqual(charge.cached_input_tokens, 100_000)
        self.assertEqual(charge.credits, 21)

    def test_multiple_calls_accumulate_on_the_run(self) -> None:
        run = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(client_run_id="run-multi", source="desktop_chat"),
        )
        for _ in range(3):
            call = self.start_call(run)
            self.service.finish_gateway_call(
                call.id,
                status="completed",
                usage={"prompt_tokens": 500, "completion_tokens": 300},
            )
        self.assertEqual(self.charge_count(), 3)
        detail = self.service.get_run_detail(self.current_user, "run-multi")
        self.assertEqual(detail.credits_charged, 9)

    def test_call_without_reported_usage_is_free(self) -> None:
        run = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(client_run_id="run-failed", source="desktop_chat"),
        )
        call = self.start_call(run)
        self.service.finish_gateway_call(call.id, status="failed", error_code="upstream_error")
        self.assertEqual(self.charge_count(), 0)

    def test_finishing_a_call_twice_charges_once(self) -> None:
        run = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(client_run_id="run-dup", source="desktop_chat"),
        )
        call = self.start_call(run)
        usage = {"prompt_tokens": 500, "completion_tokens": 300}
        self.service.finish_gateway_call(call.id, status="completed", usage=usage)
        self.service.finish_gateway_call(call.id, status="completed", usage=usage)
        self.assertEqual(self.charge_count(), 1)

    def test_finish_run_updates_status(self) -> None:
        started = self.service.start_run(
            self.current_user,
            AgentUsageRunStartRequest(client_run_id="run-finish", source="desktop_chat"),
        )
        finished = self.service.finish_run(
            self.current_user,
            "run-finish",
            AgentUsageRunFinishRequest(status="completed", final_answer="done"),
        )
        self.assertEqual(started.status, "started")
        self.assertEqual(finished.status, "completed")
        self.assertEqual(finished.final_answer, "done")

    def test_gateway_rejects_unknown_model(self) -> None:
        gateway = AgentGatewayService()
        with self.assertRaises(AppError) as raised:
            gateway.build_provider_payload(
                {
                    "model": "gpt-4o",
                    "messages": [{"role": "user", "content": "hi"}],
                }
            )
        self.assertEqual(raised.exception.error_code, BillingErrorCode.MODEL_NOT_ALLOWED)

    def test_gateway_maps_alias(self) -> None:
        settings = MagicMock()
        settings.agent_default_model = "qwen3.8-max"
        settings.agent_vision_model = "qwen3.8-max"
        settings.agent_expert_model = "qwen3.8-max"
        gateway = AgentGatewayService(settings)
        payload = gateway.build_provider_payload(
            {
                "model": "xiaoliang-agent-default",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": False,
                "enable_thinking": True,
                "reasoning_effort": "xhigh",
                "xiaoliang_client_run_id": "client-run-1",
                "xiaoliang_child_run_id": "child-run-1",
                "xiaoliang_call_purpose": "subagent",
            }
        )
        self.assertEqual(payload["model"], "qwen3.8-max")
        self.assertTrue(payload["enable_thinking"])
        self.assertEqual(payload["reasoning_effort"], "xhigh")
        self.assertNotIn("thinking_budget", payload)
        self.assertNotIn("xiaoliang_client_run_id", payload)
        self.assertNotIn("xiaoliang_child_run_id", payload)
        self.assertNotIn("xiaoliang_call_purpose", payload)

    def test_gateway_rejects_unsupported_reasoning_effort(self) -> None:
        settings = MagicMock()
        settings.agent_default_model = "qwen3.8-max"
        settings.agent_vision_model = "qwen3.8-max"
        settings.agent_expert_model = "qwen3.8-max"
        gateway = AgentGatewayService(settings)

        with self.assertRaises(AppError) as raised:
            gateway.build_provider_payload(
                {
                    "model": "xiaoliang-agent-default",
                    "messages": [{"role": "user", "content": "hi"}],
                    "reasoning_effort": "high",
                }
            )

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.error_code, "invalid_agent_request")
        self.assertEqual(raised.exception.details, {"allowed": ["low", "medium", "xhigh"]})

    def test_reasoning_effort_removes_conflicting_thinking_budget(self) -> None:
        settings = MagicMock()
        settings.agent_default_model = "qwen3.8-max"
        settings.agent_vision_model = "qwen3.8-max"
        settings.agent_expert_model = "qwen3.8-max"
        gateway = AgentGatewayService(settings)

        payload = gateway.build_provider_payload(
            {
                "model": "xiaoliang-agent-default",
                "messages": [{"role": "user", "content": "hi"}],
                "reasoning_effort": "low",
                "thinking_budget": 4096,
            }
        )

        self.assertEqual(payload["reasoning_effort"], "low")
        self.assertNotIn("thinking_budget", payload)

    def test_streaming_always_requests_usage_so_calls_can_be_billed(self) -> None:
        settings = MagicMock()
        settings.agent_default_model = "qwen3.8-max"
        settings.agent_vision_model = "qwen3.8-max"
        settings.agent_expert_model = "qwen3.8-max"
        gateway = AgentGatewayService(settings)

        payload = gateway.build_provider_payload(
            {
                "model": "xiaoliang-agent-default",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": True,
            }
        )
        self.assertTrue(payload["stream_options"]["include_usage"])

        # A client that opts out must not be able to make its own calls free.
        opted_out = gateway.build_provider_payload(
            {
                "model": "xiaoliang-agent-default",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": True,
                "stream_options": {"include_usage": False},
            }
        )
        self.assertTrue(opted_out["stream_options"]["include_usage"])

    def test_non_streaming_payload_has_no_stream_options(self) -> None:
        settings = MagicMock()
        settings.agent_default_model = "qwen3.8-max"
        settings.agent_vision_model = "qwen3.8-max"
        settings.agent_expert_model = "qwen3.8-max"
        gateway = AgentGatewayService(settings)
        payload = gateway.build_provider_payload(
            {
                "model": "xiaoliang-agent-default",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": False,
            }
        )
        self.assertNotIn("stream_options", payload)

    def test_gateway_uses_longer_timeout_for_cad_auxiliary_calls(self) -> None:
        settings = MagicMock()
        settings.agent_gateway_timeout_seconds = 120
        settings.agent_gateway_cad_timeout_seconds = 2_100
        gateway = AgentGatewayService(settings)

        self.assertEqual(gateway.non_stream_timeout_seconds("main"), 120)
        self.assertEqual(gateway.non_stream_timeout_seconds("subagent"), 120)
        self.assertEqual(gateway.non_stream_timeout_seconds("compaction"), 120)
        for call_purpose in ("cad_query", "visual_index", "schema_repair"):
            with self.subTest(call_purpose=call_purpose):
                self.assertEqual(gateway.non_stream_timeout_seconds(call_purpose), 2_100)

        settings.agent_gateway_timeout_seconds = 2_400
        self.assertEqual(gateway.non_stream_timeout_seconds("cad_query"), 2_400)

    def test_gateway_complete_applies_cad_auxiliary_timeout(self) -> None:
        settings = MagicMock()
        settings.agent_default_model = "qwen3.8-max"
        settings.agent_vision_model = "qwen3.8-max"
        settings.agent_expert_model = "qwen3.8-max"
        settings.dashscope_api_key = "sk-test"
        settings.dashscope_base_url = "https://example.com/v1"
        settings.agent_gateway_timeout_seconds = 120
        settings.agent_gateway_cad_timeout_seconds = 2_100
        gateway = AgentGatewayService(settings)

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "done"}}],
        }
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client.post.return_value = mock_response

        with patch(
            "app.services.agent_gateway_service.httpx.Client",
            return_value=mock_client,
        ) as client_factory:
            gateway.complete(
                {
                    "model": "xiaoliang-agent-default",
                    "messages": [{"role": "user", "content": "query"}],
                },
                "cad_query",
            )

        client_factory.assert_called_once_with(timeout=2_100)


if __name__ == "__main__":
    unittest.main()
