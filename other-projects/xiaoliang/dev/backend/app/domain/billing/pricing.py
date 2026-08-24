"""Credit pricing for managed model calls.

Credits are derived from the provider's real token cost, not estimated:

    credits = ceil(provider_cost_rmb * MARKUP / CREDIT_UNIT_PRICE_RMB)

All arithmetic runs on integer "micro credits" (1 credit = 1_000_000 micro)
so that repeated charges never accumulate float drift.

Provider prices below are qwen3.8-max on Alibaba Model Studio (cn-beijing):
input ¥12 / 1M, cached-hit input ¥1.5 / 1M, explicit cache write ¥15 / 1M,
output ¥36 / 1M (the output price already covers reasoning tokens).
"""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil
from typing import Any

from app.core.config import BILLING_DEFAULT_CREDIT_MARKUP

MICRO_PER_CREDIT = 1_000_000
TOKENS_PER_PRICE_UNIT = 1_000_000

PRICING_VERSION = "qwen3.8-max-cn-beijing-x1.11-v1"

# ¥ per credit as sold to the customer. Pack unit prices sit at or below this.
CREDIT_UNIT_PRICE_RMB = 0.008
# 10/9 ≈ 1.111x provider cost => ~10% gross margin at the ¥0.008 list price.
# Larger packs sell below list, so their margin is thinner (see products.py).
DEFAULT_MARKUP = BILLING_DEFAULT_CREDIT_MARKUP

DEFAULT_PROVIDER_MODEL = "qwen3.8-max"


@dataclass(frozen=True)
class ProviderTokenPrices:
    """Provider list price in RMB per 1M tokens."""

    uncached_input: float
    cached_input: float
    cache_write: float
    output: float


@dataclass(frozen=True)
class ModelCreditRates:
    """Micro credits charged per single token."""

    provider_model: str
    uncached_input_micro: int
    cached_input_micro: int
    cache_write_micro: int
    output_micro: int

    def as_dict(self) -> dict[str, int]:
        return {
            "uncached_input_micro": self.uncached_input_micro,
            "cached_input_micro": self.cached_input_micro,
            "cache_write_micro": self.cache_write_micro,
            "output_micro": self.output_micro,
        }


@dataclass(frozen=True)
class BillableTokens:
    """Token counts after removing subset overlaps, ready to price."""

    uncached_input_tokens: int
    cached_input_tokens: int
    cache_write_tokens: int
    output_tokens: int

    @property
    def total_tokens(self) -> int:
        return (
            self.uncached_input_tokens
            + self.cached_input_tokens
            + self.cache_write_tokens
            + self.output_tokens
        )


@dataclass(frozen=True)
class CreditCost:
    credits: int
    micro_credits: int
    tokens: BillableTokens
    provider_model: str
    pricing_version: str


PROVIDER_PRICES: dict[str, ProviderTokenPrices] = {
    "qwen3.8-max": ProviderTokenPrices(
        uncached_input=12.0,
        cached_input=1.5,
        cache_write=15.0,
        output=36.0,
    ),
}


def _micro_per_token(price_per_million_rmb: float, markup: float) -> int:
    """Convert a provider RMB/1M-token price into micro credits per token.

    micro/token = (price / 1e6) * markup / credit_unit_price * 1e6
                = price * markup / credit_unit_price
    """
    if price_per_million_rmb <= 0:
        return 0
    return max(1, round(price_per_million_rmb * markup / CREDIT_UNIT_PRICE_RMB))


def build_rates(
    provider_model: str,
    prices: ProviderTokenPrices,
    markup: float = DEFAULT_MARKUP,
) -> ModelCreditRates:
    return ModelCreditRates(
        provider_model=provider_model,
        uncached_input_micro=_micro_per_token(prices.uncached_input, markup),
        cached_input_micro=_micro_per_token(prices.cached_input, markup),
        cache_write_micro=_micro_per_token(prices.cache_write, markup),
        output_micro=_micro_per_token(prices.output, markup),
    )


def _markup() -> float:
    """Markup multiplier, overridable via BILLING_CREDIT_MARKUP."""
    from app.core.config import get_settings

    try:
        configured = float(get_settings().billing_credit_markup)
    except (AttributeError, TypeError, ValueError):
        return DEFAULT_MARKUP
    return configured if configured > 0 else DEFAULT_MARKUP


def rates_for_model(provider_model: str | None = None) -> ModelCreditRates:
    key = (provider_model or "").strip() or DEFAULT_PROVIDER_MODEL
    prices = PROVIDER_PRICES.get(key)
    if prices is None:
        # Unknown model: fall back to the flagship price so we never undercharge.
        prices = PROVIDER_PRICES[DEFAULT_PROVIDER_MODEL]
    return build_rates(key, prices, _markup())


def _safe_counter(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def billable_tokens(
    *,
    input_tokens: Any,
    output_tokens: Any,
    cache_read_tokens: Any = 0,
    cache_write_tokens: Any = 0,
) -> BillableTokens:
    """Split raw usage counters into non-overlapping billable buckets.

    OpenAI-compatible responses report ``prompt_tokens`` as the *total* prompt
    size, with ``cached_tokens`` a subset of it. ``completion_tokens`` likewise
    already includes ``reasoning_tokens``, and DashScope prices reasoning at the
    output rate, so reasoning must never be added on top.
    """
    prompt = _safe_counter(input_tokens)
    cached = _safe_counter(cache_read_tokens)
    written = _safe_counter(cache_write_tokens)
    output = _safe_counter(output_tokens)

    cached = min(cached, prompt)
    written = min(written, prompt - cached)
    uncached = max(0, prompt - cached - written)

    return BillableTokens(
        uncached_input_tokens=uncached,
        cached_input_tokens=cached,
        cache_write_tokens=written,
        output_tokens=output,
    )


def credits_for_tokens(
    tokens: BillableTokens,
    provider_model: str | None = None,
) -> CreditCost:
    rates = rates_for_model(provider_model)
    micro = (
        tokens.uncached_input_tokens * rates.uncached_input_micro
        + tokens.cached_input_tokens * rates.cached_input_micro
        + tokens.cache_write_tokens * rates.cache_write_micro
        + tokens.output_tokens * rates.output_micro
    )
    return CreditCost(
        credits=ceil(micro / MICRO_PER_CREDIT),
        micro_credits=micro,
        tokens=tokens,
        provider_model=rates.provider_model,
        pricing_version=PRICING_VERSION,
    )


def credits_for_usage(
    *,
    input_tokens: Any,
    output_tokens: Any,
    cache_read_tokens: Any = 0,
    cache_write_tokens: Any = 0,
    provider_model: str | None = None,
) -> CreditCost:
    return credits_for_tokens(
        billable_tokens(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_write_tokens=cache_write_tokens,
        ),
        provider_model,
    )


def pricing_table() -> dict[str, Any]:
    """Rate card exposed to clients for display-only cost estimates."""
    return {
        "pricing_version": PRICING_VERSION,
        "credit_unit_price_rmb": CREDIT_UNIT_PRICE_RMB,
        "micro_per_credit": MICRO_PER_CREDIT,
        "models": {
            model: rates_for_model(model).as_dict() for model in sorted(PROVIDER_PRICES)
        },
    }
