"""Canonical JSON and immutable-array helpers.

Snapshot geometry itself is persisted as NPY. Canonical JSON is for contracts,
manifests, diagnostics, and deterministic golden output.
"""

from __future__ import annotations

import dataclasses
import json
import math
from enum import Enum
from pathlib import Path
from typing import Any, Iterable

import numpy as np


def canonicalize(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if dataclasses.is_dataclass(value):
        return {
            field.name: canonicalize(getattr(value, field.name))
            for field in dataclasses.fields(value)
        }
    if isinstance(value, np.ndarray):
        return {
            "__ndarray__": True,
            "dtype": value.dtype.str,
            "shape": list(value.shape),
            "data": canonicalize(value.tolist()),
        }
    if isinstance(value, np.generic):
        return canonicalize(value.item())
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): canonicalize(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [canonicalize(item) for item in value]
    if isinstance(value, (set, frozenset)):
        items = [canonicalize(item) for item in value]
        return sorted(items, key=lambda item: stable_json_dumps(item))
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            label = "nan"
        elif value > 0:
            label = "+inf"
        else:
            label = "-inf"
        return {"__cadkernel_float__": label}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"Unsupported canonical JSON value: {type(value).__qualname__}")


def decanonicalize(value: Any) -> Any:
    if isinstance(value, dict):
        if set(value) == {"__cadkernel_float__"}:
            label = value["__cadkernel_float__"]
            if label == "nan":
                return float("nan")
            if label == "+inf":
                return float("inf")
            if label == "-inf":
                return float("-inf")
            raise ValueError(f"Unknown canonical float label: {label!r}")
        if value.get("__ndarray__") is True:
            array = np.asarray(
                decanonicalize(value["data"]), dtype=np.dtype(value["dtype"])
            )
            return array.reshape(tuple(int(size) for size in value["shape"]))
        return {key: decanonicalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [decanonicalize(item) for item in value]
    return value


def stable_json_dumps(value: Any, *, pretty: bool = False) -> str:
    options: dict[str, Any] = {
        "allow_nan": False,
        "ensure_ascii": False,
        "sort_keys": True,
    }
    if pretty:
        options["indent"] = 2
    else:
        options["separators"] = (",", ":")
    return json.dumps(canonicalize(value), **options)


def stable_json_loads(payload: str) -> Any:
    return decanonicalize(json.loads(payload))


def freeze_array(value: Any, *, dtype: Any | None = None, ndim: int | None = None) -> np.ndarray:
    array = np.asarray(value, dtype=dtype)
    if ndim is not None and array.ndim != ndim:
        raise ValueError(f"Expected a {ndim}D array, got shape {array.shape!r}")
    if not array.flags.c_contiguous:
        array = np.ascontiguousarray(array)
    array.setflags(write=False)
    return array


# Fixed-width Unicode columns cost rows * width * 4 bytes, so a single huge
# string would multiply the whole column's allocation. Beyond this estimate
# the column degrades to an object array, which costs only the actual text.
MAX_FIXED_WIDTH_TEXT_BYTES = 1 << 30


def freeze_text_array(values: Iterable[Any]) -> np.ndarray:
    items = [str(item) for item in values]
    width = max((len(item) for item in items), default=1)
    if len(items) * width * 4 > MAX_FIXED_WIDTH_TEXT_BYTES:
        return freeze_array(items, dtype=object, ndim=1)
    return freeze_array(items, dtype=f"<U{width}", ndim=1)
