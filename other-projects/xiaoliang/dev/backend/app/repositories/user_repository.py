from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.user import User


class UserRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_id(self, user_id: str) -> User | None:
        return self.session.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(func.lower(User.email) == email.strip().lower())
        return self.session.scalar(statement)

    def create(self, *, email: str, password_hash: str, display_name: str | None) -> User:
        user = User(
            email=email.strip().lower(),
            password_hash=password_hash,
            display_name=display_name.strip() if display_name else None,
            is_active=True,
        )
        self.session.add(user)
        self.session.flush()
        return user