from __future__ import annotations

from dataclasses import dataclass

# Personal credit packs. Larger packs are cheaper per credit, so the unit price
# strictly decreases as the pack grows. Combined with markup 10/9 this yields
# about 10% / 8% / 5% model-cost margin on starter / standard / professional.
STARTER_PRODUCT_ID = "credits_starter"
STANDARD_PRODUCT_ID = "credits_standard"
PROFESSIONAL_PRODUCT_ID = "credits_professional"

GRANT_DURATION_DAYS = 365


@dataclass(frozen=True)
class BillingProduct:
    id: str
    plan_tier: str
    name: str
    description: str
    amount_fen: int
    credits: int
    duration_days: int

    @property
    def unit_price_rmb(self) -> float:
        return round(self.amount_fen / 100 / self.credits, 6)


PRODUCTS: dict[str, BillingProduct] = {
    STARTER_PRODUCT_ID: BillingProduct(
        id=STARTER_PRODUCT_ID,
        plan_tier="starter",
        name="入门版",
        description="晓量算力包 12,375 Credits（12 个月）",
        amount_fen=9900,
        credits=12_375,
        duration_days=GRANT_DURATION_DAYS,
    ),
    STANDARD_PRODUCT_ID: BillingProduct(
        id=STANDARD_PRODUCT_ID,
        plan_tier="standard",
        name="标准版",
        description="晓量算力包 63,750 Credits（12 个月）",
        amount_fen=49900,
        credits=63_750,
        duration_days=GRANT_DURATION_DAYS,
    ),
    PROFESSIONAL_PRODUCT_ID: BillingProduct(
        id=PROFESSIONAL_PRODUCT_ID,
        plan_tier="professional",
        name="专业版",
        description="晓量算力包 132,000 Credits（12 个月）",
        amount_fen=99900,
        credits=132_000,
        duration_days=GRANT_DURATION_DAYS,
    ),
}

# Tier shown on the account, highest active purchase wins.
PLAN_TIER_PRIORITY: dict[str, int] = {
    "professional": 0,
    "standard": 1,
    "starter": 2,
}

# Existing plus/pro members are converted to this pack by the data migration.
MIGRATION_PRODUCT_ID = STARTER_PRODUCT_ID


def product_by_id(product_id: str) -> BillingProduct | None:
    return PRODUCTS.get((product_id or "").strip())


def list_products() -> list[BillingProduct]:
    return sorted(PRODUCTS.values(), key=lambda product: product.amount_fen)
