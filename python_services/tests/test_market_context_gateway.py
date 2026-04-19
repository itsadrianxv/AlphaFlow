from types import SimpleNamespace

from app.contracts.intelligence import ThemeConceptsData, ThemeConceptsResponse, ThemeNewsData, ThemeNewsItem, ThemeNewsResponse
from app.contracts.market import ThemeCandidate, ThemeCandidatesData, ThemeCandidatesResponse
from app.contracts.meta import GatewayMeta
from app.gateway.market_context_gateway import MarketContextGateway
from app.infrastructure.metrics.recorder import MetricsRecorder


def _meta():
    return GatewayMeta(
        requestId="req-1",
        provider="akshare",
        cacheHit=False,
        isStale=False,
        latencyMs=0,
        asOf="2026-04-18T00:00:00+00:00",
        warnings=[],
    )


def _theme_news(theme: str, title: str, sentiment: str, score: float):
    return ThemeNewsResponse(
        meta=_meta(),
        data=ThemeNewsData(
            theme=theme,
            newsItems=[
                ThemeNewsItem(
                    id=f"{theme}-news-1",
                    title=title,
                    summary=f"{theme} summary",
                    source="akshare",
                    publishedAt="2026-04-18T00:00:00+00:00",
                    sentiment=sentiment,
                    relevanceScore=score,
                    relatedStocks=["603019"],
                )
            ],
        ),
    )


def _theme_candidates(theme: str):
    return ThemeCandidatesResponse(
        meta=_meta(),
        data=ThemeCandidatesData(
            theme=theme,
            candidates=[
                ThemeCandidate(
                    stockCode="603019",
                    stockName="中科曙光",
                    concept=theme,
                    reason=f"{theme} candidate",
                    heat=81,
                )
            ],
        ),
    )


def _theme_concepts(theme: str):
    return ThemeConceptsResponse(
        meta=_meta(),
        data=ThemeConceptsData(
            theme=theme,
            matchedBy="auto",
            conceptMatches=[
                {
                    "name": theme,
                    "code": None,
                    "aliases": [],
                    "confidence": 0.88,
                    "reason": "matched",
                    "source": "auto",
                }
            ],
        ),
    )


def test_market_context_gateway_builds_snapshot_from_macro_flow_and_hot_themes():
    recorder = MetricsRecorder()
    recorder.record_theme_request(dataset="theme_news", theme="AI")
    recorder.record_theme_request(dataset="theme_news", theme="机器人")
    recorder.record_theme_request(dataset="theme_news", theme="AI")

    gateway = MarketContextGateway(
        macro_provider=SimpleNamespace(
            get_macro_snapshot=lambda: {
                "asOf": "2026-04-18T00:00:00+00:00",
                "gdpYoY": 5.4,
                "m2YoY": 8.3,
                "socialFinancingIncrement": 5200.0,
                "manufacturingPmi": 50.8,
            },
            get_hsgt_flow_snapshot=lambda: {
                "asOf": "2026-04-18T00:00:00+00:00",
                "northboundNetAmount": 1762.62,
                "southboundNetAmount": -664.0,
            },
        ),
        intelligence_data_gateway=SimpleNamespace(
            get_theme_news=lambda **kwargs: _theme_news(
                kwargs["theme"],
                f'{kwargs["theme"]} 景气提升',
                "positive",
                0.82,
            ),
            get_theme_concepts=lambda **kwargs: _theme_concepts(kwargs["theme"]),
        ),
        market_data_gateway=SimpleNamespace(
            get_theme_candidates=lambda **kwargs: _theme_candidates(kwargs["theme"]),
        ),
        recorder=recorder,
    )

    response = gateway.get_snapshot(request_id="req-1")

    assert response.data.status == "complete"
    assert response.data.regime.overallTone == "risk_on"
    assert response.data.flow.direction == "inflow"
    assert response.data.hotThemes[0].theme == "AI"
    assert response.data.hotThemes[0].candidateStocks[0].stockCode == "603019"
    assert response.data.downstreamHints.workflows.suggestedQuestion.startswith(
        "围绕 AI"
    )
    assert response.data.availability.regime.available is True
    assert response.data.availability.flow.available is True
    assert response.data.availability.hotThemes.available is True


def test_market_context_gateway_marks_partial_when_macro_snapshot_is_unavailable():
    gateway = MarketContextGateway(
        macro_provider=SimpleNamespace(
            get_macro_snapshot=lambda: (_ for _ in ()).throw(RuntimeError("macro unavailable")),
            get_hsgt_flow_snapshot=lambda: {
                "asOf": "2026-04-18T00:00:00+00:00",
                "northboundNetAmount": -300.0,
                "southboundNetAmount": 100.0,
            },
        ),
        intelligence_data_gateway=SimpleNamespace(
            get_theme_news=lambda **kwargs: _theme_news(
                kwargs["theme"],
                f'{kwargs["theme"]} 催化',
                "neutral",
                0.71,
            ),
            get_theme_concepts=lambda **kwargs: _theme_concepts(kwargs["theme"]),
        ),
        market_data_gateway=SimpleNamespace(
            get_theme_candidates=lambda **kwargs: _theme_candidates(kwargs["theme"]),
        ),
        recorder=MetricsRecorder(),
    )

    response = gateway.get_snapshot(request_id="req-2")

    assert response.data.status == "partial"
    assert response.data.availability.regime.available is False
    assert response.data.availability.regime.warning is not None
    assert response.data.availability.flow.available is True
    assert response.data.availability.hotThemes.available is True
