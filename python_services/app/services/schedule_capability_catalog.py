from __future__ import annotations

from datetime import datetime
import json
import os
from typing import Any

from app.data_providers import get_default_data_provider
from app.data_providers.tushare_provider import RAW_DATASET_FIELDS

DEFAULT_MAX_ROWS = 500
DEFAULT_MAX_LOOKBACK_DAYS = 365
ALLOWED_PARAMETERS = {
    "ts_code", "trade_date", "start_date", "end_date", "period", "ann_date",
    "exchange", "market", "list_status", "index_code", "fund_type", "month",
    "date", "curr", "fields",
}
MINIMUM_CREDITS = {
    "stk_factor_pro": 5000,
    "cyq_perf": 5000,
    "stk_nineturn": 5000,
    "stk_auction_o": 10000,
    "ths_hot": 5000,
    "limit_list_ths": 5000,
    "moneyflow_mkt_dc": 5000,
    "moneyflow_ths": 5000,
    "moneyflow_cnt_ths": 5000,
}


def _fields(dataset: str) -> list[str]:
    if dataset == "trade_cal":
        return ["exchange", "cal_date", "is_open", "pretrade_date"]
    return [item for item in RAW_DATASET_FIELDS.get(dataset, "").split(",") if item]


def list_schedule_capabilities() -> list[dict[str, Any]]:
    datasets = sorted(dataset for dataset, fields in RAW_DATASET_FIELDS.items() if dataset != "rt_min" and fields)
    credits = int(os.getenv("TUSHARE_CREDITS", "15000"))
    return [
        {
            "id": f"tushare.{dataset}",
            "provider": "tushare",
            "dataset": dataset,
            "executionTool": "internal_tushare_dataset",
            "minimumCredits": MINIMUM_CREDITS.get(dataset, 2000),
            "available": credits >= MINIMUM_CREDITS.get(dataset, 2000),
            "fields": _fields(dataset),
            "allowedParameters": sorted(ALLOWED_PARAMETERS - {"fields"}),
            "maxRows": DEFAULT_MAX_ROWS,
            "maxLookbackDays": DEFAULT_MAX_LOOKBACK_DAYS,
            "liveProbe": False,
            "documentationUrl": f"https://tushare.pro/document/2?doc_id={dataset}",
        }
        for dataset in datasets
    ]


def inspect_schedule_capability(capability: str) -> dict[str, Any] | None:
    return next((item for item in list_schedule_capabilities() if item["id"] == capability), None)


def _parse_date(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("-", "")
    try:
        return datetime.strptime(text, "%Y%m%d")
    except ValueError:
        raise ValueError("日期参数必须使用 YYYYMMDD 或 YYYY-MM-DD") from None


def query_tushare_dataset(dataset: str, params: dict[str, Any], max_rows: int) -> dict[str, Any]:
    capability = inspect_schedule_capability(f"tushare.{dataset}")
    if not capability:
        raise ValueError("TuShare 数据集未进入定时任务白名单")
    if not capability["available"]:
        raise ValueError("TuShare 积分不足以访问该数据集")
    unknown = set(params) - (ALLOWED_PARAMETERS - {"fields"})
    if unknown:
        raise ValueError(f"包含未允许的参数: {', '.join(sorted(unknown))}")
    start = _parse_date(params.get("start_date"))
    end = _parse_date(params.get("end_date"))
    if start and end and (end - start).days > DEFAULT_MAX_LOOKBACK_DAYS:
        raise ValueError("查询日期跨度超过定时任务上限")
    bounded_rows = max(1, min(int(max_rows), DEFAULT_MAX_ROWS))
    provider = get_default_data_provider()
    request_params = {key: str(value) for key, value in params.items() if value not in {None, ""}}
    request_params["fields"] = ",".join(_fields(dataset))
    frame = provider.get_raw_frame(dataset, **request_params)
    rows = json.loads(frame.head(bounded_rows).to_json(orient="records", date_format="iso", force_ascii=False))
    return {
        "provider": "tushare",
        "dataset": dataset,
        "rows": rows,
        "truncated": len(frame.index) > bounded_rows,
        "maxRows": bounded_rows,
    }
