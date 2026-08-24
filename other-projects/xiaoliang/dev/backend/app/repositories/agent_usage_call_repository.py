from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.agent_usage_call import AgentUsageCall


class AgentUsageCallRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, call: AgentUsageCall) -> AgentUsageCall:
        self.session.add(call)
        self.session.flush()
        return call

    def get_by_id(self, call_id: str) -> AgentUsageCall | None:
        return self.session.get(AgentUsageCall, call_id)

    def list_for_run(self, agent_run_id: str, limit: int) -> list[AgentUsageCall]:
        statement = (
            select(AgentUsageCall)
            .where(AgentUsageCall.agent_run_id == agent_run_id)
            .order_by(AgentUsageCall.started_at.asc(), AgentUsageCall.id.asc())
            .limit(limit)
        )
        return list(self.session.scalars(statement))

    def count_for_run(self, agent_run_id: str) -> int:
        statement = select(func.count()).select_from(AgentUsageCall).where(
            AgentUsageCall.agent_run_id == agent_run_id,
        )
        return int(self.session.scalar(statement) or 0)

    def totals_for_run(self, agent_run_id: str) -> tuple[int, int, int, int, int, int, int]:
        statement = select(
            func.coalesce(func.sum(AgentUsageCall.input_tokens), 0),
            func.coalesce(func.sum(AgentUsageCall.output_tokens), 0),
            func.coalesce(func.sum(AgentUsageCall.cache_read_tokens), 0),
            func.coalesce(func.sum(AgentUsageCall.cache_write_tokens), 0),
            func.coalesce(func.sum(AgentUsageCall.reasoning_tokens), 0),
            func.coalesce(func.sum(AgentUsageCall.total_tokens), 0),
            func.coalesce(func.sum(AgentUsageCall.image_count), 0),
        ).where(AgentUsageCall.agent_run_id == agent_run_id)
        row = self.session.execute(statement).one()
        return tuple(int(value or 0) for value in row)  # type: ignore[return-value]

    def breakdown_for_run(
        self,
        agent_run_id: str,
    ) -> list[tuple[str, str | None, int, int, int, int, int, int, int, int]]:
        statement = (
            select(
                AgentUsageCall.call_purpose,
                AgentUsageCall.child_run_id,
                func.count(AgentUsageCall.id),
                func.coalesce(func.sum(AgentUsageCall.input_tokens), 0),
                func.coalesce(func.sum(AgentUsageCall.output_tokens), 0),
                func.coalesce(func.sum(AgentUsageCall.cache_read_tokens), 0),
                func.coalesce(func.sum(AgentUsageCall.cache_write_tokens), 0),
                func.coalesce(func.sum(AgentUsageCall.reasoning_tokens), 0),
                func.coalesce(func.sum(AgentUsageCall.total_tokens), 0),
                func.coalesce(func.sum(AgentUsageCall.image_count), 0),
            )
            .where(AgentUsageCall.agent_run_id == agent_run_id)
            .group_by(AgentUsageCall.call_purpose, AgentUsageCall.child_run_id)
            .order_by(AgentUsageCall.call_purpose.asc(), AgentUsageCall.child_run_id.asc())
        )
        return [
            (
                str(row[0]),
                str(row[1]) if row[1] is not None else None,
                *(int(value or 0) for value in row[2:]),
            )
            for row in self.session.execute(statement)
        ]
