"""JSONLogic 确定性定时评分任务测试。"""

from __future__ import annotations

import pandas as pd
import pytest
import json
from pathlib import Path
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.definitive_scheduled_tasks.engine import ConditionStatus, evaluate_condition, evaluate_snapshot_condition, rank_and_select, score_stock
from app.definitive_scheduled_tasks.indicators import calculate_indicators
from app.definitive_scheduled_tasks.json_parser import RuleSemanticError, parse_execution_plan
from app.definitive_scheduled_tasks.schemas import DeterministicExecutionPlan
from app.main import app


def plan(**overrides):
    payload = {
        "schemaVersion": 2,
        "type": "deterministic_scoring",
        "universe": {"type": "stocks", "stockCodes": ["600519", "000001"]},
        "data": {"adjustment": "qfq"},
        "indicators": [
            {"id": "macd", "type": "macd", "timeframes": ["daily"]},
            {"id": "kdj", "type": "kdj", "timeframes": ["daily"]},
        ],
        "rules": [{
            "id": "macd_positive", "name": "MACD 柱为正",
            "condition": {">": [{"var": "daily.macd.histogram.current"}, 0]},
            "scoreDelta": 15,
        }],
        "selection": {"minScore": 10, "limit": 1},
    }
    payload.update(overrides)
    return DeterministicExecutionPlan.model_validate(payload)


def history() -> pd.DataFrame:
    close = [float(index + 10) for index in range(130)]
    return pd.DataFrame({
        "trade_date": pd.date_range("2025-01-01", periods=130),
        "open": [value - 1 for value in close], "high": [value + 1 for value in close],
        "low": [value - 2 for value in close], "close": close,
        "volume": [1000.0] * 130, "amount": [10000.0] * 130,
    })


def test_schema_rejects_unapproved_jsonlogic_and_var_defaults():
    with pytest.raises(ValidationError, match="不支持操作符"):
        plan(rules=[{"id": "bad", "name": "非法", "condition": {"+": [1, 2]}, "scoreDelta": 1}])
    with pytest.raises(ValidationError, match="var 必须是快照路径字符串"):
        plan(rules=[{"id": "bad", "name": "非法", "condition": {"var": ["daily.close.current", 0]}, "scoreDelta": 1}])


def test_parser_derives_timeframes_and_cross_lookback():
    value = plan(rules=[{
        "id": "cross", "name": "KDJ 金叉",
        "condition": {"cross_above": [{"var": "daily.kdj.k"}, {"var": "daily.kdj.d"}]},
        "scoreDelta": 10,
    }])
    assert parse_execution_plan(value).lookback_bars == {"daily": 121}

    invalid = plan(rules=[{
        "id": "bad", "name": "错误周期",
        "condition": {">": [{"var": "weekly.kdj.k.current"}, 0]}, "scoreDelta": 1,
    }])
    with pytest.raises(RuleSemanticError, match="未声明 weekly"):
        parse_execution_plan(invalid)


def test_cross_comparison_enum_range_and_three_states():
    frame = pd.DataFrame({
        "kdj.k": [20.0, 40.0], "kdj.d": [30.0, 35.0],
        "macd.histogram": [-1.0, 1.0], "candle.direction": ["bearish", "bullish"],
    })
    cases = [
        ({"cross_above": [{"var": "daily.kdj.k"}, {"var": "daily.kdj.d"}]}, ConditionStatus.MATCHED),
        ({"cross_above": [{"var": "daily.macd.histogram"}, 0]}, ConditionStatus.MATCHED),
        ({"==": [{"var": "daily.candle.direction.current"}, "bullish"]}, ConditionStatus.MATCHED),
        ({"and": [{">=": [{"var": "daily.kdj.k.current"}, 20]}, {"<=": [{"var": "daily.kdj.k.current"}, 80]}]}, ConditionStatus.MATCHED),
    ]
    for condition, expected in cases:
        assert evaluate_condition(condition, {"daily": frame})[0] == expected

    missing = {"and": [{">": [{"var": "daily.kdj.k.current"}, 0]}, {">": [{"var": "weekly.kdj.k.current"}, 0]}]}
    status, _, reason = evaluate_condition(missing, {"daily": frame})
    assert status == ConditionStatus.NOT_EVALUATED
    assert reason == "快照值不存在"


def test_signed_scoring_bounds_partial_ranking_and_audit():
    value = plan(rules=[
        {"id": "reward", "name": "奖励", "condition": {">": [{"var": "daily.close.current"}, 10]}, "scoreDelta": 20},
        {"id": "penalty", "name": "扣分", "condition": {"==": [{"var": "weekly.candle.direction.current"}, "bearish"]}, "scoreDelta": -15},
    ], selection={"minScore": 0, "limit": 10})
    row = score_stock(stock_code="600519", stock_name="贵州茅台", frames={"daily": pd.DataFrame({"close": [11.0]})}, plan=value)
    assert row["evaluationStatus"] == "PARTIAL"
    assert row["score"] == 20
    assert row["minimumPossibleScore"] == -15
    assert row["maximumPossibleScore"] == 20
    assert row["ruleResults"]["reward"]["awardedDelta"] == 20
    assert row["ruleResults"]["penalty"]["configuredDelta"] == -15
    assert row["ruleResults"]["penalty"]["conditionTree"]["status"] == "NOT_EVALUATED"
    assert row["ruleResults"]["penalty"]["conditionTree"]["reasonCode"] == "MISSING_SNAPSHOT_VALUE"
    assert rank_and_select([row], value)[0]["selected"] is True


def test_macd_kdj_outputs_and_validation_route_are_v2():
    value = plan()
    result = calculate_indicators(history(), value.indicators, "daily")
    assert result.iloc[-1]["candle.direction"] == "bullish"
    assert {"kdj.k", "kdj.d", "kdj.j"}.issubset(result.columns)
    response = TestClient(app).post("/api/v1/definitive-scheduled-tasks/validate", json=value.model_dump(mode="json"))
    assert response.status_code == 200
    assert response.json()["requirements"]["lookbackBars"] == {"daily": 120}


def test_shared_jsonlogic_contract_fixtures():
    fixture_path = Path(__file__).resolve().parents[2] / "test_fixtures" / "definitive_scoring_jsonlogic_v2.json"
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert payload["schemaVersion"] == 2
    for case in payload["cases"]:
        status, tree = evaluate_snapshot_condition(case["condition"], case["snapshot"])
        assert status.value == case["status"], case["name"]
        assert tree["op"] in case["condition"]
