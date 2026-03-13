"""Mapping helpers from provider payloads to standardized contracts."""

from __future__ import annotations

from datetime import UTC, datetime

from app.contracts.intelligence import (
    CompanyEvidence,
    CompanyResearchPack,
    CompanyResearchPackReferenceItem,
    ConceptMatchItem,
    ThemeNewsItem,
)
from app.contracts.market import MarketStock, ThemeCandidate


def infer_exchange(stock_code: str) -> str:
    if stock_code.startswith(("60", "68")):
        return "SSE"
    if stock_code.startswith(("00", "30")):
        return "SZSE"
    if stock_code.startswith(("4", "8")):
        return "BSE"
    return "UNKNOWN"


def to_market_stock(raw: dict, provider: str) -> MarketStock:
    stock_code = str(raw.get("code") or raw.get("stockCode") or "").strip()
    as_of = str(raw.get("dataDate") or raw.get("asOf") or _iso_now())

    return MarketStock(
        stockCode=stock_code,
        exchange=infer_exchange(stock_code),
        market="CN-A",
        securityType="equity",
        stockName=str(raw.get("name") or raw.get("stockName") or "").strip(),
        industry=str(raw.get("industry") or "未知").strip() or "未知",
        concepts=list(raw.get("concepts") or []),
        marketCap=raw.get("marketCap"),
        floatMarketCap=raw.get("floatMarketCap"),
        turnoverRate=raw.get("turnoverRate"),
        changePercent=raw.get("changePercent"),
        pe=raw.get("pe"),
        pb=raw.get("pb"),
        roe=raw.get("roe"),
        eps=raw.get("eps"),
        revenue=raw.get("revenue"),
        netProfit=raw.get("netProfit"),
        debtRatio=raw.get("debtRatio"),
        asOf=as_of,
        provider=provider,
    )


def to_theme_candidate(raw: dict) -> ThemeCandidate:
    return ThemeCandidate(
        stockCode=str(raw.get("stockCode") or "").strip(),
        stockName=str(raw.get("stockName") or "").strip(),
        concept=str(raw.get("concept") or "").strip(),
        reason=str(raw.get("reason") or "").strip(),
        heat=float(raw.get("heat") or 0),
    )


def to_theme_news_item(raw: dict) -> ThemeNewsItem:
    return ThemeNewsItem(
        id=str(raw.get("id") or "").strip(),
        title=str(raw.get("title") or "").strip(),
        summary=str(raw.get("summary") or "").strip(),
        source=str(raw.get("source") or "").strip(),
        publishedAt=str(raw.get("publishedAt") or _iso_now()),
        sentiment=str(raw.get("sentiment") or "neutral").strip(),
        relevanceScore=float(raw.get("relevanceScore") or 0),
        relatedStocks=list(raw.get("relatedStocks") or []),
    )


def to_concept_match_item(raw: dict) -> ConceptMatchItem:
    return ConceptMatchItem(
        name=str(raw.get("name") or "").strip(),
        code=str(raw.get("code") or "").strip() or None,
        aliases=list(raw.get("aliases") or []),
        confidence=float(raw.get("confidence") or 0),
        reason=str(raw.get("reason") or "").strip(),
        source=str(raw.get("source") or "").strip(),
    )


def to_company_evidence(raw: dict) -> CompanyEvidence:
    return CompanyEvidence(
        stockCode=str(raw.get("stockCode") or "").strip(),
        companyName=str(raw.get("companyName") or "").strip(),
        concept=str(raw.get("concept") or "").strip(),
        evidenceSummary=str(raw.get("evidenceSummary") or "").strip(),
        catalysts=list(raw.get("catalysts") or []),
        risks=list(raw.get("risks") or []),
        credibilityScore=int(raw.get("credibilityScore") or 0),
        updatedAt=str(raw.get("updatedAt") or _iso_now()),
    )


def to_company_research_pack_reference(
    raw: dict,
) -> CompanyResearchPackReferenceItem:
    return CompanyResearchPackReferenceItem(
        id=str(raw.get("id") or "").strip(),
        title=str(raw.get("title") or "").strip(),
        sourceName=str(raw.get("sourceName") or "").strip(),
        snippet=str(raw.get("snippet") or "").strip(),
        extractedFact=str(raw.get("extractedFact") or "").strip(),
        url=str(raw.get("url") or "").strip() or None,
        publishedAt=str(raw.get("publishedAt") or "").strip() or None,
        credibilityScore=raw.get("credibilityScore"),
        sourceType=str(raw.get("sourceType") or "").strip() or "financial",
    )


def to_company_research_pack(raw: dict) -> CompanyResearchPack:
    return CompanyResearchPack(
        stockCode=str(raw.get("stockCode") or "").strip(),
        companyName=str(raw.get("companyName") or "").strip(),
        concept=str(raw.get("concept") or "").strip(),
        financialHighlights=list(raw.get("financialHighlights") or []),
        referenceItems=[
            to_company_research_pack_reference(item)
            for item in raw.get("referenceItems") or []
        ],
        summaryNotes=list(raw.get("summaryNotes") or []),
    )


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()
