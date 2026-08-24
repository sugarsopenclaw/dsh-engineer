from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.schemas.agent_usage_call import AgentUsageCall
from app.schemas.usage_charge import UsageCharge, UsageChargeAllocation


class UsageChargeRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_idempotency(self, organization_id: str, idempotency_key: str) -> UsageCharge | None:
        statement = select(UsageCharge).where(
            UsageCharge.organization_id == organization_id,
            UsageCharge.idempotency_key == idempotency_key,
        )
        return self.session.scalar(statement)

    def credits_for_agent_run(self, agent_run_id: str) -> int:
        statement = (
            select(func.coalesce(func.sum(UsageCharge.credits), 0))
            .join(AgentUsageCall, AgentUsageCall.id == UsageCharge.agent_usage_call_id)
            .where(AgentUsageCall.agent_run_id == agent_run_id)
        )
        return int(self.session.scalar(statement) or 0)

    def add(self, charge: UsageCharge) -> UsageCharge:
        self.session.add(charge)
        self.session.flush()
        return charge

    def add_allocation(self, allocation: UsageChargeAllocation) -> UsageChargeAllocation:
        self.session.add(allocation)
        self.session.flush()
        return allocation
