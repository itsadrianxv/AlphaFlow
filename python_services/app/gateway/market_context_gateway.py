"""Unified gateway for market context snapshots."""

from __future__ import annotations

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
from app.data_providers import get_default_data_provider
from app.data_providers.contracts import DataProvider, HsgtFlowSnapshot, MacroSnapshot
from app.gateway.common import build_meta, iso_now
from app.gateway.intelligence_gateway import IntelligenceGateway, intelligence_gateway
from app.gateway.market_gateway import MarketGateway, market_gateway
from app.providers.tushare.client import TushareProviderClient


class MarketContextGateway:
    provider_name = "market-context"

    def __init__(
        self,
        macro_provider: DataProvider | None = None,
        intelligence_data_gateway: IntelligenceGateway | None = None,
        market_data_gateway: MarketGateway | None = None,
        theme_provider: TushareProviderClient | None = None,
    ) -> None:
        self._macro_provider = macro_provider or get_default_data_provider()
        self._intelligence_gateway = intelligence_data_gateway or intelligence_gateway
        self._market_gateway = market_data_gateway or market_gateway
        self._theme_provider = theme_provider or TushareProviderClient()

    def get_snapshot(
        self,
        request_id: str,
        force_refresh: bool = False,
    ) -> MarketContextSnapshotResponse:
        started_at = time.perf_counter()
        # 热点概念板块必须是当次实时 TuShare 结果，禁止快照或过期缓存回退。
        snapshot = self._build_snapshot()

        return MarketContextSnapshotResponse(
            meta=build_meta(
                request_id=request_id,
                provider=self.provider_name,
                started_at=started_at,
                cache_hit=False,
                is_stale=False,
                warnings=[],
                as_of=snapshot.asOf,
            ),
            data=snapshot,
        )

    def _build_snapshot(self) -> MarketContextSnapshot:
        availability = MarketContextAvailability(
            regime=MarketContextAvailabilityEntry(available=True),
            flow=MarketContextAvailabilityEntry(available=True),
            hotThemes=MarketContextAvailabilityEntry(available=True),
        )

        as_of_candidates = [iso_now()]

        macro_snapshot = None
        try:
            macro_snapshot = self._macro_provider.get_macro_snapshot()
            as_of_candidates.append(str(macro_snapshot.asOf or ""))
        except Exception as exc:  # noqa: BLE001
            availability.regime = MarketContextAvailabilityEntry(
                available=False,
                warning=f"macro snapshot unavailable: {exc}",
            )

        flow_snapshot = None
        try:
            flow_snapshot = self._macro_provider.get_hsgt_flow_snapshot()
            as_of_candidates.append(str(flow_snapshot.asOf or ""))
        except Exception as exc:  # noqa: BLE001
            availability.flow = MarketContextAvailabilityEntry(
                available=False,
                warning=f"hsgt flow unavailable: {exc}",
            )

        hot_themes: list[HotThemeContext] = []
        try:
            hot_themes = self._build_hot_themes()
        except Exception as exc:  # noqa: BLE001
            availability.hotThemes = MarketContextAvailabilityEntry(
                available=False,
                warning=f"THS hot concept boards unavailable: {exc}",
            )
        if not hot_themes:
            availability.hotThemes = MarketContextAvailabilityEntry(
                available=False,
                warning=availability.hotThemes.warning or "no hot themes available",
            )

        regime = self._build_regime_summary(macro_snapshot)
        flow = self._build_flow_summary(flow_snapshot)
        status = self._resolve_status(availability)
        try:
            macro_news = self._intelligence_gateway.get_macro_news(
                request_id="market-context:macro:news", days=7, limit=5
            ).data.newsItems
        except Exception:  # noqa: BLE001
            macro_news = []

        return MarketContextSnapshot(
            asOf=max(as_of_candidates),
            status=status,
            regime=regime,
            flow=flow,
            macroNews=macro_news,
            hotThemes=hot_themes,
            downstreamHints=self._build_downstream_hints(
                hot_themes=hot_themes,
                regime=regime,
                flow=flow,
            ),
            availability=availability,
        )

    def _build_hot_themes(self) -> list[HotThemeContext]:
        boards = self._theme_provider.get_hot_concept_boards(limit=5)
        result: list[HotThemeContext] = []
        for board in boards:
            try:
                news_items = self._intelligence_gateway.get_theme_news(
                    request_id=f"market-context:{board['theme']}:news",
                    theme=board["theme"], days=7, limit=5,
                ).data.newsItems
            except Exception:  # noqa: BLE001
                news_items = []
            result.append(HotThemeContext(**board, topNews=news_items))
        return result

    def _build_regime_summary(self, macro_snapshot: MacroSnapshot | None) -> MarketRegimeSummary:
        if not macro_snapshot:
            return MarketRegimeSummary(
                overallTone="unknown",
                growthTone="unknown",
                liquidityTone="unknown",
                riskTone="unknown",
                summary="宏观慢变量暂不可用，先参考热点主题与资金方向。",
                drivers=[],
            )

        gdp_yoy = macro_snapshot.gdpYoY
        m2_yoy = macro_snapshot.m2YoY
        sf_month = macro_snapshot.socialFinancingIncrement
        pmi = macro_snapshot.manufacturingPmi

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

    def _build_flow_summary(self, flow_snapshot: HsgtFlowSnapshot | None) -> MarketFlowSummary:
        if not flow_snapshot:
            return MarketFlowSummary(
                northboundNetAmount=None,
                direction="unknown",
                summary="北向资金数据暂不可用。",
            )

        northbound = flow_snapshot.northboundNetAmount
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
                summary=f"优先围绕 {top_theme} 拆解产业链景气扩散和受益环节。",
                suggestedQuestion=f"围绕 {top_theme} 产业链，当前景气扩散到哪些环节？",
            ),
            companyResearch=SectionHint(
                summary=f"优先挑选 {top_theme} 相关公司，验证订单、业绩和估值兑现路径。",
            ),
            screening=SectionHint(
                summary=f"优先从 {top_theme} 相关候选股开始缩小观察范围。",
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

market_context_gateway = MarketContextGateway()
