from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routers import homepage_provider_v1
from app.routers.homepage_provider_v1 import _adapter_for


def test_homepage_provider_adapter_is_reused_for_same_provider_key() -> None:
    assert _adapter_for("tushare") is _adapter_for("tushare")
    assert _adapter_for("minishare") is _adapter_for("minishare")


def test_homepage_provider_internal_route_enforces_contract_and_returns_envelope(monkeypatch) -> None:
    monkeypatch.setenv("ALPHAFLOW_INTERNAL_API_SECRET", "secret")
    client = TestClient(app)

    unauthorized = client.post("/api/v1/homepage-provider/fetch", json={"contractVersion": "1.0"})
    assert unauthorized.status_code == 401

    incompatible = client.post(
        "/api/v1/homepage-provider/fetch",
        headers={"X-Alphaflow-Internal-Secret": "secret"},
        json={"contractVersion": "2.0"},
    )
    assert incompatible.status_code == 400

    response = client.post(
        "/api/v1/homepage-provider/fetch",
        headers={"X-Alphaflow-Internal-Secret": "secret"},
        json={
            "contractVersion": "1.0",
            "providerKey": "test",
            "attemptId": "attempt-1",
            "request": {
                "datasetKey": "missing",
                "requestedScope": {"tradeDate": "2026-08-01"},
                "targetDataCutoff": {"key": "trade_date", "value": "2026-08-01"},
                "idempotencyKey": "idem-1",
                "requestFingerprint": "sha256:request",
                "expectedContractVersion": "1.0",
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["contractVersion"] == "1.0"
    assert body["resultStatus"] == "error"
    assert body["errors"][0]["errorClass"] == "unsupported_dataset"


def test_homepage_provider_fetch_does_not_block_event_loop(monkeypatch) -> None:
    class SlowAdapter:
        def fetch(self, _request):
            time.sleep(0.15)
            return SimpleNamespace(to_dict=lambda: {"resultStatus": "success"})

    monkeypatch.setattr(
        homepage_provider_v1,
        "_adapter_for",
        lambda _provider_key: SlowAdapter(),
    )

    payload = {
        "contractVersion": "1.0",
        "providerKey": "minishare",
        "attemptId": "attempt-slow",
        "request": {
            "datasetKey": "news.radar_history",
            "requestedScope": {},
            "targetDataCutoff": None,
        },
    }

    async def run_scenario() -> float:
        started_at = time.perf_counter()
        request_task = asyncio.create_task(
            homepage_provider_v1.fetch_homepage_provider_item(payload),
        )
        await asyncio.sleep(0.02)
        event_loop_delay = time.perf_counter() - started_at
        await request_task
        return event_loop_delay

    assert asyncio.run(run_scenario()) < 0.08
