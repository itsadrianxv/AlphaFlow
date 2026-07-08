"""Job for warming the stock universe and snapshot caches."""

from __future__ import annotations

from app.gateway.common import gateway_cache, set_cached_value
from app.infrastructure.metrics.recorder import metrics_recorder
from app.jobs.common import build_job_summary, chunked, iso_now
from app.policies.cache_policy import get_cache_policy
from app.providers.mappers import to_market_stock
from app.providers.tushare.client import TushareProviderClient


class RefreshUniverseJob:
    def __init__(self, provider_client: TushareProviderClient | None = None) -> None:
        self._provider_client = provider_client or TushareProviderClient()

    def run(
        self,
        limit: int | None = None,
        batch_size: int = 200,
    ):
        started_at = iso_now()
        raw_items = self._provider_client.get_stock_universe()
        if limit is not None:
            raw_items = raw_items[:limit]

        stock_items = [
            to_market_stock(item, self._provider_client.provider_name)
            for item in raw_items
            if str(item.get("code") or "").strip()
        ]
        stock_codes = [item.stockCode for item in stock_items]
        as_of = iso_now()

        set_cached_value(
            dataset="stock_universe",
            provider=self._provider_client.provider_name,
            params={"scope": "all", "limit": limit or 0},
            value={"codes": stock_codes, "total": len(stock_codes)},
            cache_policy=get_cache_policy("stock_universe"),
            cache=gateway_cache,
            as_of=as_of,
        )

        batch_count = 0
        snapshot_cache_writes = 0
        for batch in chunked(stock_items, batch_size):
            batch_codes = [item.stockCode for item in batch]
            set_cached_value(
                dataset="stock_batch",
                provider=self._provider_client.provider_name,
                params={"stockCodes": sorted(batch_codes)},
                value=batch,
                cache_policy=get_cache_policy("stock_batch"),
                cache=gateway_cache,
                as_of=as_of,
            )
            metrics_recorder.record_batch_success(
                dataset="stock_batch",
                provider=self._provider_client.provider_name,
                success_count=len(batch),
                total_count=len(batch_codes),
            )

            for stock in batch:
                set_cached_value(
                    dataset="stock_snapshot",
                    provider=self._provider_client.provider_name,
                    params={"stockCode": stock.stockCode},
                    value=stock,
                    cache_policy=get_cache_policy("stock_snapshot"),
                    cache=gateway_cache,
                    as_of=as_of,
                )
                snapshot_cache_writes += 1

            batch_count += 1

        return build_job_summary(
            job_name="refresh-universe",
            started_at=started_at,
            stats={
                "stockCount": len(stock_codes),
                "batchCount": batch_count,
                "snapshotCacheWrites": snapshot_cache_writes,
            },
        )
