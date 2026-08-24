from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.core.config import Settings
from app.domain.billing.pricing import (
    CREDIT_UNIT_PRICE_RMB,
    DEFAULT_MARKUP,
    MICRO_PER_CREDIT,
    PRICING_VERSION,
    billable_tokens,
    credits_for_usage,
    pricing_table,
    rates_for_model,
)


class CreditRateTests(unittest.TestCase):
    def test_production_rejects_a_stale_markup_override(self) -> None:
        with self.assertRaisesRegex(ValidationError, "BILLING_CREDIT_MARKUP"):
            Settings(
                _env_file=None,
                APP_ENV="production",
                CORS_ORIGINS="https://xl.x3yun.com",
                BILLING_CREDIT_MARKUP=4,
            )

    def test_development_can_override_markup_for_local_pricing_tests(self) -> None:
        settings = Settings(
            _env_file=None,
            APP_ENV="development",
            BILLING_CREDIT_MARKUP=4,
        )
        self.assertEqual(settings.billing_credit_markup, 4)

    def test_rates_derive_from_provider_prices(self) -> None:
        rates = rates_for_model("qwen3.8-max")
        # price_per_1M * markup / credit_price, e.g. 12 * (10/9) / 0.008 ≈ 1667
        self.assertEqual(
            rates.uncached_input_micro,
            round(12.0 * DEFAULT_MARKUP / CREDIT_UNIT_PRICE_RMB),
        )
        self.assertEqual(
            rates.cached_input_micro,
            round(1.5 * DEFAULT_MARKUP / CREDIT_UNIT_PRICE_RMB),
        )
        self.assertEqual(
            rates.cache_write_micro,
            round(15.0 * DEFAULT_MARKUP / CREDIT_UNIT_PRICE_RMB),
        )
        self.assertEqual(
            rates.output_micro,
            round(36.0 * DEFAULT_MARKUP / CREDIT_UNIT_PRICE_RMB),
        )
        self.assertEqual(rates.uncached_input_micro, 1_667)
        self.assertEqual(rates.cached_input_micro, 208)
        self.assertEqual(rates.cache_write_micro, 2_083)
        self.assertEqual(rates.output_micro, 5_000)

    def test_unknown_model_falls_back_to_flagship_price(self) -> None:
        self.assertEqual(
            rates_for_model("some-future-model").as_dict(),
            rates_for_model("qwen3.8-max").as_dict(),
        )

    def test_markup_matches_target_margin(self) -> None:
        rates = rates_for_model()
        # Rounding micro-credits to integers adds a few parts per thousand.
        retail_per_token = rates.uncached_input_micro / MICRO_PER_CREDIT * CREDIT_UNIT_PRICE_RMB
        provider_per_token = 12.0 / 1_000_000
        self.assertAlmostEqual(retail_per_token / provider_per_token, DEFAULT_MARKUP, places=3)


class BillableTokenTests(unittest.TestCase):
    def test_cached_tokens_are_a_subset_of_prompt_tokens(self) -> None:
        tokens = billable_tokens(input_tokens=1_000, output_tokens=0, cache_read_tokens=400)
        self.assertEqual(tokens.uncached_input_tokens, 600)
        self.assertEqual(tokens.cached_input_tokens, 400)
        self.assertEqual(tokens.total_tokens, 1_000)

    def test_cache_write_is_carved_out_of_prompt_tokens(self) -> None:
        tokens = billable_tokens(
            input_tokens=1_000,
            output_tokens=0,
            cache_read_tokens=200,
            cache_write_tokens=300,
        )
        self.assertEqual(tokens.uncached_input_tokens, 500)
        self.assertEqual(tokens.cached_input_tokens, 200)
        self.assertEqual(tokens.cache_write_tokens, 300)

    def test_oversized_cached_count_cannot_produce_negative_input(self) -> None:
        tokens = billable_tokens(input_tokens=100, output_tokens=0, cache_read_tokens=999)
        self.assertEqual(tokens.uncached_input_tokens, 0)
        self.assertEqual(tokens.cached_input_tokens, 100)

    def test_garbage_counters_are_ignored(self) -> None:
        tokens = billable_tokens(input_tokens=None, output_tokens="x", cache_read_tokens=-5)
        self.assertEqual(tokens.total_tokens, 0)


class CreditCostTests(unittest.TestCase):
    def test_simple_turn(self) -> None:
        cost = credits_for_usage(input_tokens=500, output_tokens=300)
        # 500 * 1667 + 300 * 5000 = 2_333_500 micro -> 2.3335 credits
        self.assertEqual(cost.micro_credits, 2_333_500)
        self.assertEqual(cost.credits, 3)
        self.assertEqual(cost.pricing_version, PRICING_VERSION)

    def test_cad_sized_turn(self) -> None:
        cost = credits_for_usage(input_tokens=20_000, output_tokens=5_000)
        # 20_000 * 1667 + 5_000 * 5000 = 58_340_000 micro -> 59 credits
        self.assertEqual(cost.credits, 59)

    def test_cache_hits_are_much_cheaper(self) -> None:
        cached = credits_for_usage(
            input_tokens=100_000,
            output_tokens=0,
            cache_read_tokens=100_000,
        )
        uncached = credits_for_usage(input_tokens=100_000, output_tokens=0)
        self.assertEqual(cached.credits, 21)
        self.assertEqual(uncached.credits, 167)

    def test_reasoning_tokens_are_not_billed_twice(self) -> None:
        # DashScope prices reasoning at the output rate and reports it inside
        # completion_tokens, so passing it separately must not change anything.
        with_reasoning = credits_for_usage(input_tokens=0, output_tokens=1_000)
        self.assertEqual(with_reasoning.credits, 5)

    def test_partial_credit_rounds_up(self) -> None:
        # 1 output token = 5_000 micro, far below one credit, but never free.
        self.assertEqual(credits_for_usage(input_tokens=0, output_tokens=1).credits, 1)

    def test_zero_usage_costs_nothing(self) -> None:
        self.assertEqual(credits_for_usage(input_tokens=0, output_tokens=0).credits, 0)

    def test_charges_are_additive_without_float_drift(self) -> None:
        total_micro = sum(
            credits_for_usage(input_tokens=333, output_tokens=77).micro_credits
            for _ in range(1_000)
        )
        self.assertEqual(total_micro, 1_000 * (333 * 1_667 + 77 * 5_000))


class PricingTableTests(unittest.TestCase):
    def test_table_is_serializable_for_clients(self) -> None:
        table = pricing_table()
        self.assertEqual(table["pricing_version"], PRICING_VERSION)
        self.assertEqual(table["micro_per_credit"], MICRO_PER_CREDIT)
        self.assertIn("qwen3.8-max", table["models"])
        self.assertEqual(table["models"]["qwen3.8-max"]["output_micro"], 5_000)


if __name__ == "__main__":
    unittest.main()
