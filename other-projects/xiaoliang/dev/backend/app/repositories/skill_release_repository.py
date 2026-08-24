from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.skill_release import SkillRelease


class SkillReleaseRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_latest_published(self, release_channel: str) -> SkillRelease | None:
        statement = (
            select(SkillRelease)
            .where(
                SkillRelease.release_channel == release_channel,
                SkillRelease.status == "published",
            )
            .order_by(SkillRelease.released_at.desc(), SkillRelease.created_at.desc())
        )
        return self.session.scalars(statement).first()

    def get_published_by_version(
        self,
        *,
        release_channel: str,
        skill_pack_version: str,
    ) -> SkillRelease | None:
        statement = (
            select(SkillRelease)
            .where(
                SkillRelease.release_channel == release_channel,
                SkillRelease.skill_pack_version == skill_pack_version,
                SkillRelease.status == "published",
            )
            .order_by(SkillRelease.released_at.desc(), SkillRelease.created_at.desc())
        )
        return self.session.scalars(statement).first()
