"""Shared cache interfaces used by L1/L2 gateway caches."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from app.policies.cache_policy import CachePolicy


@dataclass(frozen=True)
class CacheLookup:
    value: Any
    as_of: str
    is_stale: bool
    expires_at: float
    stale_until: float


class CacheStore(Protocol):
    def get(self, key: str, allow_stale: bool = False) -> CacheLookup | None:
        """Read a cache entry by key."""

    def set(self, key: str, value: Any, policy: CachePolicy, as_of: str) -> None:
        """Write a cache entry using the provided policy."""

    def clear(self) -> None:
        """Clear all managed cache entries."""

