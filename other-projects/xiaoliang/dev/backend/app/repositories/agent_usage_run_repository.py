from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.agent_usage_run import AgentUsageRun


class AgentUsageRunRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_client_run_id(self, organization_id: str, client_run_id: str) -> AgentUsageRun | None:
        statement = select(AgentUsageRun).where(
            AgentUsageRun.organization_id == organization_id,
            AgentUsageRun.client_run_id == client_run_id,
        )
        return self.session.scalar(statement)

    def add(self, run: AgentUsageRun) -> AgentUsageRun:
        self.session.add(run)
        self.session.flush()
        return run
