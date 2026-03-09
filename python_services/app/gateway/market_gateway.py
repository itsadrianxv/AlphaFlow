"""Unified gateway for market-oriented datasets."""

from __future__ import annotations

import time

from app.contracts.common import BatchItemError
from app.contracts.market import (
    MarketStockBatchData,
    MarketStockBatchResponse,
    MarketStockResponse,
    ThemeCandidatesData,
    ThemeCandidatesResponse,
)
from app.contracts.meta import GatewayWarning
from app.gateway.common import build_meta, execute_cached, gateway_cache
from app.infrastructure.metrics.recorder import metrics_recorder
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy
from app.providers.akshare.client import AkShareProviderClient
from app.providers.akshare.mappers import to_market_stock, to_theme_candidate


class MarketGateway:
    def __init__(self, provider_client: AkShareProviderClient | None = None) -> None:
        self._provider_client = provider_client or AkShareProviderClient()
        self._retry_policy = RetryPolicy()
        self._cache = gateway_cache

    def get_stock(
        self,
        request_id: str,
        stock_code: str,
        force_refresh: bool = False,
    ) -> MarketStockResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="stock_snapshot",
            provider=self._provider_client.provider_name,
            params={"stockCode": stock_code},
            fetcher=lambda: to_market_stock(
                self._provider_client.get_stock_snapshot(stock_code),
                self._provider_client.provider_name,
            ),
            cache_policy=get_cache_policy("stock_snapshot"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return MarketStockResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=result.data,
        )

    def get_stock_batch(
        self,
        request_id: str,
        stock_codes: list[str],
        force_refresh: bool = False,
    ) -> MarketStockBatchResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="stock_batch",
            provider=self._provider_client.provider_name,
            params={"stockCodes": sorted(stock_codes)},
            fetcher=lambda: [
                to_market_stock(item, self._provider_client.provider_name)
                for item in self._provider_client.get_stock_batch(stock_codes)
            ],
            cache_policy=get_cache_policy("stock_batch"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        found_codes = {item.stockCode for item in result.data}
        errors = [
            BatchItemError(
                stockCode=stock_code,
                code="stock_not_found",
                message=f"未找到股票 {stock_code}",
            )
            for stock_code in stock_codes
            if stock_code not in found_codes
        ]

        warnings = list(result.warnings)
        if errors:
            warnings.append(
                GatewayWarning(
                    code="partial_results",
                    message="批量请求部分成功，未命中的股票已在 data.errors 中返回",
                )
            )

        metrics_recorder.record_batch_success(
            dataset="stock_batch",
            provider=result.provider,
            success_count=len(result.data),
            total_count=len(stock_codes),
        )

        return MarketStockBatchResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=warnings,
                as_of=result.as_of,
            ),
            data=MarketStockBatchData(items=result.data, errors=errors),
        )

    def get_theme_candidates(
        self,
        request_id: str,
        theme: str,
        limit: int,
        force_refresh: bool = False,
    ) -> ThemeCandidatesResponse:
        started_at = time.perf_counter()
        metrics_recorder.record_theme_request(dataset="theme_candidates", theme=theme)
        result = execute_cached(
            dataset="theme_candidates",
            provider=self._provider_client.provider_name,
            params={"theme": theme, "limit": limit},
            fetcher=lambda: [
                to_theme_candidate(item)
                for item in self._provider_client.get_theme_candidates(theme=theme, limit=limit)
            ],
            cache_policy=get_cache_policy("theme_candidates"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return ThemeCandidatesResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=ThemeCandidatesData(theme=theme, candidates=result.data),
        )


market_gateway = MarketGateway()
