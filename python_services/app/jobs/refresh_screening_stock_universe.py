"""刷新供筛选搜索使用的股票池快照。"""

from __future__ import annotations

from datetime import date
import json
from typing import Callable

from app.data_providers.tushare_provider import TushareProvider
from app.jobs.common import build_job_summary, iso_now
from app.services.screening_stock_universe_store import ScreeningStockUniverseStore


class RefreshScreeningStockUniverseJob:
    def __init__(
        self,
        *,
        provider: TushareProvider | None = None,
        store: ScreeningStockUniverseStore | None = None,
        today_fn: Callable[[], date] | None = None,
    ) -> None:
        self._provider = provider or TushareProvider()
        self._store = store or ScreeningStockUniverseStore()
        self._today_fn = today_fn or date.today

    def run(self):
        started_at = iso_now()
        trading_date = self._today_fn()
        if not self._provider.is_a_share_trading_day(trading_date):
            return build_job_summary(
                job_name="refresh-screening-stock-universe",
                started_at=started_at,
                stats={
                    "tradingDate": trading_date.isoformat(),
                    "recordCount": 0,
                    "file": str(self._store.path),
                    "skipped": True,
                    "reason": "non_trading_day",
                },
            )
        records = self._provider.get_stock_search_universe()
        self._store.replace(
            records=records,
            trading_date=trading_date,
            provider=self._provider.provider_name,
        )
        return build_job_summary(
            job_name="refresh-screening-stock-universe",
            started_at=started_at,
            stats={
                "tradingDate": trading_date.isoformat(),
                "recordCount": len(records),
                "file": str(self._store.path),
                "skipped": False,
            },
        )


def main() -> int:
    summary = RefreshScreeningStockUniverseJob().run()
    print(json.dumps(summary.model_dump(mode="json"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
