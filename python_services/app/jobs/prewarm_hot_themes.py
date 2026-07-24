"""Job for warming frequently requested theme intelligence caches."""

from __future__ import annotations

from app.gateway.intelligence_gateway import IntelligenceGateway, intelligence_gateway
from app.gateway.market_gateway import MarketGateway, market_gateway
from app.jobs.common import build_job_summary, iso_now
from app.providers.tushare.client import TushareProviderClient

_DEFAULT_NEWS_DAYS = 7
_DEFAULT_NEWS_LIMIT = 20
_DEFAULT_CONCEPT_LIMIT = 5


class PrewarmHotThemesJob:
    def __init__(
        self,
        market_data_gateway: MarketGateway | None = None,
        intelligence_data_gateway: IntelligenceGateway | None = None,
        theme_provider: TushareProviderClient | None = None,
    ) -> None:
        self._market_gateway = market_data_gateway or market_gateway
        self._intelligence_gateway = intelligence_data_gateway or intelligence_gateway
        self._theme_provider = theme_provider or TushareProviderClient()

    def run(
        self,
        themes: list[str] | None = None,
        max_themes: int = 5,
        evidence_per_theme: int = 3,
    ):
        started_at = iso_now()
        selected_themes = self._select_themes(themes=themes, max_themes=max_themes)

        warmed_news = 0
        warmed_candidates = 0
        warmed_concepts = 0
        warmed_evidence = 0
        warmed_research_packs = 0
        failures: list[str] = []

        for theme in selected_themes:
            try:
                self._intelligence_gateway.get_theme_news(
                    request_id=f"job-prewarm:{theme}:news",
                    theme=theme,
                    days=_DEFAULT_NEWS_DAYS,
                    limit=_DEFAULT_NEWS_LIMIT,
                )
                warmed_news += 1

                candidates_response = self._market_gateway.get_theme_candidates(
                    request_id=f"job-prewarm:{theme}:candidates",
                    theme=theme,
                    limit=max(evidence_per_theme, 6),
                )
                warmed_candidates += 1

                self._intelligence_gateway.get_theme_concepts(
                    request_id=f"job-prewarm:{theme}:concepts",
                    theme=theme,
                    limit=_DEFAULT_CONCEPT_LIMIT,
                )
                warmed_concepts += 1

                for candidate in candidates_response.data.candidates[:evidence_per_theme]:
                    self._intelligence_gateway.get_stock_evidence(
                        request_id=f"job-prewarm:{theme}:evidence:{candidate.stockCode}",
                        stock_code=candidate.stockCode,
                        concept=candidate.concept or theme,
                    )
                    warmed_evidence += 1
                    self._intelligence_gateway.get_stock_research_pack(
                        request_id=f"job-prewarm:{theme}:research-pack:{candidate.stockCode}",
                        stock_code=candidate.stockCode,
                        concept=candidate.concept or theme,
                    )
                    warmed_research_packs += 1
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{theme}: {exc}")

        return build_job_summary(
            job_name="prewarm-hot-themes",
            started_at=started_at,
            stats={
                "themes": selected_themes,
                "warmedNews": warmed_news,
                "warmedCandidates": warmed_candidates,
                "warmedConcepts": warmed_concepts,
                "warmedEvidence": warmed_evidence,
                "warmedResearchPacks": warmed_research_packs,
                "failureCount": len(failures),
                "failures": failures[:10],
            },
        )

    def _select_themes(self, themes: list[str] | None, max_themes: int) -> list[str]:
        normalized_input = [theme.strip() for theme in themes or [] if theme.strip()]
        if normalized_input:
            return normalized_input[:max_themes]

        return self._theme_provider.get_hot_concept_themes(limit=max_themes)
