from __future__ import annotations

import unittest
from datetime import timedelta

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

import app.schemas  # noqa: F401
from app.core.database import Base
from app.core.errors import AppError
from app.core.security import utcnow
from app.domain.billing.errors import BillingErrorCode
from app.domain.billing.pricing import CREDIT_UNIT_PRICE_RMB, DEFAULT_MARKUP
from app.domain.billing.products import (
    PROFESSIONAL_PRODUCT_ID,
    STANDARD_PRODUCT_ID,
    STARTER_PRODUCT_ID,
    list_products,
    product_by_id,
)
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.schemas.billing_order import BillingOrder
from app.schemas.organization import Organization
from app.schemas.usage_charge import UsageCharge, UsageChargeAllocation
from app.schemas.usage_credit_grant import (
    GRANT_TYPE_MANUAL,
    GRANT_TYPE_SIGNUP,
    UsageCreditGrant,
)
from app.schemas.user import User
from app.services.billing.billing_service import BillingService
from app.services.billing.credit_ledger_service import CreditLedgerService


class CreditLedgerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        self.SessionLocal = sessionmaker(
            bind=self.engine, autoflush=False, autocommit=False, future=True
        )
        Base.metadata.create_all(self.engine)
        self.session = self.SessionLocal()

        self.organization = Organization(name="Test Org", slug="test-org", plan_tier="free")
        self.user = User(email="billing@example.com", password_hash="hashed", display_name="Biller")
        self.session.add_all([self.organization, self.user])
        self.session.commit()

        self.current_user = CurrentUserData(
            user=UserView.model_validate(self.user),
            organization=OrganizationView.model_validate(self.organization),
            role="owner",
        )
        self.ledger = CreditLedgerService(self.session)
        self.billing = BillingService(self.session)
        # Local .env may be in shadow mode; these tests exercise enforcement.
        self.ledger.settings.billing_credits_enforce = True

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def grant(
        self,
        credits: int,
        *,
        plan_tier: str = "starter",
        grant_type: str = GRANT_TYPE_MANUAL,
        days: int = 365,
    ) -> UsageCreditGrant:
        now = utcnow()
        grant = UsageCreditGrant(
            organization_id=self.organization.id,
            source_order_id=None,
            grant_type=grant_type,
            plan_tier=plan_tier,
            total_credits=credits,
            used_credits=0,
            period_started_at=now,
            period_ends_at=now + timedelta(days=days),
        )
        self.session.add(grant)
        self.session.commit()
        return grant

    def spend(self, key: str, *, input_tokens: int = 500, output_tokens: int = 300):
        charge = self.ledger.spend_usage(
            organization_id=self.organization.id,
            actor_user_id=self.user.id,
            entrypoint="gateway.main",
            idempotency_key=key,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            provider_model="qwen3.8-max",
        )
        self.session.commit()
        return charge


class ProductCatalogTests(CreditLedgerTestCase):
    def test_three_credit_packs_are_offered(self) -> None:
        products = {item.id: item for item in self.billing.products()}
        self.assertEqual(len(products), 3)
        self.assertEqual(products[STARTER_PRODUCT_ID].amount_fen, 9900)
        self.assertEqual(products[STARTER_PRODUCT_ID].credits, 12_375)
        self.assertEqual(products[STANDARD_PRODUCT_ID].amount_fen, 49900)
        self.assertEqual(products[STANDARD_PRODUCT_ID].credits, 63_750)
        self.assertEqual(products[PROFESSIONAL_PRODUCT_ID].amount_fen, 99900)
        self.assertEqual(products[PROFESSIONAL_PRODUCT_ID].credits, 132_000)

    def test_bigger_packs_are_strictly_cheaper_per_credit(self) -> None:
        unit_prices = [item.unit_price_rmb for item in list_products()]
        self.assertEqual(unit_prices, sorted(unit_prices, reverse=True))

    def test_discount_badge_is_relative_to_cheapest_pack(self) -> None:
        products = {item.id: item for item in self.billing.products()}
        self.assertEqual(products[STARTER_PRODUCT_ID].discount_percent, 0)
        self.assertGreater(products[STANDARD_PRODUCT_ID].discount_percent, 0)
        self.assertGreater(
            products[PROFESSIONAL_PRODUCT_ID].discount_percent,
            products[STANDARD_PRODUCT_ID].discount_percent,
        )

    def test_pack_margins_follow_the_let_users_win_ladder(self) -> None:
        cost_per_credit = CREDIT_UNIT_PRICE_RMB / DEFAULT_MARKUP
        targets = {
            STARTER_PRODUCT_ID: 0.10,
            STANDARD_PRODUCT_ID: 0.08,
            PROFESSIONAL_PRODUCT_ID: 0.05,
        }
        for product in list_products():
            revenue = product.amount_fen / 100
            margin = (revenue - product.credits * cost_per_credit) / revenue
            self.assertAlmostEqual(margin, targets[product.id], delta=0.005)

    def test_packs_are_valid_for_twelve_months(self) -> None:
        for product in list_products():
            self.assertEqual(product.duration_days, 365)


class AuthorizationTests(CreditLedgerTestCase):
    def test_account_without_credits_is_blocked(self) -> None:
        with self.assertRaises(AppError) as raised:
            self.ledger.assert_can_spend(self.organization.id)
        self.assertEqual(raised.exception.status_code, 402)
        self.assertEqual(raised.exception.error_code, BillingErrorCode.QUOTA_EXCEEDED)
        self.assertEqual(len(raised.exception.details["products"]), 3)

    def test_any_positive_balance_authorizes(self) -> None:
        self.grant(1)
        self.assertEqual(self.ledger.assert_can_spend(self.organization.id), 1)

    def test_expired_grant_does_not_authorize(self) -> None:
        now = utcnow()
        expired = UsageCreditGrant(
            organization_id=self.organization.id,
            grant_type=GRANT_TYPE_MANUAL,
            plan_tier="starter",
            total_credits=5_000,
            used_credits=0,
            period_started_at=now - timedelta(days=400),
            period_ends_at=now - timedelta(days=1),
        )
        self.session.add(expired)
        self.session.commit()
        with self.assertRaises(AppError):
            self.ledger.assert_can_spend(self.organization.id)

    def test_voided_grant_does_not_authorize(self) -> None:
        grant = self.grant(5_000)
        grant.status = "void"
        self.session.commit()
        with self.assertRaises(AppError):
            self.ledger.assert_can_spend(self.organization.id)

    def test_shadow_mode_never_blocks(self) -> None:
        self.ledger.settings.billing_credits_enforce = False
        try:
            self.assertEqual(self.ledger.assert_can_spend(self.organization.id), 0)
        finally:
            self.ledger.settings.billing_credits_enforce = True


class ShadowModeTests(CreditLedgerTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.ledger.settings.billing_credits_enforce = False

    def tearDown(self) -> None:
        self.ledger.settings.billing_credits_enforce = True
        super().tearDown()

    def test_shadow_charge_prices_the_call_but_spends_nothing(self) -> None:
        grant = self.grant(10_000)
        charge = self.spend("shadow-call")
        assert charge is not None
        self.assertEqual(charge.status, "shadow")
        self.assertEqual(charge.credits, 3)
        self.assertEqual(charge.unbacked_credits, 0)

        self.session.refresh(grant)
        self.assertEqual(grant.used_credits, 0)
        self.assertEqual(self.ledger.remaining_credits(self.organization.id), 10_000)

    def test_shadow_charge_records_no_allocations(self) -> None:
        self.grant(10_000)
        self.spend("shadow-call")
        self.assertEqual(
            self.session.scalar(select(func.count()).select_from(UsageChargeAllocation)), 0
        )

    def test_enforced_charges_are_marked_differently(self) -> None:
        self.grant(10_000)
        self.ledger.settings.billing_credits_enforce = True
        charge = self.spend("live-call")
        assert charge is not None
        self.assertEqual(charge.status, "charged")


class SpendingTests(CreditLedgerTestCase):
    def test_charge_reflects_real_token_cost(self) -> None:
        grant = self.grant(10_000)
        charge = self.spend("call-1")
        assert charge is not None
        self.assertEqual(charge.credits, 3)
        self.assertEqual(charge.micro_credits, 2_333_500)
        self.assertEqual(charge.input_tokens, 500)
        self.assertEqual(charge.output_tokens, 300)
        self.assertEqual(charge.provider_model, "qwen3.8-max")
        self.session.refresh(grant)
        self.assertEqual(grant.used_credits, 3)

    def test_zero_usage_writes_no_ledger_entry(self) -> None:
        self.grant(10_000)
        charge = self.spend("failed-call", input_tokens=0, output_tokens=0)
        self.assertIsNone(charge)
        self.assertEqual(self.session.scalar(select(func.count()).select_from(UsageCharge)), 0)

    def test_spend_is_idempotent(self) -> None:
        grant = self.grant(10_000)
        first = self.spend("same-call")
        second = self.spend("same-call")
        assert first is not None and second is not None
        self.assertEqual(first.id, second.id)
        self.assertEqual(self.session.scalar(select(func.count()).select_from(UsageCharge)), 1)
        self.session.refresh(grant)
        self.assertEqual(grant.used_credits, 3)

    def test_credits_are_spent_from_the_grant_expiring_soonest(self) -> None:
        now = utcnow()
        later = UsageCreditGrant(
            organization_id=self.organization.id,
            grant_type=GRANT_TYPE_MANUAL,
            plan_tier="standard",
            total_credits=1_000,
            used_credits=0,
            period_started_at=now,
            period_ends_at=now + timedelta(days=300),
        )
        sooner = UsageCreditGrant(
            organization_id=self.organization.id,
            grant_type=GRANT_TYPE_SIGNUP,
            plan_tier="free",
            total_credits=1_000,
            used_credits=0,
            period_started_at=now,
            period_ends_at=now + timedelta(days=10),
        )
        self.session.add_all([later, sooner])
        self.session.commit()

        self.spend("call-1")
        self.session.refresh(sooner)
        self.session.refresh(later)
        self.assertEqual(sooner.used_credits, 3)
        self.assertEqual(later.used_credits, 0)

    def test_charge_splits_across_grants_and_records_allocations(self) -> None:
        now = utcnow()
        small = UsageCreditGrant(
            organization_id=self.organization.id,
            grant_type=GRANT_TYPE_SIGNUP,
            plan_tier="free",
            total_credits=1,
            used_credits=0,
            period_started_at=now,
            period_ends_at=now + timedelta(days=10),
        )
        big = UsageCreditGrant(
            organization_id=self.organization.id,
            grant_type=GRANT_TYPE_MANUAL,
            plan_tier="starter",
            total_credits=1_000,
            used_credits=0,
            period_started_at=now,
            period_ends_at=now + timedelta(days=300),
        )
        self.session.add_all([small, big])
        self.session.commit()

        charge = self.spend("split-call")
        assert charge is not None
        self.assertEqual(charge.credits, 3)
        self.assertEqual(charge.unbacked_credits, 0)

        self.session.refresh(small)
        self.session.refresh(big)
        self.assertEqual(small.used_credits, 1)
        self.assertEqual(big.used_credits, 2)

        allocations = self.session.scalars(
            select(UsageChargeAllocation).where(
                UsageChargeAllocation.usage_charge_id == charge.id
            )
        ).all()
        self.assertEqual(sorted(item.credits for item in allocations), [1, 2])

    def test_overdraft_is_recorded_rather_than_pushing_a_grant_negative(self) -> None:
        grant = self.grant(1)
        charge = self.spend("overdraw")
        assert charge is not None
        self.assertEqual(charge.credits, 3)
        self.assertEqual(charge.unbacked_credits, 2)
        self.session.refresh(grant)
        self.assertEqual(grant.used_credits, 1)
        self.assertEqual(self.ledger.remaining_credits(self.organization.id), 0)

        # The overdrawn call was the last one allowed.
        with self.assertRaises(AppError):
            self.ledger.assert_can_spend(self.organization.id)

    def test_balance_is_shared_across_organization_members(self) -> None:
        grant = self.grant(10_000)
        other_user = User(email="member@example.com", password_hash="hashed")
        self.session.add(other_user)
        self.session.commit()

        self.ledger.spend_usage(
            organization_id=self.organization.id,
            actor_user_id=other_user.id,
            entrypoint="gateway.main",
            idempotency_key="member-call",
            input_tokens=500,
            output_tokens=300,
            provider_model="qwen3.8-max",
        )
        self.session.commit()
        self.session.refresh(grant)
        self.assertEqual(grant.used_credits, 3)

    def test_empty_idempotency_key_is_rejected(self) -> None:
        self.grant(1_000)
        with self.assertRaises(AppError) as raised:
            self.spend("   ")
        self.assertEqual(raised.exception.status_code, 422)


class QuotaSummaryTests(CreditLedgerTestCase):
    def test_summary_reports_credit_balance(self) -> None:
        self.grant(10_000)
        self.spend("call-1")
        summary = self.ledger.quota_summary(self.organization.id)
        self.assertEqual(summary.credits_remaining, 9_997)
        self.assertEqual(summary.credits_total, 10_000)
        self.assertEqual(summary.plan_tier, "starter")
        self.assertIsNotNone(summary.credits_expiring_at)

    def test_summary_keeps_legacy_aliases_for_old_clients(self) -> None:
        self.grant(10_000)
        summary = self.ledger.quota_summary(self.organization.id)
        self.assertEqual(summary.quota_remaining, summary.credits_remaining)
        self.assertEqual(summary.quota_limit, summary.credits_total)
        self.assertEqual(summary.free_daily_limit, 0)

    def test_free_account_reports_zero(self) -> None:
        summary = self.ledger.quota_summary(self.organization.id)
        self.assertEqual(summary.plan_tier, "free")
        self.assertEqual(summary.credits_remaining, 0)
        self.assertIsNone(summary.credits_expiring_at)

    def test_signup_grant_alone_stays_on_the_free_tier(self) -> None:
        self.grant(2_000, plan_tier="free", grant_type=GRANT_TYPE_SIGNUP)
        summary = self.ledger.quota_summary(self.organization.id)
        self.assertEqual(summary.plan_tier, "free")
        self.assertEqual(summary.credits_remaining, 2_000)

    def test_highest_purchased_tier_wins(self) -> None:
        self.grant(10_000, plan_tier="starter")
        self.grant(135_000, plan_tier="professional")
        summary = self.ledger.quota_summary(self.organization.id)
        self.assertEqual(summary.plan_tier, "professional")
        self.assertEqual(summary.credits_remaining, 145_000)

    def test_expiry_reflects_the_soonest_pool_with_credits_left(self) -> None:
        now = utcnow()
        drained = UsageCreditGrant(
            organization_id=self.organization.id,
            grant_type=GRANT_TYPE_SIGNUP,
            plan_tier="free",
            total_credits=100,
            used_credits=100,
            period_started_at=now,
            period_ends_at=now + timedelta(days=5),
        )
        usable = UsageCreditGrant(
            organization_id=self.organization.id,
            grant_type=GRANT_TYPE_MANUAL,
            plan_tier="starter",
            total_credits=100,
            used_credits=0,
            period_started_at=now,
            period_ends_at=now + timedelta(days=50),
        )
        self.session.add_all([drained, usable])
        self.session.commit()

        summary = self.ledger.quota_summary(self.organization.id)
        self.assertEqual(summary.credits_remaining, 100)
        assert summary.credits_expiring_at is not None
        self.assertGreater(summary.credits_expiring_at, now + timedelta(days=40))


class PaidOrderGrantTests(CreditLedgerTestCase):
    def make_order(self, product_id: str, out_trade_no: str) -> BillingOrder:
        now = utcnow()
        product = product_by_id(product_id)
        assert product is not None
        order = BillingOrder(
            organization_id=self.organization.id,
            created_by_user_id=self.user.id,
            product_id=product.id,
            plan_tier=product.plan_tier,
            amount_fen=product.amount_fen,
            credits=product.credits,
            duration_days=product.duration_days,
            currency="CNY",
            status="paid",
            out_trade_no=out_trade_no,
            expires_at=now + timedelta(minutes=15),
            paid_at=now,
        )
        self.session.add(order)
        self.session.flush()
        return order

    def test_paid_order_grants_the_pack_credits(self) -> None:
        order = self.make_order(STANDARD_PRODUCT_ID, "XLTESTORDER001")
        grant = self.billing.grant_paid_order_credits(order, utcnow())
        self.session.commit()
        self.assertEqual(grant.total_credits, 63_750)
        self.assertEqual(grant.plan_tier, "standard")
        self.assertEqual(grant.grant_type, "purchase")
        self.assertEqual((grant.period_ends_at - grant.period_started_at).days, 365)

    def test_grant_paid_order_is_idempotent(self) -> None:
        order = self.make_order(STARTER_PRODUCT_ID, "XLTESTORDER002")
        now = utcnow()
        first = self.billing.grant_paid_order_credits(order, now)
        second = self.billing.grant_paid_order_credits(order, now)
        self.session.commit()
        self.assertEqual(first.id, second.id)
        self.assertEqual(
            self.session.scalar(select(func.count()).select_from(UsageCreditGrant)), 1
        )

    def test_pending_order_keeps_the_credit_entitlement_it_was_created_with(self) -> None:
        order = self.make_order(PROFESSIONAL_PRODUCT_ID, "XLTESTORDEROLD")
        # This was the professional entitlement before the catalog changed.
        order.credits = 135_000
        grant = self.billing.grant_paid_order_credits(order, utcnow())
        self.session.commit()
        self.assertEqual(grant.total_credits, 135_000)
        self.assertNotEqual(grant.total_credits, product_by_id(PROFESSIONAL_PRODUCT_ID).credits)

    def test_second_purchase_adds_an_independent_pool(self) -> None:
        now = utcnow()
        self.billing.grant_paid_order_credits(self.make_order(STARTER_PRODUCT_ID, "XL1"), now)
        self.billing.grant_paid_order_credits(self.make_order(STARTER_PRODUCT_ID, "XL2"), now)
        self.session.commit()
        summary = self.ledger.quota_summary(self.organization.id)
        self.assertEqual(summary.credits_remaining, 24_750)
        self.assertEqual(
            self.session.scalar(select(func.count()).select_from(UsageCreditGrant)), 2
        )


if __name__ == "__main__":
    unittest.main()
