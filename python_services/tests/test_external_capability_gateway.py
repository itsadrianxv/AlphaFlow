from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from app.data_providers.contracts import StockProfile
from app.main import app

client = TestClient(app)


def test_screening_query_capability_returns_standard_meta_and_records_replay(tmp_path, monkeypatch):
    from app.gateway.external_capability_gateway import CapabilityResult

    replay_dir = tmp_path / "replays"
    monkeypatch.setenv("CAPABILITY_REPLAY_DIR", str(replay_dir))

    fake_payload = {
        "periods": ["2024"],
        "indicatorMeta": [],
        "rows": [],
        "latestSnapshotRows": [],
        "warnings": [],
        "dataStatus": "READY",
        "provider": "tushare",
    }

    with patch(
        "app.routers.capabilities_v1.external_capability_gateway.query_screening_dataset",
        return_value=CapabilityResult(
            provider="tushare",
            capability="screening",
            operation="query_dataset",
            data=fake_payload,
            diagnostics={"hasToken": True},
        ),
    ):
        response = client.post(
            "/api/v1/capabilities/screening/query-dataset",
            json={
                "stockCodes": ["600519"],
                "indicators": [],
                "formulas": [],
                "timeConfig": {
                    "periodType": "ANNUAL",
                    "rangeMode": "PRESET",
                    "presetKey": "1Y",
                },
            },
            headers={"x-request-id": "req_screening_case"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["traceId"] == "req_screening_case"
    assert payload["meta"]["provider"] == "tushare"
    assert payload["meta"]["capability"] == "screening"
    assert payload["meta"]["operation"] == "query_dataset"
    assert payload["data"]["provider"] == "tushare"

    artifacts = list(Path(replay_dir).rglob("*.json"))
    assert len(artifacts) == 1
    artifact_payload = artifacts[0].read_text(encoding="utf-8")
    assert "req_screening_case" in artifact_payload
    assert "\"outcome\": \"success\"" in artifact_payload


def test_screening_query_capability_returns_error_envelope():
    from app.gateway.external_capability_gateway import CapabilityError

    with patch(
        "app.routers.capabilities_v1.external_capability_gateway.query_screening_dataset",
        side_effect=CapabilityError(
            provider="tushare",
            capability="screening",
            operation="query_dataset",
            code="tushare_query_failed",
            message="Tushare token missing",
            failure_phase="configuration",
            diagnostics={"hasToken": False},
            status_code=503,
        ),
    ):
        response = client.post(
            "/api/v1/capabilities/screening/query-dataset",
            json={
                "stockCodes": ["600519"],
                "indicators": [],
                "formulas": [],
                "timeConfig": {
                    "periodType": "ANNUAL",
                    "rangeMode": "PRESET",
                    "presetKey": "1Y",
                },
            },
            headers={"x-request-id": "req_screening_error"},
        )

    assert response.status_code == 503
    payload = response.json()
    assert payload["error"]["traceId"] == "req_screening_error"
    assert payload["error"]["provider"] == "tushare"
    assert payload["error"]["capability"] == "screening"
    assert payload["error"]["operation"] == "query_dataset"
    assert payload["error"]["code"] == "tushare_query_failed"
    assert payload["error"]["failurePhase"] == "configuration"
    assert payload["error"]["diagnostics"]["hasToken"] is False


def test_capability_replay_compare_uses_semantic_outcome_only(tmp_path, monkeypatch):
    from app.infrastructure.replay.capability_replay import (
        compare_replay_outcomes,
        load_replay_artifact,
        record_replay_artifact,
    )

    replay_dir = tmp_path / "semantic"
    monkeypatch.setenv("CAPABILITY_REPLAY_DIR", str(replay_dir))

    recorded = record_replay_artifact(
        trace_id="req_compare",
        provider="tushare",
        capability="screening",
        operation="query_dataset",
        request_payload={"stockCodes": ["600519"]},
        result_summary={"rows": 1},
        diagnostics={"environment": "local"},
        outcome="success",
        elapsed_ms=12,
        config_fingerprint="cfg-1",
        environment="local",
    )
    loaded = load_replay_artifact(recorded)

    assert compare_replay_outcomes(
        loaded,
        {
            **loaded,
            "resultSummary": {"rows": 99},
            "diagnostics": {"environment": "docker"},
        },
    )


def test_screening_query_capability_reports_actual_provider_for_invalid_payload(monkeypatch):
    from app.gateway.external_capability_gateway import (
        CapabilityError,
        external_capability_gateway,
    )

    class BrokenProvider:
        provider_name = "tushare"

        def get_stock_profile(self, stock_code: str) -> StockProfile:
            return StockProfile(
                stockCode=stock_code,
                tsCode=f"{stock_code}.SH",
                stockName=stock_code,
                market="SH",
                sector="主板",
                industry="",
            )

        def get_latest_metrics(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
        ):
            return None

        def get_metric_series(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
            periods: list[str],
        ) -> dict[str, dict[str, list]]:
            return {}

    monkeypatch.setattr(
        "app.gateway.external_capability_gateway.get_default_data_provider",
        lambda: BrokenProvider(),
    )

    with pytest.raises(CapabilityError) as exc_info:
        external_capability_gateway.query_screening_dataset(
            "req_provider_name",
            {
                "stockCodes": ["601138"],
                "indicators": [
                    {
                        "id": "pe_ttm",
                        "name": "PE(TTM)",
                        "retrievalMode": "latest_only",
                        "periodScope": "latest_only",
                        "valueType": "NUMBER",
                    }
                ],
                "formulas": [],
                "timeConfig": {
                    "periodType": "ANNUAL",
                    "rangeMode": "PRESET",
                    "presetKey": "1Y",
                },
            },
        )

    assert exc_info.value.provider == "tushare"
    assert (
        exc_info.value.message
        == "Screening provider tushare returned invalid latest metrics payload: expected dict, got NoneType"
    )


def test_screening_query_capability_uses_strict_screening_provider(monkeypatch):
    from app.gateway.external_capability_gateway import external_capability_gateway

    class StrictProvider:
        provider_name = "tushare"

        def get_stock_profile(self, stock_code: str) -> StockProfile:
            return StockProfile(
                stockCode=stock_code,
                tsCode=f"{stock_code}.SH",
                stockName=stock_code,
                market="SH",
                sector="主板",
                industry="",
            )

        def get_latest_metrics(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
        ) -> dict[str, dict[str, float | None]]:
            return {stock_code: {} for stock_code in stock_codes}

        def get_metric_series(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
            periods: list[str],
        ) -> dict[str, dict[str, list]]:
            return {stock_code: {} for stock_code in stock_codes}

    monkeypatch.setattr(
        "app.gateway.external_capability_gateway.get_default_data_provider",
        lambda: StrictProvider(),
    )

    result = external_capability_gateway.query_screening_dataset(
        "req_strict_provider",
        {
            "stockCodes": ["600519"],
            "indicators": [],
            "formulas": [],
            "timeConfig": {
                "periodType": "ANNUAL",
                "rangeMode": "PRESET",
                "presetKey": "1Y",
            },
        },
    )

    assert result.provider == "tushare"
    assert result.data["provider"] == "tushare"


def test_search_web_prefers_tavily_when_configured():
    from app.gateway.external_capability_gateway import ExternalCapabilityGateway

    class TavilyClient:
        def is_configured(self) -> bool:
            return True

        def diagnostics(self) -> dict[str, object]:
            return {
                "endpoint": "https://api.tavily.com",
                "configured": True,
                "timeoutSeconds": 8,
            }

        def search(self, *, query: str, limit: int) -> list[dict[str, object]]:
            return [
                {
                    "title": f"Tavily {query}",
                    "url": "https://example.com/tavily",
                    "description": "summary",
                    "markdown": "body",
                }
            ]

    class FirecrawlClient:
        def is_configured(self) -> bool:
            return True

        def diagnostics(self) -> dict[str, object]:
            return {
                "endpoint": "https://api.firecrawl.dev",
                "configured": True,
                "timeoutSeconds": 15,
            }

        def search(self, *, query: str, limit: int) -> list[dict[str, object]]:
            raise AssertionError("firecrawl should not be used when tavily is configured")

    gateway = ExternalCapabilityGateway(
        tavily_client=TavilyClient(),
        firecrawl_client=FirecrawlClient(),
    )

    result = gateway.search_web(
        "req_tavily",
        {
            "queries": ["AI infra"],
            "limit": 2,
        },
    )

    assert result.provider == "tavily"
    assert result.data[0]["title"] == "Tavily AI infra"
    assert result.diagnostics["endpoint"] == "https://api.tavily.com"


def test_search_web_falls_back_to_firecrawl_when_tavily_not_configured():
    from app.gateway.external_capability_gateway import ExternalCapabilityGateway

    class TavilyClient:
        def is_configured(self) -> bool:
            return False

        def diagnostics(self) -> dict[str, object]:
            return {
                "endpoint": "https://api.tavily.com",
                "configured": False,
                "timeoutSeconds": 8,
            }

    class FirecrawlClient:
        def is_configured(self) -> bool:
            return True

        def diagnostics(self) -> dict[str, object]:
            return {
                "endpoint": "https://api.firecrawl.dev",
                "configured": True,
                "timeoutSeconds": 15,
            }

        def search(self, *, query: str, limit: int) -> list[dict[str, object]]:
            return [
                {
                    "title": f"Firecrawl {query}",
                    "url": "https://example.com/firecrawl",
                    "description": "summary",
                    "markdown": "body",
                }
            ]

    gateway = ExternalCapabilityGateway(
        tavily_client=TavilyClient(),
        firecrawl_client=FirecrawlClient(),
    )

    result = gateway.search_web(
        "req_firecrawl_fallback",
        {
            "queries": ["AI infra"],
            "limit": 2,
        },
    )

    assert result.provider == "firecrawl"
    assert result.data[0]["title"] == "Firecrawl AI infra"
    assert result.diagnostics["endpoint"] == "https://api.firecrawl.dev"


def test_search_web_maps_tavily_errors_to_tavily_provider():
    from app.gateway.external_capability_gateway import (
        CapabilityError,
        ExternalCapabilityGateway,
    )

    class TavilyClient:
        def is_configured(self) -> bool:
            return True

        def diagnostics(self) -> dict[str, object]:
            return {
                "endpoint": "https://api.tavily.com",
                "configured": True,
                "timeoutSeconds": 8,
            }

        def search(self, *, query: str, limit: int) -> list[dict[str, object]]:
            raise RuntimeError("429 from tavily")

    gateway = ExternalCapabilityGateway(tavily_client=TavilyClient())

    with pytest.raises(CapabilityError) as exc_info:
        gateway.search_web(
            "req_tavily_error",
            {
                "queries": ["AI infra"],
                "limit": 2,
            },
        )

    assert exc_info.value.provider == "tavily"
    assert exc_info.value.code == "tavily_search_failed"
    assert exc_info.value.diagnostics["endpoint"] == "https://api.tavily.com"

