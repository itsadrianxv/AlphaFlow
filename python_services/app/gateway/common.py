"""Shared helpers for standardized gateway endpoints."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
import hashlib
import json
import time
from typing import Any, Callable, Generic, TypeVar

from app.contracts.meta import GatewayMeta, GatewayWarning
from app.infrastructure.cache.base import CacheStore
from app.infrastructure.cache.layered_cache import LayeredCache
from app.infrastructure.cache.memory_cache import MemoryCache
from app.infrastructure.cache.redis_cache import RedisCache
from app.infrastructure.metrics.recorder import metrics_recorder
from app.policies.cache_policy import CachePolicy
from app.policies.retry_policy import RetryPolicy, retry_sync

_T = TypeVar("_T")


gateway_cache = LayeredCache(l1_cache=MemoryCache(), l2_cache=RedisCache())


@dataclass(frozen=True)
class GatewayFetchResult(Generic[_T]):
    data: _T
    provider: str
    cache_hit: bool
    is_stale: bool
    as_of: str
    warnings: list[GatewayWarning] = field(default_factory=list)


class GatewayError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 500,
        provider: str = "gateway",
        warnings: list[GatewayWarning] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.provider = provider
        self.warnings = warnings or []


def build_meta(
    request_id: str,
    provider: str,
    started_at: float,
    cache_hit: bool,
    is_stale: bool,
    warnings: list[GatewayWarning] | None = None,
    as_of: str | None = None,
) -> GatewayMeta:
    latency_ms = max(0, int((time.perf_counter() - started_at) * 1000)) if started_at else 0
    return GatewayMeta(
        requestId=request_id,
        provider=provider,
        cacheHit=cache_hit,
        isStale=is_stale,
        latencyMs=latency_ms,
        asOf=as_of or iso_now(),
        warnings=warnings or [],
    )


def build_cache_key(dataset: str, provider: str, params: dict[str, Any]) -> str:
    payload = json.dumps(params, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
    return f"gateway:v1:{dataset}:{provider}:{digest}"


def execute_cached(
    *,
    dataset: str,
    provider: str,
    params: dict[str, Any],
    fetcher: Callable[[], _T],
    cache_policy: CachePolicy,
    retry_policy: RetryPolicy,
    cache: CacheStore | None = None,
    fallback_fn: Callable[[], _T] | None = None,
    force_refresh: bool = False,
    allow_stale: bool = True,
) -> GatewayFetchResult[_T]:
    effective_cache = cache or gateway_cache
    cache_key = build_cache_key(dataset=dataset, provider=provider, params=params)

    if not force_refresh:
        fresh_entry = effective_cache.get(cache_key, allow_stale=False)
        if fresh_entry is not None:
            metrics_recorder.record_cache_result(
                dataset=dataset,
                provider=provider,
                cache_hit=True,
                is_stale=False,
            )
            return GatewayFetchResult(
                data=fresh_entry.value,
                provider=provider,
                cache_hit=True,
                is_stale=False,
                as_of=fresh_entry.as_of,
            )

    stale_entry = effective_cache.get(cache_key, allow_stale=True)
    provider_started_at = time.perf_counter()

    try:
        data = retry_sync(
            fetcher,
            retry_policy,
            should_retry=lambda exc: not isinstance(exc, GatewayError),
            on_retry=lambda _attempt, _exc, _sleep_ms: metrics_recorder.record_retry(
                dataset=dataset,
                provider=provider,
            ),
        )
        metrics_recorder.record_provider_latency(
            dataset=dataset,
            provider=provider,
            latency_ms=max(0.0, (time.perf_counter() - provider_started_at) * 1000),
        )
        metrics_recorder.record_empty_payload(
            dataset=dataset,
            provider=provider,
            is_empty=is_empty_payload(data),
        )
        as_of = iso_now()
        effective_cache.set(cache_key, data, cache_policy, as_of=as_of)
        metrics_recorder.record_cache_result(
            dataset=dataset,
            provider=provider,
            cache_hit=False,
            is_stale=False,
        )
        return GatewayFetchResult(
            data=data,
            provider=provider,
            cache_hit=False,
            is_stale=False,
            as_of=as_of,
        )
    except GatewayError:
        metrics_recorder.record_provider_error(
            dataset=dataset,
            provider=provider,
            code="gateway_error",
        )
        raise
    except Exception as exc:  # noqa: BLE001
        metrics_recorder.record_provider_latency(
            dataset=dataset,
            provider=provider,
            latency_ms=max(0.0, (time.perf_counter() - provider_started_at) * 1000),
        )
        metrics_recorder.record_provider_error(
            dataset=dataset,
            provider=provider,
            code=type(exc).__name__,
        )
        if stale_entry is not None and allow_stale:
            metrics_recorder.record_cache_result(
                dataset=dataset,
                provider=provider,
                cache_hit=True,
                is_stale=True,
            )
            return GatewayFetchResult(
                data=stale_entry.value,
                provider=provider,
                cache_hit=True,
                is_stale=True,
                as_of=stale_entry.as_of,
                warnings=[
                    GatewayWarning(
                        code="stale_cache",
                        message=f"上游 provider 调用失败，已回退到 stale cache: {exc}",
                    )
                ],
            )

        if fallback_fn is not None:
            fallback_data = fallback_fn()
            metrics_recorder.record_empty_payload(
                dataset=dataset,
                provider=provider,
                is_empty=is_empty_payload(fallback_data),
            )
            as_of = iso_now()
            effective_cache.set(cache_key, fallback_data, cache_policy, as_of=as_of)
            metrics_recorder.record_cache_result(
                dataset=dataset,
                provider=provider,
                cache_hit=False,
                is_stale=False,
            )
            return GatewayFetchResult(
                data=fallback_data,
                provider=provider,
                cache_hit=False,
                is_stale=False,
                as_of=as_of,
                warnings=[
                    GatewayWarning(
                        code="mock_fallback",
                        message=f"上游 provider 调用失败，已降级到 fallback 数据: {exc}",
                    )
                ],
            )

        raise GatewayError(
            code="provider_unavailable",
            message=f"上游 provider 不可用: {exc}",
            status_code=503,
            provider=provider,
        ) from exc


def is_valid_stock_code(stock_code: str) -> bool:
    normalized = str(stock_code).strip()
    return normalized.isdigit() and len(normalized) == 6


def is_empty_payload(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, (str, bytes, list, tuple, set, dict)):
        return len(value) == 0
    return False


def iso_now() -> str:
    return datetime.now(UTC).isoformat()


def set_cached_value(
    *,
    dataset: str,
    provider: str,
    params: dict[str, Any],
    value: Any,
    cache_policy: CachePolicy,
    cache: CacheStore | None = None,
    as_of: str | None = None,
) -> None:
    effective_cache = cache or gateway_cache
    cache_key = build_cache_key(dataset=dataset, provider=provider, params=params)
    effective_cache.set(cache_key, value, cache_policy, as_of=as_of or iso_now())
