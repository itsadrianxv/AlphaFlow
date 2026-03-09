"""In-process cache with stale-while-revalidate support."""

from __future__ import annotations

from dataclasses import dataclass
import threading
import time
from typing import Any

from app.infrastructure.cache.base import CacheLookup
from app.policies.cache_policy import CachePolicy


@dataclass
class _CacheEntry:
    value: Any
    as_of: str
    expires_at: float
    stale_until: float


class MemoryCache:
    def __init__(self) -> None:
        self._entries: dict[str, _CacheEntry] = {}
        self._lock = threading.Lock()

    def get(self, key: str, allow_stale: bool = False) -> CacheLookup | None:
        now = time.time()

        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None

            if entry.expires_at >= now:
                return CacheLookup(
                    value=entry.value,
                    as_of=entry.as_of,
                    is_stale=False,
                    expires_at=entry.expires_at,
                    stale_until=entry.stale_until,
                )

            if allow_stale and entry.stale_until >= now:
                return CacheLookup(
                    value=entry.value,
                    as_of=entry.as_of,
                    is_stale=True,
                    expires_at=entry.expires_at,
                    stale_until=entry.stale_until,
                )

            if entry.stale_until < now:
                self._entries.pop(key, None)

        return None

    def set(self, key: str, value: Any, policy: CachePolicy, as_of: str) -> None:
        now = time.time()
        entry = _CacheEntry(
            value=value,
            as_of=as_of,
            expires_at=now + policy.fresh_ttl_seconds,
            stale_until=now + policy.fresh_ttl_seconds + policy.stale_ttl_seconds,
        )

        with self._lock:
            self._entries[key] = entry

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
