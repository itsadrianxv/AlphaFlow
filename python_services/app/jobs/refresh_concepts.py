"""Job for warming concept board catalog and constituent caches."""

from __future__ import annotations

import logging

from app.gateway.common import gateway_cache, set_cached_value
from app.jobs.common import build_job_summary, chunked, iso_now
from app.policies.cache_policy import get_cache_policy
from app.providers.tushare.client import TushareProviderClient

LOGGER = logging.getLogger(__name__)


class RefreshConceptsJob:
    def __init__(self, provider_client: TushareProviderClient | None = None) -> None:
        self._provider_client = provider_client or TushareProviderClient()

    def run(self, limit: int | None = None, batch_size: int = 20):
        started_at = iso_now()
        catalog = self._load_catalog(limit=limit)
        as_of = iso_now()
        self._cache_catalog(catalog=catalog, limit=limit, as_of=as_of)
        return self._warm_constituents(
            catalog=catalog,
            as_of=as_of,
            started_at=started_at,
            batch_size=batch_size,
        )

    def enqueue(self, limit: int | None = None, batch_size: int = 20):
        started_at = iso_now()
        catalog = self._load_catalog(limit=limit)
        as_of = iso_now()
        self._cache_catalog(catalog=catalog, limit=limit, as_of=as_of)

        return (
            build_job_summary(
                job_name="refresh-concepts",
                started_at=started_at,
                status="queued",
                stats={
                    "requestedLimit": limit,
                    "scheduledConceptCount": len(catalog),
                    "batchSize": batch_size,
                },
            ),
            catalog,
            as_of,
        )

    def warm_constituents_background(
        self,
        catalog: list[dict],
        *,
        as_of: str,
        batch_size: int,
    ) -> None:
        summary = self._warm_constituents(
            catalog=catalog,
            as_of=as_of,
            started_at=iso_now(),
            batch_size=batch_size,
        )
        LOGGER.info(
            "refresh-concepts background run finished",
            extra={"job": summary.job, "status": summary.status, "stats": summary.stats},
        )

    def _warm_constituents(
        self,
        *,
        catalog: list[dict],
        as_of: str,
        started_at: str,
        batch_size: int,
    ):
        constituent_cache_writes = 0
        failures: list[str] = []
        processed_batches = 0

        for batch in chunked(catalog, batch_size):
            processed_batches += 1
            for item in batch:
                concept_name = str(
                    item.get("conceptName") or item.get("name") or item.get("板块名称") or ""
                ).strip()
                concept_code = str(
                    item.get("conceptCode") or item.get("code") or item.get("板块代码") or ""
                ).strip()
                if not concept_name:
                    continue

                try:
                    constituents = self._provider_client.get_concept_constituents(
                        concept_name,
                        concept_code=concept_code or None,
                    )
                    set_cached_value(
                        dataset="concept_constituents",
                        provider=self._provider_client.provider_name,
                        params={"conceptName": concept_name},
                        value=constituents,
                        cache_policy=get_cache_policy("concept_constituents"),
                        cache=gateway_cache,
                        as_of=as_of,
                    )
                    constituent_cache_writes += 1
                except Exception:  # noqa: BLE001
                    failures.append(concept_name)

        return build_job_summary(
            job_name="refresh-concepts",
            started_at=started_at,
            stats={
                "conceptCount": len(catalog),
                "batchSize": batch_size,
                "processedBatches": processed_batches,
                "constituentCacheWrites": constituent_cache_writes,
                "failureCount": len(failures),
                "failedConcepts": failures[:10],
            },
        )

    def _load_catalog(self, *, limit: int | None) -> list[dict]:
        catalog = self._provider_client.get_concept_catalog()
        if limit is not None:
            return catalog[:limit]
        return catalog

    def _cache_catalog(self, *, catalog: list[dict], limit: int | None, as_of: str) -> None:
        set_cached_value(
            dataset="concept_catalog",
            provider=self._provider_client.provider_name,
            params={"scope": "all", "limit": limit or 0},
            value=catalog,
            cache_policy=get_cache_policy("concept_catalog"),
            cache=gateway_cache,
            as_of=as_of,
        )
