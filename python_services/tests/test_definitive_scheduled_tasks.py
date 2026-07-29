"""确定性定时评分任务单元测试。"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.definitive_scheduled_tasks.engine import ConditionStatus, evaluate_condition, rank_and_select, score_stock
from app.definitive_scheduled_tasks.indicators import calculate_indicators
from app.definitive_scheduled_tasks.json_parser import RuleSemanticError, parse_execution_plan
from app.definitive_scheduled_tasks.schemas import AtomicCondition, DeterministicExecutionPlan
from app.main import app


def plan(**overrides):
    payload = {
        "schemaVersion": 1,
        "type": "deterministic_scoring",
        "universe": {"type": "stocks", "stockCodes": ["600519", "000001"]},
        "data": {"adjustment": "qfq"},
        "indicators": [
            {"id": "macd_default", "type": "macd", "timeframes": ["daily"]},
            {"id": "kdj_default", "type": "kdj", "timeframes": ["daily"]},
        ],
        "rules": [
            {
                "id": "macd_positive",
                "name": "MACD 柱为正",
                "condition": {"timeframe": "daily", "metric": "macd_default.histogram", "operator": "gt", "value": 0},
                "points": 15,
            }
        ],
        "selection": {"minScore": 10, "limit": 1},
    }
    payload.update(overrides)
    return DeterministicExecutionPlan.model_validate(payload)


def history() -> pd.DataFrame:
    close = [float(index + 10) for index in range(130)]
    return pd.DataFrame(
        {
            "trade_date": pd.date_range("2025-01-01", periods=130),
            "open": [value - 1 for value in close],
            "high": [value + 1 for value in close],
            "low": [value - 2 for value in close],
            "close": close,
            "volume": [1000.0] * 130,
            "amount": [10000.0] * 130,
        }
    )


def test_parser_validates_metric_and_derives_cross_lookback():
    value = plan(
        rules=[
            {
                "id": "cross_zero",
                "name": "穿越零轴",
                "condition": {"timeframe": "daily", "metric": "macd_default.histogram", "operator": "cross_above", "value": 0},
                "points": 10,
            }
        ]
    )
    requirement = parse_execution_plan(value)
    assert requirement.lookback_bars == {"daily": 121}

    invalid = value.model_copy(update={"rules": [value.rules[0].model_copy(update={"condition": AtomicCondition(timeframe="weekly", metric="macd_default.histogram", operator="gt", value=0)})]})
    with pytest.raises(RuleSemanticError, match="未声明 weekly"):
        parse_execution_plan(invalid)


def test_macd_kdj_and_candle_outputs_are_deterministic():
    value = plan()
    result = calculate_indicators(history(), value.indicators, "daily")
    assert result.iloc[-1]["candle.direction"] == "bullish"
    assert result.iloc[-1]["macd_default.histogram"] > 0
    assert set(["kdj_default.k", "kdj_default.d", "kdj_default.j"]).issubset(result.columns)


def test_missing_and_cross_conditions_use_three_states():
    frame = pd.DataFrame({"macd.histogram": [-1.0, 1.0]})
    crossed = AtomicCondition(timeframe="daily", metric="macd.histogram", operator="cross_above", value=0)
    status, observations, reason = evaluate_condition(crossed, {"daily": frame})
    assert status == ConditionStatus.MATCHED
    assert observations["daily.macd.histogram"] == {"current": 1.0, "previous": -1.0}
    assert reason is None

    status, _, reason = evaluate_condition(crossed, {"daily": frame.tail(1)})
    assert status == ConditionStatus.NOT_EVALUATED
    assert reason == "指标值不足"


def test_scoring_keeps_unavailable_stock_and_stably_selects_top_n():
    value = plan()
    enriched = calculate_indicators(history(), value.indicators, "daily")
    available = score_stock(stock_code="600519", stock_name="贵州茅台", frames={"daily": enriched}, plan=value)
    unavailable = score_stock(stock_code="000001", stock_name="平安银行", frames={}, plan=value)
    rows = rank_and_select([unavailable, available], value)
    assert rows[0]["stockCode"] == "600519"
    assert rows[0]["selected"] is True
    assert rows[1]["evaluationStatus"] == "NONE"
    assert rows[1]["ruleResults"]["macd_positive"]["status"] == "NOT_EVALUATED"


def test_validation_route_returns_derived_requirements():
    response = TestClient(app).post(
        "/api/v1/definitive-scheduled-tasks/validate",
        json=plan().model_dump(mode="json"),
    )
    assert response.status_code == 200
    assert response.json()["requirements"]["lookbackBars"] == {"daily": 120}
