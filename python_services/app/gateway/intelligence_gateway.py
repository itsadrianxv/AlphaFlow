"""Unified gateway for intelligence-oriented datasets."""

from __future__ import annotations

import time

from app.contracts.intelligence import (
    StockEvidenceData,
    StockEvidenceResponse,
    ThemeConceptsData,
    ThemeConceptsResponse,
    ThemeNewsData,
    ThemeNewsResponse,
)
from app.gateway.common import build_meta, execute_cached, gateway_cache
from app.infrastructure.metrics.recorder import metrics_recorder
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy
from app.providers.akshare.client import AkShareProviderClient
from app.providers.akshare.mappers import (
    to_company_evidence,
    to_concept_match_item,
    to_theme_news_item,
)


class IntelligenceGateway:
    def __init__(self, provider_client: AkShareProviderClient | None = None) -> None:
        self._provider_client = provider_client or AkShareProviderClient()
        self._retry_policy = RetryPolicy()
        self._cache = gateway_cache

    def get_theme_news(
        self,
        request_id: str,
        theme: str,
        days: int,
        limit: int,
        force_refresh: bool = False,
    ) -> ThemeNewsResponse:
        started_at = time.perf_counter()
        metrics_recorder.record_theme_request(dataset="theme_news", theme=theme)
        result = execute_cached(
            dataset="theme_news",
            provider=self._provider_client.provider_name,
            params={"theme": theme, "days": days, "limit": limit},
            fetcher=lambda: [
                to_theme_news_item(item)
                for item in self._provider_client.get_theme_news(theme=theme, days=days, limit=limit)
            ],
            cache_policy=get_cache_policy("theme_news"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return ThemeNewsResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=ThemeNewsData(theme=theme, newsItems=result.data),
        )

    def get_theme_concepts(
        self,
        request_id: str,
        theme: str,
        limit: int,
        force_refresh: bool = False,
    ) -> ThemeConceptsResponse:
        started_at = time.perf_counter()
        metrics_recorder.record_theme_request(dataset="theme_concepts", theme=theme)
        result = execute_cached(
            dataset="theme_concepts",
            provider=self._provider_client.provider_name,
            params={"theme": theme, "limit": limit},
            fetcher=lambda: self._provider_client.get_theme_concepts(theme=theme, limit=limit),
            cache_policy=get_cache_policy("theme_concepts"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        data = ThemeConceptsData(
            theme=str(result.data.get("theme") or theme),
            matchedBy=result.data.get("matchedBy") or "auto",
            conceptMatches=[
                to_concept_match_item(item) for item in result.data.get("concepts") or []
            ],
        )
        metrics_recorder.record_concept_match_source(source=data.matchedBy, theme=theme)

        return ThemeConceptsResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=data,
        )

    def get_stock_evidence(
        self,
        request_id: str,
        stock_code: str,
        concept: str | None,
        force_refresh: bool = False,
    ) -> StockEvidenceResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="company_evidence",
            provider=self._provider_client.provider_name,
            params={"stockCode": stock_code, "concept": concept or ""},
            fetcher=lambda: to_company_evidence(
                self._provider_client.get_stock_evidence(stock_code=stock_code, concept=concept)
            ),
            cache_policy=get_cache_policy("company_evidence"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return StockEvidenceResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=StockEvidenceData(
                stockCode=result.data.stockCode,
                concept=result.data.concept,
                evidence=result.data,
            ),
        )


intelligence_gateway = IntelligenceGateway()
