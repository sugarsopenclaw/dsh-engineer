from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.schemas.refresh_token import RefreshToken


class RefreshTokenRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        *,
        user_id: str,
        organization_id: str,
        token_hash: str,
        expires_at: datetime,
    ) -> RefreshToken:
        record = RefreshToken(
            user_id=user_id,
            organization_id=organization_id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        self.session.add(record)
        self.session.flush()
        return record

    def get_active_by_hash(self, token_hash: str) -> RefreshToken | None:
        statement = select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > utcnow(),
        )
        return self.session.scalar(statement)

    def revoke(self, record: RefreshToken) -> None:
        record.revoked_at = utcnow()
        self.session.add(record)