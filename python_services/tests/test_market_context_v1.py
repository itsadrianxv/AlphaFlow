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
