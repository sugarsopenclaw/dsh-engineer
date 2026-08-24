from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.schemas.email_login_otp import EmailLoginOtp


class EmailOtpRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_email(self, email: str) -> EmailLoginOtp | None:
        return self.session.get(EmailLoginOtp, email)

    def upsert(self, *, email: str, code_hash: str, expires_at: datetime, sent_at: datetime) -> None:
        row = self.session.get(EmailLoginOtp, email)
        if row:
            row.code_hash = code_hash
            row.expires_at = expires_at
            row.sent_at = sent_at
        else:
            self.session.add(
                EmailLoginOtp(
                    email=email,
                    code_hash=code_hash,
                    expires_at=expires_at,
                    sent_at=sent_at,
                )
            )
        self.session.flush()

    def delete(self, email: str) -> None:
        self.session.execute(delete(EmailLoginOtp).where(EmailLoginOtp.email == email))
