"""Unified gateway for intelligence-oriented datasets."""

from __future__ import annotations

import time

from app.contracts.common import BatchItemError
from app.contracts.intelligence import (
    StockEvidenceBatchData,
    StockEvidenceBatchResponse,
    StockEvidenceData,
    StockEvidenceResponse,
    StockResearchPackData,
    StockResearchPackResponse,
    ThemeConceptsData,
    ThemeConceptsResponse,
    ThemeNewsData,
    ThemeNewsResponse,
)
from app.contracts.meta import GatewayWarning
from app.gateway.common import GatewayError, build_meta, execute_cached, gateway_cache
from app.infrastructure.metrics.recorder import metrics_recorder
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy
from app.providers.akshare.client import AkShareProviderClient
from app.providers.akshare.mappers import (
    to_company_evidence,
    to_company_research_pack,
    to_concept_match_item,
    to_theme_news_item,
)


class IntelligenceGateway:
    def __init__(self, provider_client: AkShareProviderClient | None = None) -> None:
        self._provider_client = provider_client or AkShareProviderClient()
        self._retry_policy = RetryPolicy(max_attempts=1)
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
                for item in self._provider_client.get_theme_news(
                    theme=theme,
                    days=days,
                    limit=limit,
                )
            ],
            cache_policy=get_cache_policy("theme_news"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
            allow_stale=False,
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
            allow_stale=False,
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
        result = self._get_stock_evidence_result(
            stock_code=stock_code,
            concept=concept,
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

    def get_stock_evidence_batch(
        self,
        request_id: str,
        stock_codes: list[str],
        concept: str,
        force_refresh: bool = False,
    ) -> StockEvidenceBatchResponse:
        started_at = time.perf_counter()
        items = []
        errors: list[BatchItemError] = []
        warnings: list[GatewayWarning] = []
        cache_hits: list[bool] = []
        stale_hits: list[bool] = []
        as_of_values: list[str] = []

        for stock_code in stock_codes:
            try:
                result = self._get_stock_evidence_result(
                    stock_code=stock_code,
                    concept=concept,
                    force_refresh=force_refresh,
                )
                items.append(result.data)
                cache_hits.append(result.cache_hit)
                stale_hits.append(result.is_stale)
                as_of_values.append(result.as_of)
                warnings.extend(result.warnings)
            except Exception as exc:  # noqa: BLE001
                errors.append(
                    BatchItemError(
                        stockCode=stock_code,
                        code=str(getattr(exc, "code", "company_evidence_unavailable")),
                        message=str(getattr(exc, "message", exc)),
                    )
                )

        if not items and errors:
            raise GatewayError(
                code="company_evidence_unavailable",
                message=errors[0].message,
                status_code=503,
                provider=self._provider_client.provider_name,
            )

        if errors:
            warnings.append(
                GatewayWarning(
                    code="partial_results",
                    message="批量公司证据存在部分失败，详情见 data.errors",
                )
            )

        return StockEvidenceBatchResponse(
            meta=build_meta(
                request_id=request_id,
                provider=self._provider_client.provider_name,
                started_at=started_at,
                cache_hit=bool(items) and all(cache_hits),
                is_stale=any(stale_hits),
                warnings=self._dedupe_warnings(warnings),
                as_of=max(as_of_values) if as_of_values else None,
            ),
            data=StockEvidenceBatchData(items=items, errors=errors),
        )

    def get_stock_research_pack(
        self,
        request_id: str,
        stock_code: str,
        concept: str | None,
        force_refresh: bool = False,
    ) -> StockResearchPackResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="company_research_pack",
            provider=self._provider_client.provider_name,
            params={"stockCode": stock_code, "concept": concept or ""},
            fetcher=lambda: to_company_research_pack(
                self._provider_client.get_stock_research_pack(
                    stock_code=stock_code,
                    concept=concept,
                )
            ),
            cache_policy=get_cache_policy("company_research_pack"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
            allow_stale=False,
        )

        return StockResearchPackResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=StockResearchPackData(
                stockCode=result.data.stockCode,
                concept=result.data.concept,
                researchPack=result.data,
            ),
        )

    def _get_stock_evidence_result(
        self,
        *,
        stock_code: str,
        concept: str | None,
        force_refresh: bool,
    ):
        return execute_cached(
            dataset="company_evidence",
            provider=self._provider_client.provider_name,
            params={"stockCode": stock_code, "concept": concept or ""},
            fetcher=lambda: to_company_evidence(
                self._provider_client.get_stock_evidence(
                    stock_code=stock_code,
                    concept=concept,
                )
            ),
            cache_policy=get_cache_policy("company_evidence"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
            allow_stale=False,
        )

    @staticmethod
    def _dedupe_warnings(warnings: list[GatewayWarning]) -> list[GatewayWarning]:
        seen: set[tuple[str, str]] = set()
        deduped: list[GatewayWarning] = []

        for warning in warnings:
            key = (warning.code, warning.message)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(warning)

        return deduped


intelligence_gateway = IntelligenceGateway()
