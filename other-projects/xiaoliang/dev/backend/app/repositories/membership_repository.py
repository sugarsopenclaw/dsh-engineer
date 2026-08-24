from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.membership import Membership


class MembershipRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(self, *, organization_id: str, user_id: str, role: str) -> Membership:
        membership = Membership(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            is_active=True,
        )
        self.session.add(membership)
        self.session.flush()
        return membership

    def get_primary_for_user(self, user_id: str) -> Membership | None:
        statement = (
            select(Membership)
            .where(Membership.user_id == user_id, Membership.is_active.is_(True))
            .order_by(Membership.created_at.asc())
        )
        return self.session.scalar(statement)

    def get_by_user_and_org(self, *, user_id: str, organization_id: str) -> Membership | None:
        statement = select(Membership).where(
            Membership.user_id == user_id,
            Membership.organization_id == organization_id,
            Membership.is_active.is_(True),
        )
        return self.session.scalar(statement)