"""Optional Redis-backed L2 cache for the unified gateway."""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil
import logging
import os
import pickle
import time
from typing import Any

from app.infrastructure.cache.base import CacheLookup
from app.policies.cache_policy import CachePolicy

LOGGER = logging.getLogger(__name__)

try:
    import redis
    from redis.exceptions import RedisError
except ModuleNotFoundError:  # pragma: no cover
    redis = None

    class RedisError(Exception):
        """Fallback Redis error type when redis-py is unavailable."""


@dataclass(frozen=True)
class _RedisPayload:
    value: Any
    as_of: str
    expires_at: float
    stale_until: float


class RedisCache:
    def __init__(
        self,
        url: str | None = None,
        prefix: str | None = None,
        client: Any | None = None,
    ) -> None:
        self._prefix = (prefix or os.getenv("GATEWAY_REDIS_PREFIX") or "gateway-cache").strip()
        self._client = client or self._build_client(url=url or os.getenv("GATEWAY_REDIS_URL"))

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def get(self, key: str, allow_stale: bool = False) -> CacheLookup | None:
        if self._client is None:
            return None

        try:
            raw_payload = self._client.get(self._format_key(key))
        except RedisError as exc:
            LOGGER.warning("Redis get failed for key '%s': %s", key, exc)
            return None

        if raw_payload is None:
            return None

        try:
            payload = self._deserialize(raw_payload)
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("Redis payload decode failed for key '%s': %s", key, exc)
            return None

        now = time.time()
        if payload.expires_at >= now:
            return CacheLookup(
                value=payload.value,
                as_of=payload.as_of,
                is_stale=False,
                expires_at=payload.expires_at,
                stale_until=payload.stale_until,
            )

        if allow_stale and payload.stale_until >= now:
            return CacheLookup(
                value=payload.value,
                as_of=payload.as_of,
                is_stale=True,
                expires_at=payload.expires_at,
                stale_until=payload.stale_until,
            )

        if payload.stale_until < now:
            try:
                self._client.delete(self._format_key(key))
            except RedisError:
                return None

        return None

    def set(self, key: str, value: Any, policy: CachePolicy, as_of: str) -> None:
        if self._client is None:
            return

        now = time.time()
        expires_at = now + policy.fresh_ttl_seconds
        stale_until = now + policy.fresh_ttl_seconds + policy.stale_ttl_seconds
        ttl_seconds = max(1, ceil(stale_until - now))
        payload = self._serialize(
            _RedisPayload(
                value=value,
                as_of=as_of,
                expires_at=expires_at,
                stale_until=stale_until,
            )
        )

        try:
            self._client.set(self._format_key(key), payload, ex=ttl_seconds)
        except RedisError as exc:
            LOGGER.warning("Redis set failed for key '%s': %s", key, exc)

    def clear(self) -> None:
        if self._client is None:
            return

        try:
            keys = list(self._client.scan_iter(match=f"{self._prefix}:*"))
            if keys:
                self._client.delete(*keys)
        except RedisError as exc:
            LOGGER.warning("Redis clear failed for prefix '%s': %s", self._prefix, exc)

    def _build_client(self, url: str | None) -> Any | None:
        if not url or redis is None:
            return None

        try:
            return redis.Redis.from_url(
                url,
                decode_responses=False,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
            )
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("Redis client initialization failed: %s", exc)
            return None

    def _format_key(self, key: str) -> str:
        return f"{self._prefix}:{key}"

    @staticmethod
    def _serialize(payload: _RedisPayload) -> bytes:
        return pickle.dumps(payload, protocol=pickle.HIGHEST_PROTOCOL)

    @staticmethod
    def _deserialize(payload: bytes) -> _RedisPayload:
        decoded = pickle.loads(payload)
        if not isinstance(decoded, _RedisPayload):
            raise TypeError("Unexpected Redis payload type")
        return decoded

