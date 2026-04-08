from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

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
