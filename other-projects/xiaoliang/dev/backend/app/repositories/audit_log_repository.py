from __future__ import annotations

from sqlalchemy.orm import Session

from app.schemas.audit_log import AuditLog


class AuditLogRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        *,
        organization_id: str | None,
        actor_user_id: str | None,
        action: str,
        resource_type: str,
        resource_id: str | None = None,
        details: dict | None = None,
    ) -> AuditLog:
        record = AuditLog(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details,
        )
        self.session.add(record)
        self.session.flush()
        return record