from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable
from threading import Lock
from typing import Generic, TypeVar, cast


K = TypeVar("K")
V = TypeVar("V")
_MISSING = object()


class TTLCache(Generic[K, V]):
    """Small process-local TTL cache with LRU eviction.

    Values are intentionally opaque. Callers that store mutable models should copy them on
    the way in/out so a response-specific annotation cannot mutate a later cache hit.
    """

    def __init__(
        self,
        *,
        maxsize: int,
        ttl_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if maxsize < 1:
            raise ValueError("maxsize 必须大于 0")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds 必须大于 0")
        self.maxsize = int(maxsize)
        self.ttl_seconds = float(ttl_seconds)
        self._clock = clock
        self._items: OrderedDict[K, tuple[float, V]] = OrderedDict()
        self._lock = Lock()

    def get(self, key: K, default: V | object = _MISSING) -> V | None:
        now = self._clock()
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None if default is _MISSING else cast(V, default)
            expires_at, value = item
            if expires_at <= now:
                self._items.pop(key, None)
                return None if default is _MISSING else cast(V, default)
            self._items.move_to_end(key)
            return value

    def set(self, key: K, value: V) -> None:
        expires_at = self._clock() + self.ttl_seconds
        with self._lock:
            self._items[key] = (expires_at, value)
            self._items.move_to_end(key)
            while len(self._items) > self.maxsize:
                self._items.popitem(last=False)

    def pop(self, key: K, default: V | object = _MISSING) -> V | None:
        with self._lock:
            item = self._items.pop(key, None)
        if item is None:
            return None if default is _MISSING else cast(V, default)
        expires_at, value = item
        if expires_at <= self._clock():
            return None if default is _MISSING else cast(V, default)
        return value

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def __len__(self) -> int:
        now = self._clock()
        with self._lock:
            expired = [key for key, (expires_at, _) in self._items.items() if expires_at <= now]
            for key in expired:
                self._items.pop(key, None)
            return len(self._items)
