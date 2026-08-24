from __future__ import annotations

import json
import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import utcnow
from app.domain.billing.errors import BillingErrorCode
from app.domain.billing.policies import (
    DEFAULT_POLL_AFTER_SECONDS,
    ORDER_EXPIRES_MINUTES,
    SHANGHAI_TZ,
    ensure_utc,
)
from app.domain.billing.products import BillingProduct, list_products, product_by_id
from app.models.billing import (
    BillingOrderStatusView,
    BillingProductView,
    QuotaSummaryView,
    WeChatNativeOrderView,
)
from app.models.user import CurrentUserData
from app.repositories.billing_order_repository import BillingOrderRepository
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.usage_credit_grant_repository import UsageCreditGrantRepository
from app.schemas.billing_order import BillingOrder
from app.schemas.usage_credit_grant import GRANT_TYPE_PURCHASE, UsageCreditGrant
from app.services.billing.credit_ledger_service import CreditLedgerService
from app.services.billing.wechat_native_pay import WeChatNativePayClient

PENDING_ORDER_STATUS = "pending"
PAID_ORDER_STATUS = "paid"


def product_to_view(product: BillingProduct) -> BillingProductView:
    products = list_products()
    baseline = max(item.unit_price_rmb for item in products) if products else product.unit_price_rmb
    discount = 0
    if baseline > 0:
        discount = max(0, round((1 - product.unit_price_rmb / baseline) * 100))
    return BillingProductView(
        id=product.id,
        plan_tier=product.plan_tier,
        name=product.name,
        description=product.description,
        amount_fen=product.amount_fen,
        credits=product.credits,
        duration_days=product.duration_days,
        unit_price_rmb=product.unit_price_rmb,
        discount_percent=discount,
    )


def parse_wechat_time(value: Any):
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        from datetime import datetime

        return ensure_utc(datetime.fromisoformat(text))
    except ValueError:
        return None


class BillingService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.orders = BillingOrderRepository(session)
        self.grants = UsageCreditGrantRepository(session)
        self.organizations = OrganizationRepository(session)
        self.ledger = CreditLedgerService(session)

    def products(self) -> list[BillingProductView]:
        return [product_to_view(product) for product in list_products()]

    def create_wechat_native_order(
        self,
        current_user: CurrentUserData,
        product_id: str,
        client: WeChatNativePayClient | None = None,
    ) -> WeChatNativeOrderView:
        product = product_by_id(product_id)
        if product is None:
            raise AppError(
                404,
                "商品不存在。",
                error_code=BillingErrorCode.BILLING_PRODUCT_NOT_FOUND,
                details={"product_id": product_id},
            )

        now = ensure_utc(utcnow())
        expires_at = now + timedelta(minutes=ORDER_EXPIRES_MINUTES)
        out_trade_no = self.generate_out_trade_no()
        pay_client = client or WeChatNativePayClient()
        native = pay_client.create_native_order(
            description=product.description,
            out_trade_no=out_trade_no,
            amount_fen=product.amount_fen,
            expires_at=expires_at.astimezone(SHANGHAI_TZ),
        )
        order = BillingOrder(
            organization_id=current_user.organization.id,
            created_by_user_id=current_user.user.id,
            product_id=product.id,
            plan_tier=product.plan_tier,
            amount_fen=product.amount_fen,
            credits=product.credits,
            duration_days=product.duration_days,
            currency="CNY",
            status=PENDING_ORDER_STATUS,
            out_trade_no=out_trade_no,
            code_url=native.code_url,
            expires_at=expires_at,
        )
        try:
            self.orders.add(order)
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise AppError(
                409,
                "创建订单失败，请重试。",
                error_code=BillingErrorCode.BILLING_ORDER_CONFLICT,
            ) from exc

        self.session.refresh(order)
        return WeChatNativeOrderView(
            order_id=order.id,
            product_id=order.product_id,
            plan_tier=order.plan_tier,
            status=order.status,
            out_trade_no=order.out_trade_no,
            amount_fen=order.amount_fen,
            code_url=order.code_url,
            expires_at=order.expires_at,
            paid_at=order.paid_at,
            poll_after_seconds=DEFAULT_POLL_AFTER_SECONDS,
            quota=None,
        )

    def get_order_status(self, current_user: CurrentUserData, order_id: str) -> BillingOrderStatusView:
        order = self.get_org_order(current_user.organization.id, order_id)
        quota = self.ledger.quota_summary(current_user.organization.id)
        return self.order_status_view(order, quota)

    def sync_order(
        self,
        current_user: CurrentUserData,
        order_id: str,
        client: WeChatNativePayClient | None = None,
    ) -> BillingOrderStatusView:
        order = self.get_org_order(current_user.organization.id, order_id)
        if order.status != PENDING_ORDER_STATUS:
            quota = self.ledger.quota_summary(current_user.organization.id)
            return self.order_status_view(order, quota)

        pay_client = client or WeChatNativePayClient()
        transaction = pay_client.query_order(out_trade_no=order.out_trade_no)
        self.apply_wechat_transaction(order, transaction)
        self.session.commit()
        self.session.refresh(order)
        quota = self.ledger.quota_summary(current_user.organization.id)
        return self.order_status_view(order, quota)

    def handle_wechat_notify(
        self,
        headers: dict[str, str | None],
        body: bytes,
        client: WeChatNativePayClient | None = None,
    ) -> dict[str, str]:
        pay_client = client or WeChatNativePayClient()
        payload = pay_client.parse_notify(headers, body)
        resource = payload.get("resource")
        if not isinstance(resource, dict):
            raise AppError(
                400,
                "微信支付回调资源无效。",
                error_code=BillingErrorCode.WECHATPAY_NOTIFY_INVALID,
            )
        out_trade_no = str(resource.get("out_trade_no") or "").strip()
        if not out_trade_no:
            raise AppError(
                400,
                "微信支付回调缺少 out_trade_no。",
                error_code=BillingErrorCode.WECHATPAY_NOTIFY_INVALID,
            )

        order = self.orders.get_by_out_trade_no(out_trade_no)
        if order is None:
            raise AppError(
                404,
                "订单不存在。",
                error_code=BillingErrorCode.BILLING_ORDER_NOT_FOUND,
            )

        self.apply_wechat_transaction(order, resource, raw_notify=payload)
        self.session.commit()
        return {"code": "SUCCESS", "message": "成功"}

    def apply_wechat_transaction(
        self,
        order: BillingOrder,
        transaction: dict[str, Any],
        raw_notify: dict[str, Any] | None = None,
    ) -> None:
        now = ensure_utc(utcnow())
        trade_state = str(transaction.get("trade_state") or "").strip().upper()
        if trade_state != "SUCCESS":
            order.synced_at = now
            if trade_state in {"CLOSED", "REVOKED"}:
                order.status = "closed"
            elif trade_state in {"PAYERROR"}:
                order.status = "failed"
            return

        self.validate_success_transaction(order, transaction)
        if order.status == PAID_ORDER_STATUS:
            order.synced_at = now
            return

        order.status = PAID_ORDER_STATUS
        order.transaction_id = str(transaction.get("transaction_id") or "").strip() or None
        order.paid_at = parse_wechat_time(transaction.get("success_time")) or now
        order.synced_at = now
        if raw_notify is not None:
            order.raw_notify_json = json.dumps(raw_notify, ensure_ascii=False, default=str)
        self.grant_paid_order_credits(order, now)

    def grant_paid_order_credits(self, order: BillingOrder, now) -> UsageCreditGrant:
        existing = self.grants.get_by_source_order_id(order.id)
        if existing is not None:
            return existing

        credits = int(order.credits or 0)
        duration_days = int(order.duration_days or 0)
        if credits <= 0 or duration_days <= 0:
            # Compatibility fallback for legacy rows that predate the snapshot
            # migration. Known pending orders are backfilled by SQL before the
            # deploy, so this must not be the normal payment path.
            product = product_by_id(order.product_id)
            if product is None:
                raise AppError(
                    500,
                    "订单缺少额度快照，且商品已不存在。",
                    error_code=BillingErrorCode.BILLING_PRODUCT_NOT_FOUND,
                )
            if credits <= 0:
                credits = product.credits
            if duration_days <= 0:
                duration_days = product.duration_days

        # Every pack is an independent pool valid from purchase; the ledger
        # spends whichever pool expires soonest, so no stacking rules are needed.
        return self.ledger.grant_credits(
            organization_id=order.organization_id,
            plan_tier=order.plan_tier,
            credits=credits,
            grant_type=GRANT_TYPE_PURCHASE,
            duration_days=duration_days,
            source_order_id=order.id,
            now=now,
        )

    def get_org_order(self, organization_id: str, order_id: str) -> BillingOrder:
        order = self.orders.get_by_id(order_id)
        if order is None or order.organization_id != organization_id:
            raise AppError(
                404,
                "订单不存在。",
                error_code=BillingErrorCode.BILLING_ORDER_NOT_FOUND,
            )
        return order

    def validate_success_transaction(self, order: BillingOrder, transaction: dict[str, Any]) -> None:
        from app.core.config import get_settings

        settings = get_settings()
        if str(transaction.get("appid") or "") != str(settings.wechatpay_app_id or ""):
            raise AppError(400, "微信支付 appid 不匹配。", error_code=BillingErrorCode.WECHATPAY_NOTIFY_MISMATCH)
        if str(transaction.get("mchid") or "") != str(settings.wechatpay_mch_id or ""):
            raise AppError(400, "微信支付 mchid 不匹配。", error_code=BillingErrorCode.WECHATPAY_NOTIFY_MISMATCH)
        if str(transaction.get("out_trade_no") or "") != order.out_trade_no:
            raise AppError(400, "微信支付订单号不匹配。", error_code=BillingErrorCode.WECHATPAY_NOTIFY_MISMATCH)
        amount = transaction.get("amount")
        total = amount.get("total") if isinstance(amount, dict) else None
        if int(total or -1) != order.amount_fen:
            raise AppError(400, "微信支付金额不匹配。", error_code=BillingErrorCode.WECHATPAY_NOTIFY_MISMATCH)

    def order_status_view(self, order: BillingOrder, quota: QuotaSummaryView) -> BillingOrderStatusView:
        return BillingOrderStatusView(
            order_id=order.id,
            product_id=order.product_id,
            plan_tier=order.plan_tier,
            status=order.status,
            out_trade_no=order.out_trade_no,
            amount_fen=order.amount_fen,
            expires_at=order.expires_at,
            paid_at=order.paid_at,
            quota=quota,
        )

    def generate_out_trade_no(self) -> str:
        # Merchant out_trade_no max 32 chars.
        stamp = utcnow().strftime("%Y%m%d%H%M%S")
        return f"XL{stamp}{secrets.token_hex(6)}"[:32]
