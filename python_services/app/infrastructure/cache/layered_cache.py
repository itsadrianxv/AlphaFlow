"""L1 memory + optional L2 Redis cache facade."""

from __future__ import annotations

from math import ceil
import time
from typing import Any

from app.infrastructure.cache.base import CacheLookup, CacheStore
from app.infrastructure.cache.memory_cache import MemoryCache
from app.policies.cache_policy import CachePolicy


class LayeredCache:
    def __init__(
        self,
        l1_cache: MemoryCache | None = None,
        l2_cache: CacheStore | None = None,
    ) -> None:
        self._l1_cache = l1_cache or MemoryCache()
        self._l2_cache = l2_cache

    def get(self, key: str, allow_stale: bool = False) -> CacheLookup | None:
        l1_entry = self._l1_cache.get(key, allow_stale=allow_stale)
        if l1_entry is not None:
            return l1_entry

        if self._l2_cache is None:
            return None

        l2_entry = self._l2_cache.get(key, allow_stale=allow_stale)
        if l2_entry is None:
            return None

        self._backfill_l1(key, l2_entry)
        return l2_entry

    def set(self, key: str, value: Any, policy: CachePolicy, as_of: str) -> None:
        self._l1_cache.set(key, value, policy, as_of)
        if self._l2_cache is not None:
            self._l2_cache.set(key, value, policy, as_of)

    def clear(self) -> None:
        self._l1_cache.clear()
        if self._l2_cache is not None:
            self._l2_cache.clear()

    def _backfill_l1(self, key: str, entry: CacheLookup) -> None:
        now = time.time()
        fresh_ttl_seconds = max(0, ceil(entry.expires_at - now))
        stale_ttl_seconds = max(0, ceil(entry.stale_until - max(now, entry.expires_at)))

        self._l1_cache.set(
            key,
            entry.value,
            CachePolicy(
                fresh_ttl_seconds=fresh_ttl_seconds,
                stale_ttl_seconds=stale_ttl_seconds,
            ),
            entry.as_of,
        )

