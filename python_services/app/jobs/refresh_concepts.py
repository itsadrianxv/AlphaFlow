"""Job for warming concept board catalog and constituent caches."""

from __future__ import annotations

from app.gateway.common import gateway_cache, set_cached_value
from app.jobs.common import build_job_summary, iso_now
from app.policies.cache_policy import get_cache_policy
from app.providers.akshare.client import AkShareProviderClient


class RefreshConceptsJob:
    def __init__(self, provider_client: AkShareProviderClient | None = None) -> None:
        self._provider_client = provider_client or AkShareProviderClient()

    def run(self, limit: int | None = None):
        started_at = iso_now()
        catalog = self._provider_client.get_concept_catalog()
        if limit is not None:
            catalog = catalog[:limit]

        as_of = iso_now()
        set_cached_value(
            dataset="concept_catalog",
            provider=self._provider_client.provider_name,
            params={"scope": "all", "limit": limit or 0},
            value=catalog,
            cache_policy=get_cache_policy("concept_catalog"),
            cache=gateway_cache,
            as_of=as_of,
        )

        constituent_cache_writes = 0
        failures: list[str] = []
        for item in catalog:
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
                "constituentCacheWrites": constituent_cache_writes,
                "failureCount": len(failures),
                "failedConcepts": failures[:10],
            },
        )
