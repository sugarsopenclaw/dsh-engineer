"""Replay historical agent_usage_calls through the credit pricing engine.

Answers the question the per-run pricing model could never answer: how many
credits would real traffic actually have burned, and how far does each package
go? Run this before enabling enforcement so the package sizing is grounded in
observed usage rather than the estimates in the pricing deck.

    python scripts/estimate_credit_consumption.py --days 30
    python scripts/estimate_credit_consumption.py --scenarios
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.security import utcnow
from app.domain.billing.pricing import (
    CREDIT_UNIT_PRICE_RMB,
    PRICING_VERSION,
    billable_tokens,
    credits_for_usage,
    rates_for_model,
)
from app.domain.billing.products import list_products
from app.schemas.agent_usage_call import AgentUsageCall
from app.schemas.agent_usage_run import AgentUsageRun

CHILD_RUN_SOURCES = {"subagent_completion", "subagent", "child", "child_run"}


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def format_int(value: float) -> str:
    return f"{round(value):,}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=30, help="lookback window in days")
    parser.add_argument(
        "--purpose",
        default="",
        help="only include this call_purpose (default: all)",
    )
    parser.add_argument(
        "--scenarios",
        action="store_true",
        help="also emit landing-page task profiles (dev/release/src/credits.ts)",
    )
    args = parser.parse_args()

    since = utcnow() - timedelta(days=max(1, args.days))

    with SessionLocal() as session:
        statement = select(AgentUsageCall).where(AgentUsageCall.started_at >= since)
        if args.purpose.strip():
            statement = statement.where(AgentUsageCall.call_purpose == args.purpose.strip())
        calls = list(session.scalars(statement).all())

    if not calls:
        print(f"no agent_usage_calls in the last {args.days} days; nothing to calibrate")
        return 0

    rates = rates_for_model()
    print(f"pricing version : {PRICING_VERSION}")
    print(f"credit price    : Y{CREDIT_UNIT_PRICE_RMB}/credit")
    print(
        "micro/token     : "
        f"uncached_in={rates.uncached_input_micro} "
        f"cached_in={rates.cached_input_micro} "
        f"out={rates.output_micro}"
    )
    print(f"window          : last {args.days} days, {len(calls)} calls\n")

    per_run: dict[str, int] = defaultdict(int)
    per_purpose: dict[str, list[int]] = defaultdict(list)
    total_credits = 0
    total_provider_cost = 0.0

    for call in calls:
        cost = credits_for_usage(
            input_tokens=call.input_tokens,
            output_tokens=call.output_tokens,
            cache_read_tokens=call.cache_read_tokens,
            cache_write_tokens=call.cache_write_tokens,
            provider_model=call.provider_model,
        )
        per_run[call.agent_run_id] += cost.credits
        per_purpose[call.call_purpose].append(cost.credits)
        total_credits += cost.credits
        total_provider_cost += cost.micro_credits / 1_000_000 * CREDIT_UNIT_PRICE_RMB

    run_credits = list(per_run.values())
    revenue = total_credits * CREDIT_UNIT_PRICE_RMB
    provider_cost = total_provider_cost / max(1e-9, _markup_used())

    print("credits per run")
    print(f"  runs   : {len(run_credits)}")
    print(f"  mean   : {format_int(total_credits / len(run_credits))}")
    print(f"  p50    : {format_int(percentile(run_credits, 0.50))}")
    print(f"  p90    : {format_int(percentile(run_credits, 0.90))}")
    print(f"  p99    : {format_int(percentile(run_credits, 0.99))}")
    print(f"  max    : {format_int(max(run_credits))}")

    print("\ncredits per call by purpose")
    for purpose in sorted(per_purpose):
        values = per_purpose[purpose]
        print(
            f"  {purpose:<14} n={len(values):<6} "
            f"p50={format_int(percentile(values, 0.50)):<8} "
            f"p90={format_int(percentile(values, 0.90)):<8} "
            f"max={format_int(max(values))}"
        )

    print("\nwindow economics")
    print(f"  credits burned : {format_int(total_credits)}")
    print(f"  retail value   : Y{revenue:,.2f}")
    print(f"  provider cost  : Y{provider_cost:,.2f}")
    if revenue > 0:
        print(f"  gross margin   : {(revenue - provider_cost) / revenue * 100:.1f}%")

    print("\npackage coverage (runs per package, using observed run sizes)")
    p50 = max(1, percentile(run_credits, 0.50))
    p90 = max(1, percentile(run_credits, 0.90))
    for product in list_products():
        print(
            f"  {product.name:<14} Y{product.amount_fen / 100:>7.2f} "
            f"{product.credits:>8,} credits -> "
            f"{product.credits // p50:>6,} runs @p50 / {product.credits // p90:>6,} runs @p90"
        )

    if args.scenarios:
        _print_landing_page_scenarios(since, args.purpose.strip())

    return 0


def _is_child_fragment(run: AgentUsageRun) -> bool:
    text = (run.task_preview or run.original_question or "").strip()
    if text.startswith("[subagent_completion]"):
        return True
    return (run.source or "").lower() in CHILD_RUN_SOURCES


def _print_landing_page_scenarios(since, purpose: str) -> None:
    from sqlalchemy.orm import selectinload

    rates = rates_for_model()
    with SessionLocal() as session:
        statement = select(AgentUsageRun).options(selectinload(AgentUsageRun.usage_calls))
        statement = statement.where(AgentUsageRun.started_at >= since)
        runs = list(session.scalars(statement).all())

    rows = []
    for run in runs:
        items = [
            call
            for call in (run.usage_calls or [])
            if not purpose or call.call_purpose == purpose
        ]
        if not items or _is_child_fragment(run):
            continue
        unc = cached = written = out = credits = 0
        purposes: set[str] = set()
        for call in items:
            tokens = billable_tokens(
                input_tokens=call.input_tokens,
                output_tokens=call.output_tokens,
                cache_read_tokens=call.cache_read_tokens,
                cache_write_tokens=call.cache_write_tokens,
            )
            unc += tokens.uncached_input_tokens
            cached += tokens.cached_input_tokens
            written += tokens.cache_write_tokens
            out += tokens.output_tokens
            credits += credits_for_usage(
                input_tokens=call.input_tokens,
                output_tokens=call.output_tokens,
                cache_read_tokens=call.cache_read_tokens,
                cache_write_tokens=call.cache_write_tokens,
                provider_model=call.provider_model,
            ).credits
            purposes.add(call.call_purpose)
        rows.append(
            {
                "calls": len(items),
                "unc": unc,
                "cached": cached,
                "written": written,
                "out": out,
                "credits": credits,
                "has_cad": "cad_query" in purposes,
                "has_sub": "subagent" in purposes,
            }
        )

    if not rows:
        print("\nlanding-page scenarios: no user-facing runs in window")
        return

    buckets = {
        "single_turn": [row for row in rows if row["calls"] == 1],
        "analysis": [
            row for row in rows if row["calls"] > 1 and row["has_sub"] and not row["has_cad"]
        ],
        "cad_takeoff": [row for row in rows if row["has_cad"]],
        "deep_review": sorted(rows, key=lambda row: row["credits"])[
            max(0, int(len(rows) * 0.9)) :
        ],
    }

    print(f"\nlanding-page scenarios  user-facing runs={len(rows)}")
    for name, group in buckets.items():
        if not group:
            print(f"  {name}: empty")
            continue
        observed = percentile([row["credits"] for row in group], 0.50)
        calls = percentile([row["calls"] for row in group], 0.50)
        nearest = min(group, key=lambda row: abs(row["credits"] - observed))
        micro = (
            nearest["unc"] * rates.uncached_input_micro
            + nearest["cached"] * rates.cached_input_micro
            + nearest["written"] * rates.cache_write_micro
            + nearest["out"] * rates.output_micro
        )
        display = (micro + 999_999) // 1_000_000
        print(
            f"  {name:<12} n={len(group):<4} observed_p50={observed:<6} "
            f"display={display:<6} calls={calls:<3} "
            f"profile=({nearest['unc']}, {nearest['cached']}, "
            f"{nearest['written']}, {nearest['out']})"
        )


def _markup_used() -> float:
    from app.core.config import get_settings

    return float(get_settings().billing_credit_markup)


if __name__ == "__main__":
    raise SystemExit(main())
