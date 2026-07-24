"""Compatibility facade for intelligence endpoints backed by TuShare."""

from __future__ import annotations

from app.gateway.intelligence_gateway import intelligence_gateway
from app.providers.tushare.client import TushareProviderClient
from app.services.zhipu_search_client import ZhipuSearchClient

_CLIENT = TushareProviderClient()
_ZHIPU_CLIENT = ZhipuSearchClient()


class IntelligenceDataAdapter:
    """Adapter used by legacy routers and tests.

    Market and company evidence access remains TuShare-backed; news uses Minishare.
    """

    @staticmethod
    def get_theme_news(theme: str, days: int = 7, limit: int = 20) -> list[dict]:
        return intelligence_gateway.get_theme_news(request_id="legacy-news", theme=theme, days=days, limit=limit).data.newsItems

    @staticmethod
    def get_candidates(theme: str, limit: int = 6) -> list[dict]:
        concept_hints = _ZHIPU_CLIENT.search_theme_concepts(theme=theme, limit=5)
        return _CLIENT.get_theme_candidates(
            theme=theme,
            limit=limit,
            concept_hints=concept_hints,
        )

    @staticmethod
    def get_theme_news_strict(theme: str, days: int = 7, limit: int = 20) -> list[dict]:
        return IntelligenceDataAdapter.get_theme_news(theme=theme, days=days, limit=limit)

    @staticmethod
    def get_candidates_strict(theme: str, limit: int = 6) -> list[dict]:
        concept_hints = _ZHIPU_CLIENT.search_theme_concepts(theme=theme, limit=5)
        candidates = _CLIENT.get_theme_candidates(
            theme=theme,
            limit=limit,
            concept_hints=concept_hints,
        )
        if candidates:
            return candidates
        raise ValueError(f"主题“{theme.strip()}”暂无可用候选股数据")

    @staticmethod
    def match_theme_concepts(theme: str, limit: int = 5) -> dict:
        concept_hints = _ZHIPU_CLIENT.search_theme_concepts(theme=theme, limit=limit)
        return _CLIENT.get_theme_concepts(
            theme=theme,
            limit=limit,
            concept_hints=concept_hints,
        )

    @staticmethod
    def get_concept_rules(theme: str) -> dict:
        return _CLIENT.get_concept_rules(theme)

    @staticmethod
    def update_concept_rules(
        theme: str,
        whitelist: list[str] | None = None,
        blacklist: list[str] | None = None,
        aliases: list[str] | None = None,
    ) -> dict:
        return _CLIENT.update_concept_rules(
            theme=theme,
            whitelist=whitelist,
            blacklist=blacklist,
            aliases=aliases,
        )

    @staticmethod
    def get_company_evidence(stock_code: str, concept: str | None = None) -> dict:
        return _CLIENT.get_stock_evidence(stock_code=stock_code, concept=concept)

    @staticmethod
    def get_company_evidence_strict(stock_code: str, concept: str | None = None) -> dict:
        return _CLIENT.get_stock_evidence(stock_code=stock_code, concept=concept)

    @staticmethod
    def get_company_research_pack(stock_code: str, concept: str | None = None) -> dict:
        return _CLIENT.get_stock_research_pack(stock_code=stock_code, concept=concept)

    @staticmethod
    def get_company_research_pack_strict(stock_code: str, concept: str | None = None) -> dict:
        return _CLIENT.get_stock_research_pack(stock_code=stock_code, concept=concept)

    @staticmethod
    def get_company_evidence_batch(stock_codes: list[str], concept: str) -> list[dict]:
        return _CLIENT.get_company_evidence_batch(stock_codes=stock_codes, concept=concept)
