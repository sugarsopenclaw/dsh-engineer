"""Report how much of our prompt traffic actually hits the provider's prefix cache.

Model Studio's implicit context cache is always on for qwen3.8-max and cannot be
disabled, so this is not a feature toggle report -- it measures whether our prompt
*layout* lets the cache work. A cached input token costs Y1.5/1M against Y12/1M
uncached, so the hit rate is roughly a 8x lever on input spend.

The diagnostic that matters is not the hit *rate* but the hit *volume*: if
``cache_read_tokens`` stays flat as conversations grow, only the static head
(system + tools) is cacheable and the transcript is being re-charged every turn.
That was the case until 2026-08-17, when the per-turn context layer moved from the
head of ``messages`` to the tail (it carries a wall-clock timestamp, so at the head
it desynced the prefix on every request). Baseline before that change, over 3734
calls: subagent 83.2%, main 19.2%, main cache_read p50 14,336 and max 22,528
regardless of input size.

    python scripts/report_prefix_cache_hits.py --days 7
    python scripts/report_prefix_cache_hits.py --days 30 --since-release 2026-08-20

Read-only: issues SELECTs and never writes.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.security import utcnow
from app.domain.billing.pricing import DEFAULT_PROVIDER_MODEL, PROVIDER_PRICES
from app.schemas.agent_usage_call import AgentUsageCall

# Under head injection the main agent never cached more than ~22.5k tokens, because
# the volatile layer sat in front of the transcript. Any main call above this is
# proof that a tail-injection client produced it.
LEGACY_MAIN_CACHE_CEILING = 40_000

# Buckets chosen so the flat-vs-scaling signature is visible: a cache that only
# covers the static head shows a falling percentage across rising input sizes.
INPUT_BUCKETS = [20_000, 40_000, 60_000, 100_000, 150_000, 250_000]


def bucket_label(input_tokens: int) -> str:
    previous = 0
    for edge in INPUT_BUCKETS:
        if input_tokens < edge:
            return f"{previous // 1000}k-{edge // 1000}k"
        previous = edge
    return f">{INPUT_BUCKETS[-1] // 1000}k"


def pct(part: int, whole: int) -> str:
    if whole <= 0:
        return "n/a"
    return f"{part / whole * 100:.1f}%"


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def input_cost_rmb(uncached: int, cached: int) -> float:
    prices = PROVIDER_PRICES[DEFAULT_PROVIDER_MODEL]
    return (uncached * prices.uncached_input + cached * prices.cached_input) / 1_000_000


def parse_day(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def summarize(title: str, calls: list[AgentUsageCall]) -> None:
    print(f"\n=== {title} ({len(calls)} calls) ===")
    if not calls:
        print("  no calls in this window")
        return

    by_purpose: dict[str, list[AgentUsageCall]] = defaultdict(list)
    for call in calls:
        by_purpose[call.call_purpose].append(call)

    print(f"  {'purpose':<14} {'calls':>7} {'input':>14} {'cache_read':>14} {'hit':>7}")
    for purpose in sorted(by_purpose, key=lambda key: -sum(c.input_tokens for c in by_purpose[key])):
        group = by_purpose[purpose]
        total_input = sum(call.input_tokens for call in group)
        total_cached = sum(call.cache_read_tokens for call in group)
        print(
            f"  {purpose:<14} {len(group):>7,} {total_input:>14,} "
            f"{total_cached:>14,} {pct(total_cached, total_input):>7}"
        )

    written = sum(call.cache_write_tokens for call in calls)
    if written:
        print(f"  note: cache_write_tokens={written:,} -- explicit cache is in play, not implicit")

    main_calls = [call for call in by_purpose.get("main", []) if call.input_tokens > 0]
    if not main_calls:
        return

    print("\n  main agent: cache volume vs conversation size")
    print(f"    {'input bucket':<14} {'calls':>7} {'avg input':>12} {'avg cached':>12} {'hit':>7}")
    buckets: dict[str, list[AgentUsageCall]] = defaultdict(list)
    for call in main_calls:
        buckets[bucket_label(call.input_tokens)].append(call)
    ordered = [f"{0 // 1000}k-{INPUT_BUCKETS[0] // 1000}k"] + [
        f"{INPUT_BUCKETS[i] // 1000}k-{INPUT_BUCKETS[i + 1] // 1000}k"
        for i in range(len(INPUT_BUCKETS) - 1)
    ] + [f">{INPUT_BUCKETS[-1] // 1000}k"]
    for label in ordered:
        group = buckets.get(label)
        if not group:
            continue
        total_input = sum(call.input_tokens for call in group)
        total_cached = sum(call.cache_read_tokens for call in group)
        print(
            f"    {label:<14} {len(group):>7,} {total_input // len(group):>12,} "
            f"{total_cached // len(group):>12,} {pct(total_cached, total_input):>7}"
        )

    reads = [call.cache_read_tokens for call in main_calls]
    breakthrough = [value for value in reads if value > LEGACY_MAIN_CACHE_CEILING]
    print(
        f"\n    cache_read p50={percentile(reads, 0.50):,} "
        f"p95={percentile(reads, 0.95):,} max={max(reads):,}"
    )
    print(
        f"    above legacy ceiling ({LEGACY_MAIN_CACHE_CEILING:,}): "
        f"{len(breakthrough):,} / {len(main_calls):,} calls"
        " -- nonzero means tail-injection clients are live"
    )

    uncached = sum(call.input_tokens - call.cache_read_tokens for call in calls)
    cached = sum(call.cache_read_tokens for call in calls)
    actual = input_cost_rmb(uncached, cached)
    without = input_cost_rmb(uncached + cached, 0)
    print(
        f"\n  input cost (all purposes): Y{actual:,.2f} actual vs "
        f"Y{without:,.2f} with no cache -- saved Y{without - actual:,.2f}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=7, help="lookback window in days")
    parser.add_argument(
        "--since-release",
        default="",
        help="UTC date (YYYY-MM-DD) splitting the window into before/after a release",
    )
    args = parser.parse_args()

    since = utcnow() - timedelta(days=max(1, args.days))
    cutoff = parse_day(args.since_release) if args.since_release.strip() else None

    with SessionLocal() as session:
        calls = list(
            session.scalars(
                select(AgentUsageCall).where(AgentUsageCall.started_at >= since)
            ).all()
        )

    if not calls:
        print(f"no agent_usage_calls in the last {args.days} days")
        return 0

    print(f"window: last {args.days} days ({since:%Y-%m-%d} onward), {len(calls)} calls")
    prices = PROVIDER_PRICES[DEFAULT_PROVIDER_MODEL]
    print(
        f"pricing: uncached Y{prices.uncached_input}/1M vs cached "
        f"Y{prices.cached_input}/1M per input token"
    )

    if cutoff is None:
        summarize("whole window", calls)
        return 0

    summarize(f"before {cutoff:%Y-%m-%d}", [c for c in calls if c.started_at < cutoff])
    summarize(f"on/after {cutoff:%Y-%m-%d}", [c for c in calls if c.started_at >= cutoff])
    print(
        "\nCaution: agent_usage_calls has no client version column, so the post-release"
        "\nwindow mixes updated and stale clients until auto-update finishes. Trust the"
        "\nlong-conversation buckets and the legacy-ceiling counter over the headline rate."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
