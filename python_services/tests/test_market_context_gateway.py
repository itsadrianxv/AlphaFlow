from types import SimpleNamespace

from app.contracts.intelligence import ThemeNewsData, ThemeNewsResponse
from app.contracts.meta import GatewayMeta
from app.data_providers.contracts import HsgtFlowSnapshot, MacroSnapshot
from app.gateway.market_context_gateway import MarketContextGateway


def _meta():
    return GatewayMeta(requestId="req-1", provider="tushare", cacheHit=False, isStale=False, latencyMs=0, asOf="2026-07-24T00:00:00+00:00", warnings=[])


def _board():
    return {
        "theme": "算力概念", "heatScore": 82.0, "whyHot": "THS 概念板块热榜第 1 名。",
        "conceptMatches": [{"name": "算力概念", "code": "885001.TI", "aliases": [], "confidence": 1, "reason": "热榜命中", "source": "tushare:ths_hot"}],
        "candidateStocks": [{"stockCode": "603019", "stockName": "中科曙光", "concept": "算力概念", "reason": "连板池", "heat": 88, "limitType": "连板池", "boardRank": 1}],
        "marketEvidence": {"boardCode": "885001.TI", "tradeDate": "20260724", "rank": 1, "hot": 100, "pctChange": 5, "currentPrice": 1300, "constituentCount": 90, "latestPctChange": 5, "fiveDayPctChange": 12, "latestTurnoverRate": 4, "limitUpCount": 2, "continuationCount": 1, "rushLimitCount": 0, "brokenLimitCount": 0, "limitDownCount": 0},
    }


def _gateway(theme_provider):
    return MarketContextGateway(
        macro_provider=SimpleNamespace(
            get_macro_snapshot=lambda: MacroSnapshot(asOf="2026-07-24T00:00:00+00:00", gdpYoY=5.4, m2YoY=8.3, socialFinancingIncrement=5200.0, manufacturingPmi=50.8),
            get_hsgt_flow_snapshot=lambda: HsgtFlowSnapshot(asOf="2026-07-24T00:00:00+00:00", northboundNetAmount=1762.62, southboundNetAmount=-664.0),
        ),
        intelligence_data_gateway=SimpleNamespace(
            get_theme_news=lambda **kwargs: ThemeNewsResponse(meta=_meta(), data=ThemeNewsData(theme=kwargs["theme"], newsItems=[])),
            get_macro_news=lambda **kwargs: SimpleNamespace(data=SimpleNamespace(newsItems=[])),
        ),
        theme_provider=theme_provider,
    )


def test_market_context_gateway_uses_live_ths_boards_without_snapshot_cache():
    provider = SimpleNamespace(calls=0)
    def get_hot_concept_boards(limit):
        provider.calls += 1
        assert limit == 5
        return [_board()]
    provider.get_hot_concept_boards = get_hot_concept_boards

    response = _gateway(provider).get_snapshot(request_id="req-1")

    assert provider.calls == 1
    assert response.meta.cacheHit is False
    assert response.data.status == "complete"
    assert response.data.hotThemes[0].marketEvidence.boardCode == "885001.TI"
    assert response.data.hotThemes[0].candidateStocks[0].limitType == "连板池"


def test_market_context_marks_hot_themes_unavailable_when_live_ths_request_fails():
    provider = SimpleNamespace(get_hot_concept_boards=lambda limit: (_ for _ in ()).throw(RuntimeError("ths unavailable")))

    response = _gateway(provider).get_snapshot(request_id="req-2")

    assert response.data.status == "partial"
    assert response.data.hotThemes == []
    assert response.data.availability.hotThemes.available is False
    assert "ths unavailable" in (response.data.availability.hotThemes.warning or "")
