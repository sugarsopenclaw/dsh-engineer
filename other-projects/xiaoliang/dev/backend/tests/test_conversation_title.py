from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from fastapi.testclient import TestClient

from app.api.dependencies import get_conversation_title_service, get_current_user
from app.core.config import get_settings
from app.main import create_app
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.services.conversation_title_service import (
    ConversationTitleService,
    normalize_generated_title,
)


def _current_user() -> CurrentUserData:
    return CurrentUserData(
        user=UserView(id="user-1", email="tester@example.com", display_name="Tester"),
        organization=OrganizationView(id="org-1", name="Test Org", slug="test-org"),
        role="owner",
    )


class _StubConversationTitleService:
    def generate(self, first_user_message: str) -> str:
        return f"标题-{first_user_message[:8]}"


class ConversationTitleServiceTests(unittest.TestCase):
    def test_calls_qwen37_max_with_thinking_disabled(self) -> None:
        settings = get_settings().model_copy(
            update={
                "dashscope_api_key": "sk-test",
                "dashscope_base_url": "https://example.com/v1",
                "agent_conversation_title_model": "qwen3.7-max",
                "agent_conversation_title_timeout_seconds": 15.0,
            }
        )
        service = ConversationTitleService(settings)
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "“核对门窗工程量。”"}}],
        }
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client.post.return_value = mock_response

        with patch(
            "app.services.conversation_title_service.httpx.Client",
            return_value=mock_client,
        ) as client_factory:
            title = service.generate("请帮我核对这份门窗表的工程量")

        self.assertEqual(title, "核对门窗工程量")
        client_factory.assert_called_once_with(timeout=15.0)
        sent = mock_client.post.call_args.kwargs["json"]
        self.assertEqual(sent["model"], "qwen3.7-max")
        self.assertFalse(sent["enable_thinking"])
        self.assertFalse(sent["stream"])
        self.assertNotIn("reasoning_effort", sent)

    def test_normalizes_prefix_and_length(self) -> None:
        self.assertEqual(normalize_generated_title("标题：钢筋算量。"), "钢筋算量")
        self.assertEqual(len(normalize_generated_title("测" * 40)), 24)


class ConversationTitleRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        app = create_app()
        app.dependency_overrides[get_current_user] = _current_user
        app.dependency_overrides[get_conversation_title_service] = (
            lambda: _StubConversationTitleService()
        )
        self.app = app
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        self.client.close()

    def test_generates_title_for_authenticated_user(self) -> None:
        response = self.client.post(
            "/agent/v1/conversation-title",
            json={"first_user_message": "核对门窗表"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["title"], "标题-核对门窗表")

    def test_requires_authentication(self) -> None:
        self.app.dependency_overrides.pop(get_current_user, None)
        response = self.client.post(
            "/agent/v1/conversation-title",
            json={"first_user_message": "核对门窗表"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "missing_token")


if __name__ == "__main__":
    unittest.main()
