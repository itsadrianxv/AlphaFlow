"""筛选股票池 JSON 快照的持久化与读取。"""

from __future__ import annotations

from datetime import UTC, date, datetime
import json
import os
from pathlib import Path
import tempfile
from typing import Any


_VALID_MARKETS = {"SH", "SZ", "BJ"}
_DEFAULT_FILE_NAME = "screening_stock_universe.json"


class StockUniverseUnavailableError(RuntimeError):
    """筛选股票池尚未准备好或快照文件无效。"""


def default_stock_universe_path() -> Path:
    configured = os.getenv("SCREENING_STOCK_UNIVERSE_FILE", "").strip()
    if configured:
        return Path(configured)

    docker_data_dir = Path("/app/data")
    if docker_data_dir.is_dir():
        return docker_data_dir / _DEFAULT_FILE_NAME
    return Path(__file__).resolve().parents[3] / "data" / _DEFAULT_FILE_NAME


class ScreeningStockUniverseStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or default_stock_universe_path()
        self._cache: tuple[int, list[dict[str, str]]] | None = None

    @property
    def path(self) -> Path:
        return self._path

    def load_records(self) -> list[dict[str, str]]:
        try:
            modified_at = self._path.stat().st_mtime_ns
        except FileNotFoundError as exc:
            raise StockUniverseUnavailableError("筛选股票池尚未首次刷新") from exc

        if self._cache is not None and self._cache[0] == modified_at:
            return list(self._cache[1])

        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise StockUniverseUnavailableError("筛选股票池文件不可用") from exc

        records = self._validate_payload(payload)
        self._cache = (modified_at, records)
        return list(records)

    def replace(
        self,
        *,
        records: list[dict[str, str]],
        trading_date: date,
        provider: str,
        refreshed_at: datetime | None = None,
    ) -> None:
        normalized_records = self._normalize_records(records)
        if not normalized_records:
            raise ValueError("筛选股票池刷新结果为空或不合法")

        generated_at = refreshed_at or datetime.now(UTC)
        payload = {
            "schemaVersion": 1,
            "provider": provider,
            "tradingDate": trading_date.isoformat(),
            "refreshedAt": generated_at.astimezone(UTC).isoformat(),
            "recordCount": len(normalized_records),
            "records": normalized_records,
        }
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=self._path.parent,
            prefix=f".{self._path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
            temporary_path = Path(handle.name)

        try:
            temporary_path.replace(self._path)
        finally:
            temporary_path.unlink(missing_ok=True)
        self._cache = None

    def _validate_payload(self, payload: Any) -> list[dict[str, str]]:
        if not isinstance(payload, dict):
            raise StockUniverseUnavailableError("筛选股票池文件格式无效")
        if payload.get("schemaVersion") != 1:
            raise StockUniverseUnavailableError("筛选股票池文件版本不受支持")
        records = payload.get("records")
        if not isinstance(records, list):
            raise StockUniverseUnavailableError("筛选股票池文件缺少记录")
        normalized = self._normalize_records(records)
        if not normalized or len(normalized) != len(records):
            raise StockUniverseUnavailableError("筛选股票池文件记录无效")
        if payload.get("recordCount") != len(normalized):
            raise StockUniverseUnavailableError("筛选股票池文件记录数不一致")
        return normalized

    @staticmethod
    def _normalize_records(records: list[Any]) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        seen_codes: set[str] = set()
        for record in records:
            if not isinstance(record, dict):
                continue
            stock_code = str(record.get("stockCode") or "").strip()
            stock_name = str(record.get("stockName") or "").strip()
            market = str(record.get("market") or "").strip().upper()
            if (
                len(stock_code) != 6
                or not stock_code.isdigit()
                or not stock_name
                or market not in _VALID_MARKETS
                or stock_code in seen_codes
            ):
                continue
            seen_codes.add(stock_code)
            normalized.append(
                {
                    "stockCode": stock_code,
                    "stockName": stock_name,
                    "market": market,
                }
            )
        return sorted(normalized, key=lambda item: item["stockCode"])
