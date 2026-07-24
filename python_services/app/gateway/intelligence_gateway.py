"""Unified gateway for intelligence-oriented datasets."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import time

from app.contracts.common import BatchItemError
from app.contracts.intelligence import (
    NewsRadarData,
    NewsRadarResponse,
    StockEvidenceBatchData,
    StockEvidenceBatchResponse,
    StockEvidenceData,
    StockEvidenceResponse,
    StockResearchPackData,
    StockResearchPackResponse,
    ScopedNewsData,
    ScopedNewsResponse,
    ThemeConceptsData,
    ThemeConceptsResponse,
    ThemeNewsData,
    ThemeNewsResponse,
)
from app.contracts.meta import GatewayWarning
from app.gateway.common import GatewayError, GatewayFetchResult, build_meta, execute_cached, gateway_cache
from app.infrastructure.metrics.recorder import metrics_recorder
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy
from app.providers.mappers import (
    to_company_evidence,
    to_company_research_pack,
    to_concept_match_item,
    to_theme_news_item,
)
from app.providers.tushare.client import TushareProviderClient
from app.providers.minishare.news import MinishareNewsProvider, NewsQuery, RadarCompany, RadarIndustry


class IntelligenceGateway:
    def __init__(
        self,
        provider_client: TushareProviderClient | None = None,
        news_provider: MinishareNewsProvider | None = None,
    ) -> None:
        self._provider_client = provider_client or TushareProviderClient()
        self._news_provider = news_provider or MinishareNewsProvider()
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
        result = self._get_news_result(
            query=NewsQuery(scope="theme", target=theme, days=days, limit=limit, terms=(theme,)),
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

    def get_macro_news(self, request_id: str, days: int, limit: int, force_refresh: bool = False) -> ScopedNewsResponse:
        return self._get_scoped_news(request_id, NewsQuery(scope="macro", target="宏观", days=days, limit=limit), force_refresh)

    def get_industry_news(self, request_id: str, industry: str, days: int, limit: int, force_refresh: bool = False) -> ScopedNewsResponse:
        return self._get_scoped_news(request_id, NewsQuery(scope="industry", target=industry, days=days, limit=limit, terms=(industry,)), force_refresh)

    def get_company_news(self, request_id: str, stock_code: str, days: int, limit: int, force_refresh: bool = False) -> ScopedNewsResponse:
        snapshot = self._provider_client.get_stock_snapshot(stock_code)
        company_name = str(snapshot.get("name") or snapshot.get("stockName") or stock_code).strip()
        return self._get_scoped_news(
            request_id,
            NewsQuery(scope="company", target=company_name, days=days, limit=limit, terms=(company_name, stock_code), related_stocks=(stock_code,)),
            force_refresh,
        )

    def _get_scoped_news(self, request_id: str, query: NewsQuery, force_refresh: bool) -> ScopedNewsResponse:
        started_at = time.perf_counter()
        result = self._get_news_result(query=query, force_refresh=force_refresh)
        return ScopedNewsResponse(
            meta=build_meta(request_id=request_id, provider=result.provider, started_at=started_at, cache_hit=result.cache_hit, is_stale=result.is_stale, warnings=result.warnings, as_of=result.as_of),
            data=ScopedNewsData(scope=query.scope, target=query.target, newsItems=result.data),
        )

    def _get_news_result(self, *, query: NewsQuery, force_refresh: bool):
        cached = execute_cached(
            dataset=f"{query.scope}_news",
            provider=self._news_provider.provider_name,
            params={"scope": query.scope, "target": query.target, "days": query.days, "limit": query.limit, "terms": list(query.terms), "stocks": list(query.related_stocks)},
            fetcher=lambda: self._news_provider.get_news_result(query),
            cache_policy=get_cache_policy("theme_news"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
            allow_stale=False,
        )
        return GatewayFetchResult(
            data=[to_theme_news_item(item) for item in cached.data.items],
            provider=cached.provider,
            cache_hit=cached.cache_hit,
            is_stale=cached.is_stale,
            as_of=cached.as_of,
            warnings=self._dedupe_warnings([*cached.warnings, *cached.data.warnings]),
        )

    def get_news_radar(
        self,
        request_id: str,
        *,
        companies: list[dict],
        industries: list[dict],
        days: int,
        limit: int,
        end_at=None,
        force_refresh: bool = False,
    ) -> NewsRadarResponse:
        started_at = time.perf_counter()
        normalized_companies = tuple(
            RadarCompany(
                stock_code=str(item.get("stockCode") or "").strip(),
                company_name=str(item.get("companyName") or "").strip()
                or str(item.get("stockCode") or "").strip(),
                aliases=tuple(
                    str(value).strip()
                    for value in item.get("aliases") or []
                    if str(value).strip()
                ),
            )
            for item in companies
        )
        normalized_industries = tuple(
            RadarIndustry(
                name=str(item.get("name") or "").strip(),
                aliases=tuple(
                    str(value).strip()
                    for value in item.get("aliases") or []
                    if str(value).strip()
                ),
            )
            for item in industries
        )
        cached = execute_cached(
            dataset="news_radar",
            provider=self._news_provider.provider_name,
            params={
                "companies": [item.__dict__ for item in normalized_companies],
                "industries": [item.__dict__ for item in normalized_industries],
                "days": days,
                "limit": limit,
                "endAt": end_at.isoformat() if end_at else None,
            },
            fetcher=lambda: self._news_provider.get_radar(
                companies=normalized_companies,
                industries=normalized_industries,
                days=days,
                limit=limit,
                end_at=end_at,
            ),
            cache_policy=get_cache_policy("theme_news"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
            allow_stale=False,
        )
        warnings = self._dedupe_warnings([*cached.warnings, *cached.data.warnings])
        return NewsRadarResponse(
            meta=build_meta(
                request_id=request_id,
                provider=cached.provider,
                started_at=started_at,
                cache_hit=cached.cache_hit,
                is_stale=cached.is_stale,
                warnings=warnings,
                as_of=cached.as_of,
            ),
            data=NewsRadarData(
                days=days,
                companyCount=len(normalized_companies),
                industryCount=len(normalized_industries),
                newsItems=[to_theme_news_item(item) for item in cached.data.items],
            ),
        )

    def get_theme_concepts(
        self,
        request_id: str,
        theme: str,
        limit: int,
        force_refresh: bool = False,
    ) -> ThemeConceptsResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="theme_concepts",
            provider=self._provider_client.provider_name,
            params={"theme": theme, "limit": limit},
            fetcher=lambda: self._provider_client.get_theme_concepts(theme=theme, limit=limit),
            cache_policy=get_cache_policy("theme_concepts"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
            allow_stale=True,
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
        item_slots = [None] * len(stock_codes)
        error_slots = [None] * len(stock_codes)
        warnings: list[GatewayWarning] = []
        cache_hits: list[bool] = []
        stale_hits: list[bool] = []
        as_of_values: list[str] = []

        if stock_codes:
            max_workers = max(1, min(4, len(stock_codes)))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_map = {
                    executor.submit(
                        self._get_stock_evidence_result,
                        stock_code=stock_code,
                        concept=concept,
                        force_refresh=force_refresh,
                    ): (index, stock_code)
                    for index, stock_code in enumerate(stock_codes)
                }
                for future in as_completed(future_map):
                    index, stock_code = future_map[future]
                    try:
                        result = future.result()
                        item_slots[index] = result.data
                        cache_hits.append(result.cache_hit)
                        stale_hits.append(result.is_stale)
                        as_of_values.append(result.as_of)
                        warnings.extend(result.warnings)
                    except Exception as exc:  # noqa: BLE001
                        error_slots[index] = BatchItemError(
                            stockCode=stock_code,
                            code=str(
                                getattr(exc, "code", "company_evidence_unavailable")
                            ),
                            message=str(getattr(exc, "message", exc)),
                        )

        items = [item for item in item_slots if item is not None]
        errors = [error for error in error_slots if error is not None]

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
            allow_stale=True,
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
            allow_stale=True,
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
