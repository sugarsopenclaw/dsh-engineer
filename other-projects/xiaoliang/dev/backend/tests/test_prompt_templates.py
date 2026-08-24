from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.schemas  # noqa: F401
from app.api.dependencies import get_current_user, get_prompt_template_service
from app.core.config import Settings
from app.core.database import Base
from app.core.errors import AppError
from app.main import create_app
from app.models.common import OperationStatus
from app.models.prompt_template import (
    PromptTemplateCreateRequest,
    PromptTemplateUpdateRequest,
    PromptTemplateView,
)
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.schemas.organization import Organization
from app.schemas.user import User
from app.services.prompt_template_service import PromptTemplateService
from app.services.prompt_template_storage import PromptTemplateStorage


class _MemoryTemplateStorage:
    def __init__(self) -> None:
        self.objects: dict[str, dict[str, object]] = {}

    def put_json(self, key: str, payload: dict[str, object]) -> None:
        self.objects[key] = dict(payload)

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


class PromptTemplateServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        self.SessionLocal = sessionmaker(bind=self.engine, future=True)
        Base.metadata.create_all(self.engine)
        self.session = self.SessionLocal()
        self.organization = Organization(name="Template Org", slug="template-org", plan_tier="free")
        self.user = User(email="template@example.com", password_hash="hashed")
        self.other_user = User(email="other-template@example.com", password_hash="hashed")
        self.session.add_all([self.organization, self.user, self.other_user])
        self.session.commit()
        self.current_user = CurrentUserData(
            user=UserView.model_validate(self.user),
            organization=OrganizationView.model_validate(self.organization),
            role="owner",
        )
        self.other_current_user = CurrentUserData(
            user=UserView.model_validate(self.other_user),
            organization=OrganizationView.model_validate(self.organization),
            role="member",
        )
        self.storage = _MemoryTemplateStorage()
        self.service = PromptTemplateService(
            Settings(_env_file=None),
            self.session,
            storage=self.storage,
        )

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_crud_is_user_scoped_and_mirrors_complete_json_to_storage(self) -> None:
        created = self.service.create(
            self.current_user,
            PromptTemplateCreateRequest(
                title="图纸复核",
                description=" 复核关键尺寸 ",
                content=" 请检查图纸尺寸并列出疑点。 ",
            ),
        )
        self.assertEqual(created.title, "图纸复核")
        self.assertEqual(created.description, "复核关键尺寸")
        self.assertEqual(created.content, "请检查图纸尺寸并列出疑点。")
        self.assertEqual(self.service.list_for_user(self.current_user), [created])
        self.assertEqual(self.service.list_for_user(self.other_current_user), [])

        storage_key, stored = next(iter(self.storage.objects.items()))
        self.assertIn(self.current_user.user.id, storage_key)
        self.assertEqual(stored["schema_version"], 1)
        self.assertEqual(stored["content"], created.content)
        self.assertEqual(stored["user_id"], self.current_user.user.id)

        updated = self.service.update(
            self.current_user,
            created.id,
            PromptTemplateUpdateRequest(
                title="图纸终审",
                description=None,
                content="输出最终复核结论。",
            ),
        )
        self.assertEqual(updated.id, created.id)
        self.assertEqual(updated.title, "图纸终审")
        self.assertEqual(self.storage.objects[storage_key]["content"], "输出最终复核结论。")

        deleted = self.service.delete(self.current_user, created.id)
        self.assertTrue(deleted.ok)
        self.assertEqual(self.service.list_for_user(self.current_user), [])
        self.assertEqual(self.storage.objects, {})

    def test_title_is_unique_case_insensitively_and_foreign_records_are_hidden(self) -> None:
        created = self.service.create(
            self.current_user,
            PromptTemplateCreateRequest(title="Review", content="first"),
        )
        with self.assertRaises(AppError) as duplicate:
            self.service.create(
                self.current_user,
                PromptTemplateCreateRequest(title="review", content="second"),
            )
        self.assertEqual(duplicate.exception.error_code, "prompt_template_title_conflict")

        with self.assertRaises(AppError) as hidden:
            self.service.update(
                self.other_current_user,
                created.id,
                PromptTemplateUpdateRequest(title="stolen", content="no"),
            )
        self.assertEqual(hidden.exception.status_code, 404)


class PromptTemplateStorageTests(unittest.TestCase):
    def test_oss_objects_are_written_with_private_acl_and_no_cache(self) -> None:
        bucket = Mock()
        storage = PromptTemplateStorage(Settings(_env_file=None))
        with (
            patch(
                "app.services.prompt_template_storage.has_oss_credentials",
                return_value=True,
            ),
            patch(
                "app.services.prompt_template_storage.get_oss_bucket",
                return_value=bucket,
            ),
        ):
            storage.put_json("user-prompt-templates/org/user/template.json", {"content": "test"})

        _, body = bucket.put_object.call_args.args
        headers = bucket.put_object.call_args.kwargs["headers"]
        self.assertIn(b'"content":"test"', body)
        self.assertEqual(headers["x-oss-object-acl"], "private")
        self.assertEqual(headers["Cache-Control"], "no-store")


class _StubPromptTemplateService:
    def __init__(self) -> None:
        self.items: list[PromptTemplateView] = []

    def list_for_user(self, _current_user: object) -> list[PromptTemplateView]:
        return list(self.items)

    def create(self, _current_user: object, payload: PromptTemplateCreateRequest) -> PromptTemplateView:
        now = datetime.now(timezone.utc)
        item = PromptTemplateView(
            id="template-1",
            title=payload.title,
            description=payload.description,
            content=payload.content,
            created_at=now,
            updated_at=now,
        )
        self.items = [item]
        return item

    def update(
        self,
        _current_user: object,
        template_id: str,
        payload: PromptTemplateUpdateRequest,
    ) -> PromptTemplateView:
        previous = self.items[0]
        item = previous.model_copy(
            update={
                "id": template_id,
                "title": payload.title,
                "description": payload.description,
                "content": payload.content,
                "updated_at": datetime.now(timezone.utc),
            }
        )
        self.items = [item]
        return item

    def delete(self, _current_user: object, _template_id: str) -> OperationStatus:
        self.items = []
        return OperationStatus(ok=True)


class PromptTemplateRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = _StubPromptTemplateService()
        self.app = create_app()
        self.app.dependency_overrides[get_current_user] = lambda: object()
        self.app.dependency_overrides[get_prompt_template_service] = lambda: self.service
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        self.client.close()

    def test_create_list_update_delete_contract(self) -> None:
        created = self.client.post(
            "/users/me/prompt-templates",
            json={"title": "清单复核", "description": "常用", "content": "检查工程量清单"},
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["data"]["title"], "清单复核")

        listed = self.client.get("/users/me/prompt-templates")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["data"]), 1)

        updated = self.client.put(
            "/users/me/prompt-templates/template-1",
            json={"title": "清单终审", "description": None, "content": "输出复核结论"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["data"]["content"], "输出复核结论")

        deleted = self.client.delete("/users/me/prompt-templates/template-1")
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["data"]["ok"])


if __name__ == "__main__":
    unittest.main()
