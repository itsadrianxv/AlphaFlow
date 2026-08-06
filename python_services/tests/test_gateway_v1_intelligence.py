from unittest.mock import patch

from fastapi.testclient import TestClient

from app.contracts.intelligence import CompanyEvidence, CompanyResearchPack
from app.contracts.market import ThemeCandidate
from app.gateway.common import build_cache_key, gateway_cache
from app.main import app
from app.policies.cache_policy import CachePolicy

client = TestClient(app)


def setup_function() -> None:
    gateway_cache.clear()


def _stale_policy() -> CachePolicy:
    return CachePolicy(fresh_ttl_seconds=0, stale_ttl_seconds=120)


def test_get_v1_stock_evidence_batch_success():
    def fake_get_stock_evidence(*args, **kwargs):
        stock_code = kwargs.get("stock_code") or args[-2]
        concept = kwargs.get("concept")
        return {
            "stockCode": stock_code,
            "companyName": f"Company {stock_code}",
            "concept": concept or "AI",
            "evidenceSummary": "Test evidence summary",
            "catalysts": [],
            "risks": [],
            "credibilityScore": 70,
            "updatedAt": "2026-03-10T08:00:00+00:00",
        }

    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_evidence",
        side_effect=fake_get_stock_evidence,
    ):
        response = client.post(
            "/api/v1/intelligence/stocks/evidence/batch",
            json={"stockCodes": ["603019", "300308"], "concept": "AI"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["data"]["items"]) == 2
    assert payload["data"]["errors"] == []


def test_get_v1_stock_evidence_batch_fetches_stocks_concurrently():
    import threading
    import time

    active_calls = 0
    max_active_calls = 0
    lock = threading.Lock()

    def fake_get_stock_evidence(*args, **kwargs):
        nonlocal active_calls, max_active_calls
        stock_code = kwargs.get("stock_code") or args[-2]
        concept = kwargs.get("concept")
        with lock:
            active_calls += 1
            max_active_calls = max(max_active_calls, active_calls)

        time.sleep(0.05)

        with lock:
            active_calls -= 1

        return {
            "stockCode": stock_code,
            "companyName": f"Company {stock_code}",
            "concept": concept or "AI",
            "evidenceSummary": "Test evidence summary",
            "catalysts": [],
            "risks": [],
            "credibilityScore": 70,
            "updatedAt": "2026-03-10T08:00:00+00:00",
        }

    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_evidence",
        side_effect=fake_get_stock_evidence,
    ):
        response = client.post(
            "/api/v1/intelligence/stocks/evidence/batch",
            json={
                "stockCodes": ["603019", "300308", "002230"],
                "concept": "AI",
            },
        )

    assert response.status_code == 200
    assert max_active_calls >= 2


def test_intelligence_gateway_uses_minishare_news_provider():
    with patch(
        "app.gateway.intelligence_gateway.MinishareNewsProvider.get_news_result",
        return_value=__import__(
            "app.providers.minishare.news", fromlist=["NewsRetrievalResult"]
        ).NewsRetrievalResult(items=[]),
    ):
        response = client.get("/api/v1/intelligence/themes/AI/news")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["cacheHit"] is False
    assert payload["meta"]["isStale"] is False
    assert payload["data"]["theme"] == "AI"
    assert payload["data"]["newsItems"] == []
    assert payload["meta"]["provider"] == "minishare"
    assert payload["meta"]["warnings"] == []


def test_intelligence_gateway_accepts_theme_with_slash():
    with patch(
        "app.gateway.intelligence_gateway.MinishareNewsProvider.get_news_result",
        return_value=__import__(
            "app.providers.minishare.news", fromlist=["NewsRetrievalResult"]
        ).NewsRetrievalResult(items=[]),
    ):
        response = client.get("/api/v1/intelligence/themes/GPU%2FASIC/news")

    assert response.status_code == 200
    assert response.json()["data"]["theme"] == "GPU/ASIC"


def test_v1_news_radar_returns_standardized_items():
    result_type = __import__(
        "app.providers.minishare.news", fromlist=["NewsRetrievalResult"]
    ).NewsRetrievalResult
    with patch(
        "app.gateway.intelligence_gateway.MinishareNewsProvider.get_radar",
        return_value=result_type(
            items=[
                {
                    "id": "event-1",
                    "title": "算力资本开支扩大",
                    "summary": "行业扩产",
                    "content": "完整正文",
                    "source": "minishare:major",
                    "sourceKind": "major",
                    "publishedAt": "2026-07-24T10:00:00+08:00",
                    "sentiment": "positive",
                    "relevanceScore": 0.9,
                    "relatedStocks": ["603019"],
                    "scopeTags": ["industry"],
                    "analysisStatus": "complete",
                }
            ]
        ),
    ):
        response = client.post(
            "/api/v1/intelligence/news/radar",
            json={
                "days": 7,
                "limit": 10,
                "companies": [
                    {"stockCode": "603019", "companyName": "中科曙光"}
                ],
                "industries": [{"name": "算力"}],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["companyCount"] == 1
    assert payload["data"]["newsItems"][0]["content"] == "完整正文"


def test_v1_news_radar_resolve_forwards_end_at():
    result_type = __import__(
        "app.providers.minishare.news", fromlist=["NewsRetrievalResult"]
    ).NewsRetrievalResult
    with patch(
        "app.gateway.intelligence_gateway.MinishareNewsProvider.resolve_radar",
        return_value=result_type(items=[]),
    ) as resolve_radar:
        response = client.post(
            "/api/v1/intelligence/news/radar/resolve",
            json={
                "days": 30,
                "limit": 10,
                "endAt": "2026-07-24T12:00:00+08:00",
                "companies": [
                    {"stockCode": "603019", "companyName": "中科曙光"}
                ],
                "industries": [{"name": "算力"}],
                "rawItems": [],
            },
        )

    assert response.status_code == 200
    assert (
        resolve_radar.call_args.kwargs["end_at"].isoformat()
        == "2026-07-24T12:00:00+08:00"
    )


def test_v1_theme_concepts_returns_stale_cache_when_provider_fails():
    cache_key = build_cache_key(
        dataset="theme_concepts",
        provider="tushare",
        params={"theme": "AI", "limit": 5},
    )
    gateway_cache.set(
        key=cache_key,
        value={
            "theme": "AI",
            "matchedBy": "auto",
            "concepts": [
                {
                    "name": "AI compute",
                    "code": "BK001",
                    "aliases": [],
                    "confidence": 0.88,
                    "reason": "cached",
                    "source": "auto",
                }
            ],
        },
        policy=_stale_policy(),
        as_of="2026-03-01T08:00:00+00:00",
    )

    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_theme_concepts",
        side_effect=Exception("provider down"),
    ):
        response = client.get("/api/v1/intelligence/themes/AI/concepts")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["cacheHit"] is True
    assert payload["meta"]["isStale"] is True
    assert payload["data"]["conceptMatches"][0]["name"] == "AI compute"
    assert payload["meta"]["warnings"][0]["code"] == "stale_cache"


def test_v1_theme_candidates_returns_stale_cache_when_provider_fails():
    cache_key = build_cache_key(
        dataset="theme_candidates",
        provider="tushare",
        params={"theme": "AI", "limit": 6},
    )
    gateway_cache.set(
        key=cache_key,
        value=[
            ThemeCandidate(
                stockCode="603019",
                stockName="中科曙光",
                concept="AI compute",
                reason="cached",
                heat=86.0,
            )
        ],
        policy=_stale_policy(),
        as_of="2026-03-01T08:00:00+00:00",
    )

    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_theme_candidates",
        side_effect=Exception("provider down"),
    ):
        response = client.get("/api/v1/market/themes/AI/candidates")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["cacheHit"] is True
    assert payload["meta"]["isStale"] is True
    assert payload["data"]["candidates"][0]["stockCode"] == "603019"


def test_v1_stock_evidence_exposes_partial_data_quality():
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_evidence",
        return_value={
            "stockCode": "603019",
            "companyName": "中科曙光",
            "concept": "AI",
            "evidenceSummary": "partial evidence",
            "catalysts": [],
            "risks": [],
            "credibilityScore": 68,
            "dataQuality": "partial",
            "warnings": ["spot_snapshot_partial"],
            "updatedAt": "2026-03-10T08:00:00+00:00",
        },
    ):
        response = client.get("/api/v1/intelligence/stocks/603019/evidence?concept=AI")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["evidence"]["dataQuality"] == "partial"
    assert payload["data"]["evidence"]["warnings"] == ["spot_snapshot_partial"]


def test_v1_stock_research_pack_exposes_partial_data_quality():
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_research_pack",
        return_value={
            "stockCode": "603019",
            "companyName": "中科曙光",
            "concept": "AI",
            "financialHighlights": [],
            "referenceItems": [],
            "summaryNotes": ["partial pack"],
            "dataQuality": "partial",
            "warnings": ["spot_snapshot_partial"],
        },
    ):
        response = client.get("/api/v1/intelligence/stocks/603019/research-pack?concept=AI")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["researchPack"]["dataQuality"] == "partial"
    assert payload["data"]["researchPack"]["warnings"] == ["spot_snapshot_partial"]


def test_v1_stock_evidence_returns_stale_cache_when_provider_fails():
    cache_key = build_cache_key(
        dataset="company_evidence",
        provider="tushare",
        params={"stockCode": "603019", "concept": "AI"},
    )
    gateway_cache.set(
        key=cache_key,
        value=CompanyEvidence(
            stockCode="603019",
            companyName="中科曙光",
            concept="AI",
            evidenceSummary="cached evidence",
            catalysts=[],
            risks=[],
            credibilityScore=72,
            dataQuality="partial",
            warnings=["spot_snapshot_partial"],
            updatedAt="2026-03-01T08:00:00+00:00",
        ),
        policy=_stale_policy(),
        as_of="2026-03-01T08:00:00+00:00",
    )

    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_evidence",
        side_effect=Exception("provider down"),
    ):
        response = client.get("/api/v1/intelligence/stocks/603019/evidence?concept=AI")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["cacheHit"] is True
    assert payload["meta"]["isStale"] is True
    assert payload["data"]["evidence"]["companyName"] == "中科曙光"


def test_v1_stock_research_pack_returns_stale_cache_when_provider_fails():
    cache_key = build_cache_key(
        dataset="company_research_pack",
        provider="tushare",
        params={"stockCode": "603019", "concept": "AI"},
    )
    gateway_cache.set(
        key=cache_key,
        value=CompanyResearchPack(
            stockCode="603019",
            companyName="中科曙光",
            concept="AI",
            financialHighlights=["cached highlight"],
            referenceItems=[],
            summaryNotes=["cached summary"],
            dataQuality="partial",
            warnings=["spot_snapshot_partial"],
        ),
        policy=_stale_policy(),
        as_of="2026-03-01T08:00:00+00:00",
    )

    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_research_pack",
        side_effect=Exception("provider down"),
    ):
        response = client.get("/api/v1/intelligence/stocks/603019/research-pack?concept=AI")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["cacheHit"] is True
    assert payload["meta"]["isStale"] is True
    assert payload["data"]["researchPack"]["financialHighlights"] == ["cached highlight"]

