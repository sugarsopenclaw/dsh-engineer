from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.usage_credit_grant import (
    GRANT_STATUS_ACTIVE,
    GRANT_TYPE_MIGRATION,
    GRANT_TYPE_SIGNUP,
    UsageCreditGrant,
)


class UsageCreditGrantRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_source_order_id(self, source_order_id: str) -> UsageCreditGrant | None:
        statement = select(UsageCreditGrant).where(
            UsageCreditGrant.source_order_id == source_order_id
        )
        return self.session.scalar(statement)

    def get_by_grant_type(self, organization_id: str, grant_type: str) -> UsageCreditGrant | None:
        statement = select(UsageCreditGrant).where(
            UsageCreditGrant.organization_id == organization_id,
            UsageCreditGrant.grant_type == grant_type,
        )
        return self.session.scalars(statement).first()

    def get_signup_grant(self, organization_id: str) -> UsageCreditGrant | None:
        return self.get_by_grant_type(organization_id, GRANT_TYPE_SIGNUP)

    def get_migration_grant(self, organization_id: str) -> UsageCreditGrant | None:
        return self.get_by_grant_type(organization_id, GRANT_TYPE_MIGRATION)

    def list_active(self, organization_id: str, now: datetime) -> list[UsageCreditGrant]:
        statement = select(UsageCreditGrant).where(
            UsageCreditGrant.organization_id == organization_id,
            UsageCreditGrant.status == GRANT_STATUS_ACTIVE,
            UsageCreditGrant.period_started_at <= now,
            UsageCreditGrant.period_ends_at > now,
        )
        return list(self.session.scalars(statement).all())

    def add(self, grant: UsageCreditGrant) -> UsageCreditGrant:
        self.session.add(grant)
        self.session.flush()
        return grant
