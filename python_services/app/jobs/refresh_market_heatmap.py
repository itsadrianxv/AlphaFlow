"""刷新 A 股概念热力图快照。"""

from __future__ import annotations

from datetime import date, datetime
import json
from typing import Callable
from zoneinfo import ZoneInfo

from app.gateway.market_gateway import MarketGateway
from app.jobs.common import build_job_summary, iso_now
from app.providers.tushare.client import TushareProviderClient

_SHANGHAI = ZoneInfo("Asia/Shanghai")


class RefreshMarketHeatmapJob:
    def __init__(
        self,
        *,
        provider_client: TushareProviderClient | None = None,
        gateway: MarketGateway | None = None,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self._provider_client = provider_client or TushareProviderClient()
        self._gateway = gateway or MarketGateway(provider_client=self._provider_client)
        self._now_fn = now_fn or (lambda: datetime.now(_SHANGHAI))

    def run(self):
        started_at = iso_now()
        now = self._now_fn().astimezone(_SHANGHAI)
        trading_date: date = now.date()
        if not self._provider_client.is_a_share_trading_day(trading_date):
            return build_job_summary(
                job_name="refresh-market-heatmap",
                started_at=started_at,
                stats={
                    "tradingDate": trading_date.isoformat(),
                    "skipped": True,
                    "reason": "non_trading_day",
                },
            )

        response = self._gateway.get_heatmap_snapshot(
            request_id="job-refresh-market-heatmap",
            concept_limit=15,
            force_refresh=True,
            prefer_intraday=now.hour < 15,
        )
        return build_job_summary(
            job_name="refresh-market-heatmap",
            started_at=started_at,
            stats={
                "tradingDate": trading_date.isoformat(),
                "conceptCount": len(response.data.concepts),
                "priceSource": response.data.priceSource,
                "cacheHit": response.meta.cacheHit,
                "stale": response.meta.isStale,
                "skipped": False,
            },
        )


def main() -> int:
    summary = RefreshMarketHeatmapJob().run()
    print(json.dumps(summary.model_dump(mode="json"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
