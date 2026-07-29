"""标准 K 线需求到 TuShare 数据集与字段的纯映射。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TushareBarMapping:
    dataset: str
    fields: str


def map_bar_request(timeframe: str) -> TushareBarMapping:
    dataset = {
        "DAILY": "daily",
        "WEEKLY": "weekly",
        "MONTHLY": "monthly",
    }.get(timeframe.strip().upper())
    if dataset is None:
        raise ValueError(f"不支持的 TuShare K 线周期: {timeframe}")
    return TushareBarMapping(
        dataset=dataset,
        fields="ts_code,trade_date,open,high,low,close,vol,amount",
    )
