from __future__ import annotations

from collections.abc import Callable
from typing import Any


def _gte(left: Any, right: Any) -> bool:
    return float(left) >= float(right)


def _lte(left: Any, right: Any) -> bool:
    return float(left) <= float(right)


def _eq(left: Any, right: Any) -> bool:
    return left == right


def _ne(left: Any, right: Any) -> bool:
    return left != right


def _between(left: Any, right: Any) -> bool:
    if not isinstance(right, (tuple, list)) or len(right) != 2:
        raise ValueError("between requires a two-value parameter")
    value = float(left)
    lower = float(right[0])
    upper = float(right[1])
    if upper < lower:
        raise ValueError("between parameter must be ordered")
    return lower <= value <= upper


def _distinct(left: Any, right: Any) -> bool:
    del right
    values = tuple(left)
    normalized = tuple(
        item.casefold().strip() if isinstance(item, str) else item
        for item in values
    )
    return len(normalized) == len(set(normalized))


_PREDICATES: dict[str, Callable[[Any, Any], bool]] = {
    "between": _between,
    "distinct": _distinct,
    "eq": _eq,
    "gte": _gte,
    "lte": _lte,
    "ne": _ne,
}

PREDICATE_WHITELIST = tuple(sorted(_PREDICATES))


def evaluate_predicate(op: str, left: Any, right: Any = None) -> bool:
    try:
        predicate = _PREDICATES[op]
    except KeyError as error:
        raise ValueError(f"Rule predicate is not allowed: {op}") from error
    return predicate(left, right)

