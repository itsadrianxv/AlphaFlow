"""Unified gateway for market context snapshots."""

from __future__ import annotations

import os
import time

from app.contracts.market_context import (
    HotThemeContext,
    MarketContextAvailability,
    MarketContextAvailabilityEntry,
    MarketContextDownstreamHints,
    MarketContextSnapshot,
    MarketContextSnapshotResponse,
    MarketFlowSummary,
    MarketRegimeSummary,
    SectionHint,
)
from app.gateway.common import build_meta, execute_cached, gateway_cache, iso_now
from app.gateway.intelligence_gateway import IntelligenceGateway, intelligence_gateway
from app.gateway.market_gateway import MarketGateway, market_gateway
from app.infrastructure.metrics.recorder import MetricsRecorder, metrics_recorder
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy
from app.providers.market_context.tushare_provider import TushareMarketContextProvider


def _default_hot_themes() -> list[str]:
    return [
        item.strip()
        for item in os.getenv("GATEWAY_HOT_THEMES", "AI,算力,机器人").split(",")
        if item.strip()
    ]


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


class MarketContextGateway:
    provider_name = "market-context"

    def __init__(
        self,
        macro_provider: TushareMarketContextProvider | None = None,
        intelligence_data_gateway: IntelligenceGateway | None = None,
        market_data_gateway: MarketGateway | None = None,
        recorder: MetricsRecorder | None = None,
    ) -> None:
        self._macro_provider = macro_provider or TushareMarketContextProvider()
        self._intelligence_gateway = intelligence_data_gateway or intelligence_gateway
        self._market_gateway = market_data_gateway or market_gateway
        self._recorder = recorder or metrics_recorder
        self._retry_policy = RetryPolicy(max_attempts=1)
        self._cache = gateway_cache

    def get_snapshot(
        self,
        request_id: str,
        force_refresh: bool = False,
    ) -> MarketContextSnapshotResponse:
        started_at = time.perf_counter()
        selected_themes = self._select_themes(limit=3)
        result = execute_cached(
            dataset="market_context_snapshot",
            provider=self.provider_name,
            params={"themes": selected_themes},
            fetcher=lambda: self._build_snapshot(selected_themes),
            cache_policy=get_cache_policy("market_context_snapshot"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
            allow_stale=True,
        )

        return MarketContextSnapshotResponse(
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

    def _build_snapshot(self, themes: list[str]) -> MarketContextSnapshot:
        availability = MarketContextAvailability(
            regime=MarketContextAvailabilityEntry(available=True),
            flow=MarketContextAvailabilityEntry(available=True),
            hotThemes=MarketContextAvailabilityEntry(available=True),
        )

        as_of_candidates = [iso_now()]

        macro_snapshot = None
        try:
            macro_snapshot = self._macro_provider.get_macro_snapshot()
            as_of_candidates.append(str(macro_snapshot.get("asOf") or ""))
        except Exception as exc:  # noqa: BLE001
            availability.regime = MarketContextAvailabilityEntry(
                available=False,
                warning=f"macro snapshot unavailable: {exc}",
            )

        flow_snapshot = None
        try:
            flow_snapshot = self._macro_provider.get_hsgt_flow_snapshot()
            as_of_candidates.append(str(flow_snapshot.get("asOf") or ""))
        except Exception as exc:  # noqa: BLE001
            availability.flow = MarketContextAvailabilityEntry(
                available=False,
                warning=f"hsgt flow unavailable: {exc}",
            )

        hot_themes: list[HotThemeContext] = []
        if themes:
            try:
                hot_themes = [
                    self._build_hot_theme(theme=theme, rank=index)
                    for index, theme in enumerate(themes)
                ]
            except Exception as exc:  # noqa: BLE001
                availability.hotThemes = MarketContextAvailabilityEntry(
                    available=False,
                    warning=f"theme aggregation unavailable: {exc}",
                )
        if not hot_themes:
            availability.hotThemes = MarketContextAvailabilityEntry(
                available=False,
                warning=availability.hotThemes.warning or "no hot themes available",
            )

        regime = self._build_regime_summary(macro_snapshot)
        flow = self._build_flow_summary(flow_snapshot)
        status = self._resolve_status(availability)

        return MarketContextSnapshot(
            asOf=max(as_of_candidates),
            status=status,
            regime=regime,
            flow=flow,
            hotThemes=hot_themes,
            downstreamHints=self._build_downstream_hints(
                hot_themes=hot_themes,
                regime=regime,
                flow=flow,
            ),
            availability=availability,
        )

    def _build_hot_theme(self, theme: str, rank: int) -> HotThemeContext:
        news_response = self._intelligence_gateway.get_theme_news(
            request_id=f"market-context:{theme}:news",
            theme=theme,
            days=7,
            limit=5,
        )
        concepts_response = self._intelligence_gateway.get_theme_concepts(
            request_id=f"market-context:{theme}:concepts",
            theme=theme,
            limit=5,
        )
        candidates_response = self._market_gateway.get_theme_candidates(
            request_id=f"market-context:{theme}:candidates",
            theme=theme,
            limit=6,
        )

        news_items = news_response.data.newsItems
        concept_matches = concepts_response.data.conceptMatches
        candidate_stocks = candidates_response.data.candidates

        ranking_score = max(45, 100 - rank * 14)
        candidate_score = _average([candidate.heat for candidate in candidate_stocks]) or 50
        sentiment_bonus = {"positive": 8, "neutral": 0, "negative": -8}
        news_score = _average(
            [
                item.relevanceScore * 100 + sentiment_bonus.get(item.sentiment, 0)
                for item in news_items
            ]
        ) or 50
        heat_score = max(
            0,
            min(
                100,
                round(ranking_score * 0.35 + news_score * 0.35 + candidate_score * 0.30, 2),
            ),
        )

        why_hot_parts = []
        if news_items:
            why_hot_parts.append(news_items[0].title)
        if candidate_stocks:
            why_hot_parts.append(f"候选股热度均值约 {candidate_score:.0f}")
        why_hot = "；".join(why_hot_parts[:2]) or f"{theme} 是近期高频主题。"

        return HotThemeContext(
            theme=theme,
            heatScore=heat_score,
            whyHot=why_hot,
            conceptMatches=concept_matches,
            candidateStocks=candidate_stocks,
            topNews=news_items,
        )

    def _build_regime_summary(self, macro_snapshot: dict | None) -> MarketRegimeSummary:
        if not macro_snapshot:
            return MarketRegimeSummary(
                overallTone="unknown",
                growthTone="unknown",
                liquidityTone="unknown",
                riskTone="unknown",
                summary="宏观慢变量暂不可用，先参考热点主题与资金方向。",
                drivers=[],
            )

        gdp_yoy = macro_snapshot.get("gdpYoY")
        m2_yoy = macro_snapshot.get("m2YoY")
        sf_month = macro_snapshot.get("socialFinancingIncrement")
        pmi = macro_snapshot.get("manufacturingPmi")

        growth_tone = "unknown"
        if pmi is not None or gdp_yoy is not None:
            if (pmi is not None and pmi >= 50) or (gdp_yoy is not None and gdp_yoy >= 5):
                growth_tone = "expansion"
            elif (pmi is not None and pmi < 50) or (gdp_yoy is not None and gdp_yoy < 4.5):
                growth_tone = "contraction"
            else:
                growth_tone = "neutral"

        liquidity_tone = "unknown"
        if m2_yoy is not None or sf_month is not None:
            if (m2_yoy is not None and m2_yoy >= 8) or (sf_month is not None and sf_month > 0):
                liquidity_tone = "supportive"
            elif m2_yoy is not None and m2_yoy < 7:
                liquidity_tone = "tightening"
            else:
                liquidity_tone = "neutral"

        if growth_tone == "expansion" and liquidity_tone == "supportive":
            overall_tone = "risk_on"
        elif growth_tone == "contraction" and liquidity_tone == "tightening":
            overall_tone = "risk_off"
        else:
            overall_tone = "neutral"

        drivers = []
        if pmi is not None:
            drivers.append(f"制造业 PMI {pmi:.1f}")
        if gdp_yoy is not None:
            drivers.append(f"GDP 同比 {gdp_yoy:.1f}%")
        if m2_yoy is not None:
            drivers.append(f"M2 同比 {m2_yoy:.1f}%")

        if overall_tone == "risk_on":
            summary = "增长和流动性组合偏友好，市场环境更适合优先跟踪高景气主题。"
        elif overall_tone == "risk_off":
            summary = "增长与流动性组合偏弱，市场更适合控制仓位并优先确认防守线索。"
        else:
            summary = "宏观环境偏中性，优先结合热门主题和资金方向做后续分流。"

        return MarketRegimeSummary(
            overallTone=overall_tone,
            growthTone=growth_tone,
            liquidityTone=liquidity_tone,
            riskTone=overall_tone,
            summary=summary,
            drivers=drivers,
        )

    def _build_flow_summary(self, flow_snapshot: dict | None) -> MarketFlowSummary:
        if not flow_snapshot:
            return MarketFlowSummary(
                northboundNetAmount=None,
                direction="unknown",
                summary="北向资金数据暂不可用。",
            )

        northbound = flow_snapshot.get("northboundNetAmount")
        if northbound is None:
            direction = "unknown"
        elif northbound > 0:
            direction = "inflow"
        elif northbound < 0:
            direction = "outflow"
        else:
            direction = "flat"

        if direction == "inflow":
            summary = "北向资金保持净流入，风险偏好边际更友好。"
        elif direction == "outflow":
            summary = "北向资金净流出，短线更适合提高确认阈值。"
        elif direction == "flat":
            summary = "北向资金方向暂不明显。"
        else:
            summary = "北向资金数据暂不可用。"

        return MarketFlowSummary(
            northboundNetAmount=northbound,
            direction=direction,
            summary=summary,
        )

    def _build_downstream_hints(
        self,
        hot_themes: list[HotThemeContext],
        regime: MarketRegimeSummary,
        flow: MarketFlowSummary,
    ) -> MarketContextDownstreamHints:
        top_theme = hot_themes[0].theme if hot_themes else "当前主题"

        return MarketContextDownstreamHints(
            workflows=SectionHint(
                summary=f"优先围绕 {top_theme} 这类高热主题发起行业研究。",
                suggestedQuestion=f"围绕 {top_theme} 产业链，当前景气扩散到哪些环节？",
            ),
            companyResearch=SectionHint(
                summary=f"公司研究优先确认 {top_theme} 主题兑现链条和订单传导。",
            ),
            screening=SectionHint(
                summary="优先从热门主题候选股缩小选股范围，再补估值和质量约束。",
                suggestedDraftName=f"{top_theme} 热门主题候选池",
            ),
            timing=SectionHint(
                summary=(
                    "当前更适合保持进攻型观察。"
                    if regime.riskTone == "risk_on" and flow.direction != "outflow"
                    else "当前更适合提高确认阈值并控制追高。"
                ),
            ),
        )

    def _resolve_status(self, availability: MarketContextAvailability) -> str:
        values = [
            availability.regime.available,
            availability.flow.available,
            availability.hotThemes.available,
        ]
        if all(values):
            return "complete"
        if any(values):
            return "partial"
        return "unavailable"

    def _select_themes(self, limit: int) -> list[str]:
        ranked = self._recorder.top_themes(limit=limit)
        if ranked:
            return ranked[:limit]
        return _default_hot_themes()[:limit]


market_context_gateway = MarketContextGateway()
