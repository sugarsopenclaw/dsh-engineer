from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.organization import Organization


class OrganizationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_id(self, organization_id: str) -> Organization | None:
        return self.session.get(Organization, organization_id)

    def get_by_slug(self, slug: str) -> Organization | None:
        statement = select(Organization).where(Organization.slug == slug)
        return self.session.scalar(statement)

    def create(self, *, name: str, slug: str) -> Organization:
        organization = Organization(name=name, slug=slug)
        self.session.add(organization)
        self.session.flush()
        return organization