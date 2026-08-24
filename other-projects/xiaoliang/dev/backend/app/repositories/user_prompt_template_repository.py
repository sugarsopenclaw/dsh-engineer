from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.user_prompt_template import UserPromptTemplate


class UserPromptTemplateRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_for_user(
        self,
        *,
        organization_id: str,
        user_id: str,
    ) -> list[UserPromptTemplate]:
        return list(
            self.session.scalars(
                select(UserPromptTemplate)
                .where(
                    UserPromptTemplate.organization_id == organization_id,
                    UserPromptTemplate.user_id == user_id,
                )
                .order_by(
                    UserPromptTemplate.updated_at.desc(),
                    UserPromptTemplate.title.asc(),
                )
            )
        )

    def count_for_user(self, *, organization_id: str, user_id: str) -> int:
        return int(
            self.session.scalar(
                select(func.count())
                .select_from(UserPromptTemplate)
                .where(
                    UserPromptTemplate.organization_id == organization_id,
                    UserPromptTemplate.user_id == user_id,
                )
            )
            or 0
        )

    def get_owned(
        self,
        template_id: str,
        *,
        organization_id: str,
        user_id: str,
    ) -> UserPromptTemplate | None:
        return self.session.scalar(
            select(UserPromptTemplate).where(
                UserPromptTemplate.id == template_id,
                UserPromptTemplate.organization_id == organization_id,
                UserPromptTemplate.user_id == user_id,
            )
        )

    def find_by_normalized_title(
        self,
        *,
        organization_id: str,
        user_id: str,
        title_normalized: str,
        exclude_id: str | None = None,
    ) -> UserPromptTemplate | None:
        statement = select(UserPromptTemplate).where(
            UserPromptTemplate.organization_id == organization_id,
            UserPromptTemplate.user_id == user_id,
            UserPromptTemplate.title_normalized == title_normalized,
        )
        if exclude_id:
            statement = statement.where(UserPromptTemplate.id != exclude_id)
        return self.session.scalar(statement)

    def add(self, template: UserPromptTemplate) -> None:
        self.session.add(template)

    def delete(self, template: UserPromptTemplate) -> None:
        self.session.delete(template)
