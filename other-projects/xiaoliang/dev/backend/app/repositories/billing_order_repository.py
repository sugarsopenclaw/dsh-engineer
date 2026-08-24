from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.billing_order import BillingOrder


class BillingOrderRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_id(self, order_id: str) -> BillingOrder | None:
        return self.session.get(BillingOrder, order_id)

    def get_by_out_trade_no(self, out_trade_no: str) -> BillingOrder | None:
        statement = select(BillingOrder).where(BillingOrder.out_trade_no == out_trade_no)
        return self.session.scalar(statement)

    def add(self, order: BillingOrder) -> BillingOrder:
        self.session.add(order)
        self.session.flush()
        return order
