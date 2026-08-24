from __future__ import annotations

import hashlib
from typing import Protocol

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.models.common import OperationStatus
from app.models.prompt_template import (
    PromptTemplateCreateRequest,
    PromptTemplateUpdateRequest,
    PromptTemplateView,
)
from app.models.user import CurrentUserData
from app.repositories.user_prompt_template_repository import UserPromptTemplateRepository
from app.schemas.base import generate_uuid, utcnow
from app.schemas.user_prompt_template import UserPromptTemplate
from app.services.prompt_template_storage import PromptTemplateStorage

MAX_PROMPT_TEMPLATES_PER_USER = 100


class PromptTemplateObjectStorage(Protocol):
    def put_json(self, key: str, payload: dict[str, object]) -> None: ...

    def delete(self, key: str) -> None: ...


def prompt_template_to_view(template: UserPromptTemplate) -> PromptTemplateView:
    return PromptTemplateView(
        id=template.id,
        title=template.title,
        description=template.description,
        content=template.content,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


class PromptTemplateService:
    def __init__(
        self,
        settings: Settings,
        session: Session,
        *,
        storage: PromptTemplateObjectStorage | None = None,
    ) -> None:
        self.session = session
        self.templates = UserPromptTemplateRepository(session)
        self.storage = storage or PromptTemplateStorage(settings)

    def list_for_user(self, current_user: CurrentUserData) -> list[PromptTemplateView]:
        records = self.templates.list_for_user(
            organization_id=current_user.organization.id,
            user_id=current_user.user.id,
        )
        return [prompt_template_to_view(record) for record in records]

    def create(
        self,
        current_user: CurrentUserData,
        payload: PromptTemplateCreateRequest,
    ) -> PromptTemplateView:
        organization_id = current_user.organization.id
        user_id = current_user.user.id
        if self.templates.count_for_user(
            organization_id=organization_id,
            user_id=user_id,
        ) >= MAX_PROMPT_TEMPLATES_PER_USER:
            raise AppError(
                409,
                f"每位用户最多保存 {MAX_PROMPT_TEMPLATES_PER_USER} 条提示词模板。",
                error_code="prompt_template_limit_reached",
            )

        title_normalized = payload.title.casefold()
        self._assert_unique_title(
            organization_id=organization_id,
            user_id=user_id,
            title_normalized=title_normalized,
        )
        now = utcnow()
        template_id = generate_uuid()
        record = UserPromptTemplate(
            id=template_id,
            created_at=now,
            updated_at=now,
            organization_id=organization_id,
            user_id=user_id,
            title=payload.title,
            title_normalized=title_normalized,
            description=payload.description,
            content=payload.content,
            storage_key=self._storage_key(organization_id, user_id, template_id),
            content_sha256=self._content_sha256(payload.content),
        )
        self.storage.put_json(record.storage_key, self._storage_payload(record))
        self.templates.add(record)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            self._best_effort_delete(record.storage_key)
            raise AppError(
                409,
                "已经存在同名提示词模板。",
                error_code="prompt_template_title_conflict",
            ) from exc
        except Exception:
            self.session.rollback()
            self._best_effort_delete(record.storage_key)
            raise
        self.session.refresh(record)
        return prompt_template_to_view(record)

    def update(
        self,
        current_user: CurrentUserData,
        template_id: str,
        payload: PromptTemplateUpdateRequest,
    ) -> PromptTemplateView:
        record = self._get_owned(current_user, template_id)
        title_normalized = payload.title.casefold()
        self._assert_unique_title(
            organization_id=current_user.organization.id,
            user_id=current_user.user.id,
            title_normalized=title_normalized,
            exclude_id=record.id,
        )
        previous_payload = self._storage_payload(record)
        record.title = payload.title
        record.title_normalized = title_normalized
        record.description = payload.description
        record.content = payload.content
        record.content_sha256 = self._content_sha256(payload.content)
        record.updated_at = utcnow()
        try:
            self.storage.put_json(record.storage_key, self._storage_payload(record))
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            self._best_effort_put(record.storage_key, previous_payload)
            raise AppError(
                409,
                "已经存在同名提示词模板。",
                error_code="prompt_template_title_conflict",
            ) from exc
        except Exception:
            self.session.rollback()
            self._best_effort_put(record.storage_key, previous_payload)
            raise
        self.session.refresh(record)
        return prompt_template_to_view(record)

    def delete(
        self,
        current_user: CurrentUserData,
        template_id: str,
    ) -> OperationStatus:
        record = self._get_owned(current_user, template_id)
        previous_payload = self._storage_payload(record)
        self.storage.delete(record.storage_key)
        self.templates.delete(record)
        try:
            self.session.commit()
        except Exception:
            self.session.rollback()
            self._best_effort_put(record.storage_key, previous_payload)
            raise
        return OperationStatus(ok=True)

    def _get_owned(
        self,
        current_user: CurrentUserData,
        template_id: str,
    ) -> UserPromptTemplate:
        record = self.templates.get_owned(
            template_id.strip(),
            organization_id=current_user.organization.id,
            user_id=current_user.user.id,
        )
        if record is None:
            raise AppError(
                404,
                "未找到提示词模板。",
                error_code="prompt_template_not_found",
            )
        return record

    def _assert_unique_title(
        self,
        *,
        organization_id: str,
        user_id: str,
        title_normalized: str,
        exclude_id: str | None = None,
    ) -> None:
        if self.templates.find_by_normalized_title(
            organization_id=organization_id,
            user_id=user_id,
            title_normalized=title_normalized,
            exclude_id=exclude_id,
        ) is not None:
            raise AppError(
                409,
                "已经存在同名提示词模板。",
                error_code="prompt_template_title_conflict",
            )

    @staticmethod
    def _storage_key(organization_id: str, user_id: str, template_id: str) -> str:
        return (
            f"user-prompt-templates/{organization_id}/{user_id}/"
            f"{template_id}.json"
        )

    @staticmethod
    def _content_sha256(content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    @staticmethod
    def _storage_payload(template: UserPromptTemplate) -> dict[str, object]:
        return {
            "schema_version": 1,
            "id": template.id,
            "organization_id": template.organization_id,
            "user_id": template.user_id,
            "title": template.title,
            "description": template.description,
            "content": template.content,
            "content_sha256": template.content_sha256,
            "created_at": template.created_at.isoformat(),
            "updated_at": template.updated_at.isoformat(),
        }

    def _best_effort_put(self, key: str, payload: dict[str, object]) -> None:
        try:
            self.storage.put_json(key, payload)
        except Exception:  # noqa: BLE001
            pass

    def _best_effort_delete(self, key: str) -> None:
        try:
            self.storage.delete(key)
        except Exception:  # noqa: BLE001
            pass
