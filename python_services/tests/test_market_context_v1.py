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


def build_payload():
    return MarketContextSnapshotResponse(
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
                summary="macro constructive",
                drivers=["PMI > 50"],
            ),
            flow=MarketFlowSummary(
                northboundNetAmount=1762.62,
                direction="inflow",
                summary="northbound inflow",
            ),
            hotThemes=[
                HotThemeContext(
                    theme="AI",
                    heatScore=84,
                    whyHot="catalyst cluster",
                    conceptMatches=[],
                    candidateStocks=[],
                    topNews=[],
                )
            ],
            downstreamHints=MarketContextDownstreamHints(
                workflows=SectionHint(
                    summary="workflow summary",
                    suggestedQuestion="question",
                ),
                companyResearch=SectionHint(summary="company summary"),
                screening=SectionHint(
                    summary="screening summary",
                    suggestedDraftName="AI pool",
                ),
                timing=SectionHint(summary="timing summary"),
            ),
            availability=MarketContextAvailability(
                regime=MarketContextAvailabilityEntry(available=True),
                flow=MarketContextAvailabilityEntry(available=True),
                hotThemes=MarketContextAvailabilityEntry(available=True),
            ),
        ),
    )


def test_get_market_context_snapshot_v1_success():
    with patch(
        "app.routers.market_context_v1.market_context_gateway.get_snapshot",
        return_value=build_payload(),
    ):
        response = client.get("/api/v1/market-context/snapshot")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["status"] == "complete"
    assert body["data"]["hotThemes"][0]["theme"] == "AI"
    assert body["data"]["downstreamHints"]["screening"]["suggestedDraftName"] == "AI pool"


def test_get_market_context_snapshot_v1_supports_force_refresh_query_param():
    with patch(
        "app.routers.market_context_v1.market_context_gateway.get_snapshot",
        return_value=build_payload(),
    ) as get_snapshot:
        response = client.get(
            "/api/v1/market-context/snapshot",
            params={"forceRefresh": "true"},
        )

    assert response.status_code == 200
    get_snapshot.assert_called_once()
    assert get_snapshot.call_args.kwargs["force_refresh"] is True


def test_get_market_context_snapshot_v1_forwards_theme_limit():
    with patch(
        "app.routers.market_context_v1.market_context_gateway.get_snapshot",
        return_value=build_payload(),
    ) as get_snapshot:
        response = client.get(
            "/api/v1/market-context/snapshot",
            params={"themeLimit": "6"},
        )

    assert response.status_code == 200
    get_snapshot.assert_called_once()
    assert get_snapshot.call_args.kwargs["theme_limit"] == 6
