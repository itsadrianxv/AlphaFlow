"""Tests for gateway jobs, layered cache integration, and admin job routes."""

from __future__ import annotations

from fnmatch import fnmatch
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.contracts.admin import JobExecutionSummary
from app.gateway.common import build_cache_key, gateway_cache
from app.infrastructure.cache.layered_cache import LayeredCache
from app.infrastructure.cache.memory_cache import MemoryCache
from app.infrastructure.cache.redis_cache import RedisCache
from app.infrastructure.metrics.recorder import metrics_recorder
from app.jobs.prewarm_hot_themes import PrewarmHotThemesJob
from app.jobs.refresh_concepts import RefreshConceptsJob
from app.jobs.refresh_universe import RefreshUniverseJob
from app.main import app
from app.policies.cache_policy import CachePolicy

client = TestClient(app)


class FakeRedisClient:
    def __init__(self) -> None:
        self._store: dict[str, bytes] = {}

    def get(self, key: str):
        return self._store.get(key)

    def set(self, key: str, value: bytes, ex: int | None = None) -> None:
        self._store[key] = value

    def delete(self, *keys: str) -> int:
        deleted = 0
        for key in keys:
            if key in self._store:
                deleted += 1
                del self._store[key]
        return deleted

    def scan_iter(self, match: str | None = None):
        for key in list(self._store.keys()):
            if match is None or fnmatch(key, match):
                yield key


class FakeUniverseProvider:
    provider_name = "tushare"

    def get_stock_universe(self) -> list[dict]:
        return [
            {
                "code": "600519",
                "name": "贵州茅台",
                "industry": "白酒",
                "marketCap": 21000.0,
                "floatMarketCap": 20500.0,
                "pe": 35.5,
                "pb": 10.2,
                "roe": 0.28,
                "turnoverRate": 1.2,
                "changePercent": 2.3,
                "dataDate": "2026-03-08",
            },
            {
                "code": "000001",
                "name": "平安银行",
                "industry": "银行",
                "marketCap": 2900.0,
                "floatMarketCap": 2800.0,
                "pe": 6.5,
                "pb": 0.7,
                "roe": 0.11,
                "turnoverRate": 0.9,
                "changePercent": 0.8,
                "dataDate": "2026-03-08",
            },
        ]


class FakeMarketGateway:
    def __init__(self) -> None:
        self.requested_themes: list[str] = []

    def get_theme_candidates(self, request_id: str, theme: str, limit: int):
        self.requested_themes.append(theme)
        candidates = [SimpleNamespace(stockCode="600519", concept=theme)]
        return SimpleNamespace(data=SimpleNamespace(candidates=candidates))


class FakeIntelligenceGateway:
    def __init__(self) -> None:
        self.news_themes: list[str] = []
        self.concept_themes: list[str] = []
        self.evidence_calls: list[tuple[str, str]] = []
        self.research_pack_calls: list[tuple[str, str]] = []

    def get_theme_news(self, request_id: str, theme: str, days: int, limit: int):
        self.news_themes.append(theme)
        return None

    def get_theme_concepts(self, request_id: str, theme: str, limit: int):
        self.concept_themes.append(theme)
        return None

    def get_stock_evidence(self, request_id: str, stock_code: str, concept: str | None):
        self.evidence_calls.append((stock_code, concept or ""))
        return None

    def get_stock_research_pack(self, request_id: str, stock_code: str, concept: str | None):
        self.research_pack_calls.append((stock_code, concept or ""))
        return None


class FakeConceptProvider:
    provider_name = "tushare"

    def get_concept_catalog(self) -> list[dict]:
        return [
            {"conceptName": "AI算力", "conceptCode": "BK001"},
            {"conceptName": "液冷服务器", "conceptCode": "BK002"},
            {"conceptName": "失败概念", "conceptCode": "BK003"},
        ]

    def get_concept_constituents(self, concept_name: str, concept_code: str | None = None) -> list[dict]:
        if concept_name == "失败概念":
            raise RuntimeError("upstream down")
        return [{"conceptName": concept_name, "stockCode": "603019", "stockName": "中科曙光"}]


def setup_function() -> None:
    gateway_cache.clear()
    metrics_recorder.clear()


def test_layered_cache_reads_from_redis_and_backfills_l1() -> None:
    l1_cache = MemoryCache()
    l2_cache = RedisCache(client=FakeRedisClient(), prefix="test-cache")
    layered_cache = LayeredCache(l1_cache=l1_cache, l2_cache=l2_cache)

    l2_cache.set(
        "sample-key",
        {"theme": "AI"},
        CachePolicy(fresh_ttl_seconds=30, stale_ttl_seconds=120),
        as_of="2026-03-08T08:00:00+00:00",
    )

    assert l1_cache.get("sample-key") is None

    entry = layered_cache.get("sample-key")

    assert entry is not None
    assert entry.value == {"theme": "AI"}
    assert l1_cache.get("sample-key") is not None


def test_refresh_universe_job_warms_snapshot_cache() -> None:
    summary = RefreshUniverseJob(provider_client=FakeUniverseProvider()).run(batch_size=1)

    assert summary.job == "refresh-universe"
    assert summary.stats["stockCount"] == 2
    assert summary.stats["snapshotCacheWrites"] == 2

    cache_key = build_cache_key(
        dataset="stock_snapshot",
        provider="tushare",
        params={"stockCode": "600519"},
    )
    entry = gateway_cache.get(cache_key)
    assert entry is not None
    assert entry.value.stockCode == "600519"

    metrics = metrics_recorder.snapshot()
    assert "batch_success_ratio" in metrics["observations"]
    assert metrics["observations"]["batch_success_ratio"][0]["avg"] == 1.0


def test_prewarm_hot_themes_uses_recorded_hot_themes() -> None:
    metrics_recorder.record_theme_request(dataset="theme_news", theme="算力")
    metrics_recorder.record_theme_request(dataset="theme_candidates", theme="算力")
    metrics_recorder.record_theme_request(dataset="theme_news", theme="AI")

    fake_market_gateway = FakeMarketGateway()
    fake_intelligence_gateway = FakeIntelligenceGateway()
    summary = PrewarmHotThemesJob(
        market_data_gateway=fake_market_gateway,
        intelligence_data_gateway=fake_intelligence_gateway,
        recorder=metrics_recorder,
    ).run(max_themes=1, evidence_per_theme=1)

    assert summary.job == "prewarm-hot-themes"
    assert summary.stats["themes"] == ["算力"]
    assert fake_market_gateway.requested_themes == ["算力"]
    assert fake_intelligence_gateway.news_themes == ["算力"]
    assert fake_intelligence_gateway.concept_themes == ["算力"]
    assert fake_intelligence_gateway.evidence_calls == [("600519", "算力")]
    assert fake_intelligence_gateway.research_pack_calls == [("600519", "算力")]
    assert summary.stats["warmedResearchPacks"] == 1


def test_prewarm_hot_themes_skips_when_no_themes_are_available() -> None:
    fake_market_gateway = FakeMarketGateway()
    fake_intelligence_gateway = FakeIntelligenceGateway()

    summary = PrewarmHotThemesJob(
        market_data_gateway=fake_market_gateway,
        intelligence_data_gateway=fake_intelligence_gateway,
        recorder=metrics_recorder,
    ).run(max_themes=5, evidence_per_theme=1)

    assert summary.job == "prewarm-hot-themes"
    assert summary.stats["themes"] == []
    assert summary.stats["warmedNews"] == 0
    assert summary.stats["warmedCandidates"] == 0
    assert summary.stats["warmedConcepts"] == 0
    assert summary.stats["warmedEvidence"] == 0
    assert summary.stats["warmedResearchPacks"] == 0
    assert fake_market_gateway.requested_themes == []
    assert fake_intelligence_gateway.news_themes == []
    assert fake_intelligence_gateway.concept_themes == []
    assert fake_intelligence_gateway.evidence_calls == []
    assert fake_intelligence_gateway.research_pack_calls == []


def test_prewarm_hot_themes_prefers_explicit_themes() -> None:
    fake_market_gateway = FakeMarketGateway()
    fake_intelligence_gateway = FakeIntelligenceGateway()

    summary = PrewarmHotThemesJob(
        market_data_gateway=fake_market_gateway,
        intelligence_data_gateway=fake_intelligence_gateway,
        recorder=metrics_recorder,
    ).run(themes=["  机器人  ", "AI"], max_themes=1, evidence_per_theme=1)

    assert summary.stats["themes"] == ["机器人"]
    assert fake_market_gateway.requested_themes == ["机器人"]
    assert fake_intelligence_gateway.news_themes == ["机器人"]


def test_refresh_concepts_job_tracks_batches_and_failures() -> None:
    summary = RefreshConceptsJob(provider_client=FakeConceptProvider()).run(batch_size=2)

    assert summary.job == "refresh-concepts"
    assert summary.status == "completed"
    assert summary.stats["conceptCount"] == 3
    assert summary.stats["batchSize"] == 2
    assert summary.stats["processedBatches"] == 2
    assert summary.stats["constituentCacheWrites"] == 2
    assert summary.stats["failureCount"] == 1
    assert summary.stats["failedConcepts"] == ["失败概念"]


def test_refresh_concepts_endpoint_returns_queued_and_triggers_background_task() -> None:
    background_calls: list[dict] = []

    def fake_enqueue(self, limit=None, batch_size=20):
        return (
            JobExecutionSummary(
                job="refresh-concepts",
                status="queued",
                startedAt="2026-03-08T08:00:00+00:00",
                finishedAt="2026-03-08T08:00:01+00:00",
                stats={
                    "requestedLimit": limit,
                    "scheduledConceptCount": 1,
                    "batchSize": batch_size,
                },
            ),
            [{"conceptName": "AI算力", "conceptCode": "BK001"}],
            "2026-03-08T08:00:01+00:00",
        )

    def fake_background(self, catalog, *, as_of, batch_size):
        background_calls.append(
            {"catalog": catalog, "as_of": as_of, "batch_size": batch_size}
        )

    with (
        patch(
            "app.routers.admin_jobs.RefreshConceptsJob.enqueue",
            autospec=True,
            side_effect=fake_enqueue,
        ),
        patch(
            "app.routers.admin_jobs.RefreshConceptsJob.warm_constituents_background",
            autospec=True,
            side_effect=fake_background,
        ),
    ):
        response = client.post(
            "/api/admin/jobs/refresh-concepts",
            json={"limit": 10, "batchSize": 5},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["stats"]["requestedLimit"] == 10
    assert payload["stats"]["scheduledConceptCount"] == 1
    assert payload["stats"]["batchSize"] == 5
    assert background_calls == [
        {
            "catalog": [{"conceptName": "AI算力", "conceptCode": "BK001"}],
            "as_of": "2026-03-08T08:00:01+00:00",
            "batch_size": 5,
        }
    ]


def test_admin_metrics_endpoint_returns_gateway_snapshot() -> None:
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_theme_news",
        return_value=[
            {
                "id": "ai-1",
                "title": "AI 算力需求提升",
                "summary": "产业链景气度持续改善。",
                "source": "tushare:news",
                "publishedAt": "2026-03-08T08:00:00+00:00",
                "sentiment": "positive",
                "relevanceScore": 0.92,
                "relatedStocks": ["603019"],
            }
        ],
    ):
        response = client.get("/api/v1/intelligence/themes/AI/news")

    assert response.status_code == 200

    metrics_response = client.get("/api/admin/metrics")
    assert metrics_response.status_code == 200

    payload = metrics_response.json()
    assert "provider_request_latency_ms" in payload["observations"]
    assert any(
        item["labels"].get("theme") == "AI"
        for item in payload["counters"]["theme_request_count"]
    )

