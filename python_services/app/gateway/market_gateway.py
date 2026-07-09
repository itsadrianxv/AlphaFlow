"""Unified gateway for market-oriented datasets."""

from __future__ import annotations

import time

from app.contracts.common import BatchItemError
from app.contracts.market import (
    IndicatorHistoryData,
    IndicatorHistoryPoint,
    IndicatorHistoryResponse,
    IndustriesData,
    IndustriesResponse,
    MarketStockBatchData,
    MarketStockBatchResponse,
    MarketStockResponse,
    StockCodesData,
    StockCodesResponse,
    ThemeCandidatesData,
    ThemeCandidatesResponse,
)
from app.contracts.meta import GatewayWarning
from app.gateway.common import build_meta, execute_cached, gateway_cache
from app.infrastructure.metrics.recorder import metrics_recorder
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy
from app.providers.mappers import to_market_stock, to_theme_candidate
from app.providers.tushare.client import TushareProviderClient
from app.services.zhipu_search_client import ZhipuSearchClient


class MarketGateway:
    def __init__(
        self,
        provider_client: TushareProviderClient | None = None,
        zhipu_client: ZhipuSearchClient | None = None,
    ) -> None:
        self._provider_client = provider_client or TushareProviderClient()
        self._zhipu_client = zhipu_client or ZhipuSearchClient()
        self._retry_policy = RetryPolicy()
        self._theme_retry_policy = RetryPolicy(max_attempts=1)
        self._cache = gateway_cache

    def get_stock_codes(
        self,
        request_id: str,
        force_refresh: bool = False,
    ) -> StockCodesResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="stock_universe",
            provider=self._provider_client.provider_name,
            params={"scope": "all", "limit": 0},
            fetcher=lambda: self._build_stock_codes_data(),
            cache_policy=get_cache_policy("stock_universe"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return StockCodesResponse(
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

    def get_available_industries(
        self,
        request_id: str,
        force_refresh: bool = False,
    ) -> IndustriesResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="stock_industries",
            provider=self._provider_client.provider_name,
            params={"scope": "all"},
            fetcher=lambda: self._build_industries_data(),
            cache_policy=get_cache_policy("stock_industries"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return IndustriesResponse(
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

    def get_indicator_history(
        self,
        request_id: str,
        stock_code: str,
        indicator: str,
        years: int,
        force_refresh: bool = False,
    ) -> IndicatorHistoryResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="indicator_history",
            provider=self._provider_client.provider_name,
            params={
                "stockCode": stock_code,
                "indicator": indicator,
                "years": years,
            },
            fetcher=lambda: IndicatorHistoryData(
                stockCode=stock_code,
                indicator=indicator,
                years=years,
                points=[
                    IndicatorHistoryPoint(**point)
                    for point in self._provider_client.get_indicator_history(
                        stock_code,
                        indicator,
                        years,
                    )
                ],
            ),
            cache_policy=get_cache_policy("indicator_history"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return IndicatorHistoryResponse(
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
                message=f"未找到证券 {stock_code}",
            )
            for stock_code in stock_codes
            if stock_code not in found_codes
        ]

        warnings = list(result.warnings)
        if errors:
            warnings.append(
                GatewayWarning(
                    code="partial_results",
                    message="批量请求部分成功，未命中的证券已在 data.errors 中返回",
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
                for item in self._provider_client.get_theme_candidates(
                    theme=theme,
                    limit=limit,
                    concept_hints=self._zhipu_client.search_theme_concepts(
                        theme=theme,
                        limit=5,
                    ),
                )
            ],
            cache_policy=get_cache_policy("theme_candidates"),
            retry_policy=self._theme_retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
            allow_stale=True,
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

    def _build_stock_codes_data(self) -> StockCodesData:
        codes = self._provider_client.get_all_stock_codes()
        return StockCodesData(codes=codes, total=len(codes))

    def _build_industries_data(self) -> IndustriesData:
        industries = self._provider_client.get_available_industries()
        return IndustriesData(industries=industries, total=len(industries))


market_gateway = MarketGateway()
