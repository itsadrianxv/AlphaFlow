from unittest.mock import patch

from fastapi.testclient import TestClient

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
from app.contracts.meta import GatewayMeta
from app.main import app

client = TestClient(app)


def test_get_market_context_snapshot_v1_success():
    payload = MarketContextSnapshotResponse(
        meta=GatewayMeta(
            requestId="req-1",
            provider="market-context",
            cacheHit=False,
            isStale=False,
            latencyMs=0,
            asOf="2026-04-18T00:00:00+00:00",
            warnings=[],
        ),
        data=MarketContextSnapshot(
            asOf="2026-04-18T00:00:00+00:00",
            status="complete",
            regime=MarketRegimeSummary(
                overallTone="risk_on",
                growthTone="expansion",
                liquidityTone="supportive",
                riskTone="risk_on",
                summary="制造业景气回到扩张区间。",
                drivers=["PMI 回到 50 上方"],
            ),
            flow=MarketFlowSummary(
                northboundNetAmount=1762.62,
                direction="inflow",
                summary="北向资金净流入。",
            ),
            hotThemes=[
                HotThemeContext(
                    theme="AI",
                    heatScore=84,
                    whyHot="催化集中。",
                    marketEvidence={
                        "boardCode": "885001.TI",
                        "tradeDate": "20260418",
                        "rank": 1,
                        "constituentCount": 10,
                        "limitUpCount": 0,
                        "continuationCount": 0,
                        "rushLimitCount": 0,
                        "brokenLimitCount": 0,
                        "limitDownCount": 0,
                    },
                    conceptMatches=[],
                    candidateStocks=[],
                    topNews=[],
                )
            ],
            downstreamHints=MarketContextDownstreamHints(
                workflows=SectionHint(
                    summary="优先研究高景气主题。",
                    suggestedQuestion="围绕 AI 产业链，当前景气扩散到哪些环节？",
                ),
                companyResearch=SectionHint(summary="优先确认主题兑现路径。"),
                screening=SectionHint(
                    summary="优先从热门主题候选股开始缩小范围。",
                    suggestedDraftName="AI 热门主题候选池",
                ),
                timing=SectionHint(summary="风险偏好偏强，可保持进攻型观察。"),
            ),
            availability=MarketContextAvailability(
                regime=MarketContextAvailabilityEntry(available=True),
                flow=MarketContextAvailabilityEntry(available=True),
                hotThemes=MarketContextAvailabilityEntry(available=True),
            ),
        ),
    )

    with patch(
        "app.routers.market_context_v1.market_context_gateway.get_snapshot",
        return_value=payload,
    ):
        response = client.get("/api/v1/market-context/snapshot")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["status"] == "complete"
    assert body["data"]["hotThemes"][0]["theme"] == "AI"
    assert body["data"]["downstreamHints"]["screening"]["suggestedDraftName"] == "AI 热门主题候选池"


def test_get_market_context_snapshot_v1_forwards_force_refresh():
    payload = MarketContextSnapshotResponse(
        meta=GatewayMeta(
            requestId="req-1",
            provider="market-context",
            cacheHit=False,
            isStale=False,
            latencyMs=0,
            asOf="2026-04-18T00:00:00+00:00",
            warnings=[],
        ),
        data=MarketContextSnapshot(
            asOf="2026-04-18T00:00:00+00:00",
            status="partial",
            regime=MarketRegimeSummary(
                overallTone="unknown",
                growthTone="unknown",
                liquidityTone="unknown",
                riskTone="unknown",
                summary="宏观数据暂不可用。",
                drivers=[],
            ),
            flow=MarketFlowSummary(
                northboundNetAmount=None,
                direction="unknown",
                summary="资金数据暂不可用。",
            ),
            hotThemes=[],
            downstreamHints=MarketContextDownstreamHints(
                workflows=SectionHint(summary="行业研究摘要。"),
                companyResearch=SectionHint(summary="公司研究摘要。"),
                screening=SectionHint(summary="筛选摘要。"),
                timing=SectionHint(summary="择时摘要。"),
            ),
            availability=MarketContextAvailability(
                regime=MarketContextAvailabilityEntry(available=False),
                flow=MarketContextAvailabilityEntry(available=False),
                hotThemes=MarketContextAvailabilityEntry(available=False),
            ),
        ),
    )

    with patch(
        "app.routers.market_context_v1.market_context_gateway.get_snapshot",
        return_value=payload,
    ) as get_snapshot:
        response = client.get("/api/v1/market-context/snapshot?forceRefresh=true")

    assert response.status_code == 200
    get_snapshot.assert_called_once()
    assert get_snapshot.call_args.kwargs["force_refresh"] is True
