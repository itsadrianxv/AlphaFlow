"""
Intelligence data adapter
Provides AkShare-backed data with cache and graceful degradation.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
from http.client import RemoteDisconnected
import logging
import os
import random
import re
import threading
import time
from typing import Any, Callable, TypeVar

import akshare as ak
import pandas as pd
from requests import exceptions as requests_exceptions

from app.policies.retry_policy import RetryPolicy, retry_sync
from app.services.akshare_adapter import AkShareAdapter
from app.services.theme_concept_rules_registry import ThemeConceptRulesRegistry
from app.services.zhipu_search_client import ZhipuSearchClient

LOGGER = logging.getLogger(__name__)
_T = TypeVar("_T")


def _env_int(name: str, default: int, minimum: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        parsed = int(raw_value)
    except ValueError:
        return default

    return parsed if parsed >= minimum else default


def _env_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    return raw_value.strip().lower() not in {"0", "false", "no", "off"}


_CACHE_TTL_SECONDS = _env_int("INTELLIGENCE_CACHE_TTL_SECONDS", 300, 10)
_CACHE_STALE_SECONDS = _env_int("INTELLIGENCE_CACHE_STALE_SECONDS", 1800, 30)
_AKSHARE_RETRY_POLICY = RetryPolicy(
    max_attempts=_env_int("INTELLIGENCE_AKSHARE_RETRY_ATTEMPTS", 3, 1),
    base_delay_ms=_env_int("INTELLIGENCE_AKSHARE_RETRY_BASE_DELAY_MS", 400, 0),
    multiplier=2.0,
    max_delay_ms=1800,
    jitter_ratio=0.15,
)
_ENABLE_MOCK_FALLBACK = _env_bool("INTELLIGENCE_ENABLE_MOCK_FALLBACK", True)
_TRANSIENT_AKSHARE_ERROR_MARKERS = (
    "connection aborted",
    "remote end closed connection without response",
    "connection reset by peer",
    "read timed out",
    "connect timeout",
    "temporary failure",
    "temporarily unavailable",
    "chunkedencodingerror",
    "protocolerror",
)
_GENERIC_AUTO_MATCH_KEYS = {"ai", "人工智能", "aigc"}
_CONCEPT_KEY_SPLIT_PATTERN = re.compile(r"[\s()（）\[\]【】,，、;；:：/\\|+&\-]+")


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float
    stale_until: float


_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, _CacheEntry] = {}


POSITIVE_KEYWORDS = (
    "增长",
    "突破",
    "回暖",
    "超预期",
    "创新高",
    "改善",
    "扩产",
    "中标",
    "订单",
    "利好",
)
NEGATIVE_KEYWORDS = (
    "下滑",
    "亏损",
    "减持",
    "风险",
    "承压",
    "拖累",
    "下调",
    "诉讼",
    "违约",
    "暴跌",
)

_CONCEPT_MATCH_SOURCE_WHITELIST = "whitelist"
_CONCEPT_MATCH_SOURCE_ZHIPU = "zhipu"
_CONCEPT_MATCH_SOURCE_AUTO = "auto"

_RULES_REGISTRY = ThemeConceptRulesRegistry()
_ZHIPU_SEARCH_CLIENT = ZhipuSearchClient()


class IntelligenceDataAdapter:
    """Adapter for intelligence endpoints used by LangGraph workflow."""

    @staticmethod
    def get_theme_news(theme: str, days: int = 7, limit: int = 20) -> list[dict]:
        normalized_theme = theme.strip()
        cache_key = f"theme-news:{normalized_theme}:{days}:{limit}"

        return _read_with_cache(
            cache_key=cache_key,
            fetch_fn=lambda: _fetch_theme_news_from_akshare(
                theme=normalized_theme,
                days=days,
                limit=limit,
            ),
            fallback_fn=lambda: _build_mock_theme_news(normalized_theme, days, limit),
        )

    @staticmethod
    def get_candidates(theme: str, limit: int = 6) -> list[dict]:
        normalized_theme = theme.strip()
        normalized_limit = max(1, min(limit, 30))
        rules = _RULES_REGISTRY.get_rules(normalized_theme)
        rules_version = rules.get("updatedAt") or "none"
        cache_key = f"candidates:{normalized_theme}:{normalized_limit}:{rules_version}"

        return _read_with_cache(
            cache_key=cache_key,
            fetch_fn=lambda: _fetch_candidates_from_akshare(
                normalized_theme,
                normalized_limit,
            ),
            fallback_fn=lambda: _build_mock_candidates(normalized_theme, normalized_limit),
        )

    @staticmethod
    def get_theme_news_strict(theme: str, days: int = 7, limit: int = 20) -> list[dict]:
        normalized_theme = theme.strip()
        normalized_days = max(1, min(days, 30))
        normalized_limit = max(1, min(limit, 50))

        news_items: list[dict] = []
        try:
            news_items = _fetch_theme_news_from_akshare(
                theme=normalized_theme,
                days=normalized_days,
                limit=normalized_limit,
                allow_candidate_spot_fallback=False,
            )
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning(
                "Strict theme news fetch failed for %s: %s",
                normalized_theme,
                exc,
            )
        if news_items:
            return news_items

        if _ENABLE_MOCK_FALLBACK:
            LOGGER.warning(
                "Using mock theme news fallback for %s in strict mode",
                normalized_theme,
            )
            return _build_mock_theme_news(
                normalized_theme,
                normalized_days,
                normalized_limit,
            )

        raise ValueError(f"主题“{normalized_theme}”暂无可用资讯数据")

    @staticmethod
    def get_candidates_strict(theme: str, limit: int = 6) -> list[dict]:
        normalized_theme = theme.strip()
        normalized_limit = max(1, min(limit, 30))
        candidates = _fetch_candidates_from_akshare(
            normalized_theme,
            normalized_limit,
            allow_spot_fallback=False,
        )
        if candidates:
            return candidates

        raise ValueError(f"主题“{normalized_theme}”暂无可用候选股数据")

    @staticmethod
    def match_theme_concepts(theme: str, limit: int = 5) -> dict:
        normalized_theme = theme.strip()
        normalized_limit = max(1, min(limit, 20))
        matched_rows, matched_by = _select_concepts_with_source(
            theme=normalized_theme,
            top_n=normalized_limit,
        )

        return {
            "theme": normalized_theme,
            "matchedBy": matched_by,
            "concepts": [_to_concept_match_item(item) for item in matched_rows],
        }

    @staticmethod
    def get_concept_rules(theme: str) -> dict:
        return _RULES_REGISTRY.get_rules(theme)

    @staticmethod
    def update_concept_rules(
        theme: str,
        whitelist: list[str] | None = None,
        blacklist: list[str] | None = None,
        aliases: list[str] | None = None,
    ) -> dict:
        return _RULES_REGISTRY.upsert_rules(
            theme=theme,
            whitelist=whitelist,
            blacklist=blacklist,
            aliases=aliases,
        )

    @staticmethod
    def get_company_evidence(stock_code: str, concept: str | None = None) -> dict:
        normalized_code = _normalize_stock_code(stock_code)
        concept_name = concept.strip() if concept else "通用赛道"
        cache_key = f"evidence:{normalized_code}:{concept_name}"

        return _read_with_cache(
            cache_key=cache_key,
            fetch_fn=lambda: _fetch_company_evidence_from_akshare(normalized_code, concept_name),
            fallback_fn=lambda: _build_mock_company_evidence(normalized_code, concept_name),
        )

    @staticmethod
    def get_company_evidence_strict(stock_code: str, concept: str | None = None) -> dict:
        normalized_code = _normalize_stock_code(stock_code)
        concept_name = concept.strip() if concept else "通用赛道"
        return _fetch_company_evidence_from_akshare(normalized_code, concept_name)

    @staticmethod
    def get_company_research_pack(stock_code: str, concept: str | None = None) -> dict:
        normalized_code = _normalize_stock_code(stock_code)
        concept_name = concept.strip() if concept else "通用赛道"
        cache_key = f"research-pack:{normalized_code}:{concept_name}"

        return _read_with_cache(
            cache_key=cache_key,
            fetch_fn=lambda: _fetch_company_research_pack_from_akshare(
                normalized_code, concept_name
            ),
            fallback_fn=lambda: _build_mock_company_research_pack(
                normalized_code, concept_name
            ),
        )

    @staticmethod
    def get_company_research_pack_strict(stock_code: str, concept: str | None = None) -> dict:
        normalized_code = _normalize_stock_code(stock_code)
        concept_name = concept.strip() if concept else "通用赛道"
        return _fetch_company_research_pack_from_akshare(normalized_code, concept_name)

    @staticmethod
    def get_company_evidence_batch(stock_codes: list[str], concept: str) -> list[dict]:
        concept_name = concept.strip()
        results: list[dict] = []

        for stock_code in stock_codes:
            normalized_code = _normalize_stock_code(stock_code)
            if not normalized_code:
                continue
            results.append(
                IntelligenceDataAdapter.get_company_evidence(
                    stock_code=normalized_code,
                    concept=concept_name,
                )
            )

        return results


def _read_with_cache(
    cache_key: str,
    fetch_fn: Callable[[], _T],
    fallback_fn: Callable[[], _T] | None = None,
) -> _T:
    fresh_value = _read_cache(cache_key, allow_stale=False)
    if fresh_value is not None:
        return fresh_value

    stale_value = _read_cache(cache_key, allow_stale=True)

    try:
        value = fetch_fn()
        if _is_useful_result(value):
            _write_cache(cache_key, value)
            return value

        if stale_value is not None:
            LOGGER.warning("Using stale cache for key '%s' due to empty fresh payload", cache_key)
            return stale_value
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("AkShare fetch failed for '%s': %s", cache_key, exc)
        if stale_value is not None:
            LOGGER.warning("Using stale cache for key '%s'", cache_key)
            return stale_value

    if fallback_fn and _ENABLE_MOCK_FALLBACK:
        fallback_value = fallback_fn()
        _write_cache(cache_key, fallback_value, ttl_seconds=min(_CACHE_TTL_SECONDS, 120))
        return fallback_value

    if stale_value is not None:
        return stale_value

    return fetch_fn()


def _is_useful_result(value: Any) -> bool:
    if isinstance(value, pd.DataFrame):
        return not value.empty
    if isinstance(value, list):
        return len(value) > 0
    if isinstance(value, dict):
        return len(value) > 0
    return value is not None


def _read_cache(cache_key: str, allow_stale: bool) -> Any | None:
    now = time.time()
    with _CACHE_LOCK:
        entry = _CACHE.get(cache_key)
        if not entry:
            return None
        if entry.expires_at >= now:
            return entry.value
        if allow_stale and entry.stale_until >= now:
            return entry.value
        if entry.stale_until < now:
            _CACHE.pop(cache_key, None)
    return None


def _write_cache(cache_key: str, value: Any, ttl_seconds: int | None = None) -> None:
    ttl = ttl_seconds or _CACHE_TTL_SECONDS
    now = time.time()
    entry = _CacheEntry(
        value=value,
        expires_at=now + ttl,
        stale_until=now + ttl + _CACHE_STALE_SECONDS,
    )
    with _CACHE_LOCK:
        _CACHE[cache_key] = entry


def _get_spot_snapshot(stock_codes: list[str] | None = None) -> pd.DataFrame:
    latest = AkShareAdapter.get_a_share_spot_frame(stock_codes=stock_codes)
    if latest.empty:
        raise ValueError("AkShare spot snapshot is empty")
    return latest


def _fetch_candidates_from_akshare(
    theme: str,
    limit: int,
    *,
    allow_spot_fallback: bool = True,
) -> list[dict]:
    concept_rows = _select_concepts(theme, top_n=3)

    candidates_by_code: dict[str, dict] = {}

    concept_frames: list[tuple[dict, pd.DataFrame]] = []
    max_workers = max(1, min(3, len(concept_rows)))
    if concept_rows:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(_load_concept_constituents, concept): concept
                for concept in concept_rows
            }
            for future in as_completed(future_map):
                concept = future_map[future]
                try:
                    members_df = future.result()
                except Exception as exc:  # noqa: BLE001
                    LOGGER.warning(
                        "Failed to load concept constituents %s: %s",
                        concept.get("conceptCode") or concept.get("concept"),
                        exc,
                    )
                    continue

                if members_df.empty:
                    continue
                concept_frames.append((concept, members_df))

    for concept, members_df in concept_frames:

        code_column = _find_column(members_df, ("代码", "code"))
        name_column = _find_column(members_df, ("名称", "name"))
        change_column = _find_column(members_df, ("涨跌幅", "涨跌", "change"))
        turnover_column = _find_column(members_df, ("换手率", "turnover"))
        pe_column = _find_column(members_df, ("市盈率", "pe"))

        if not code_column or not name_column:
            continue

        for _, row in members_df.iterrows():
            stock_code = _normalize_stock_code(row.get(code_column))
            if not stock_code:
                continue

            stock_name = str(row.get(name_column, "")).strip()
            if not stock_name:
                continue

            change_pct = _to_float(row.get(change_column))
            turnover = _to_float(row.get(turnover_column))
            pe_ratio = _to_float(row.get(pe_column))
            heat = _score_candidate_heat(
                concept_heat=concept["heat"],
                change_pct=change_pct,
                turnover=turnover,
                pe_ratio=pe_ratio,
            )
            reason = _build_candidate_reason(
                concept_name=concept["concept"],
                change_pct=change_pct,
                turnover=turnover,
                pe_ratio=pe_ratio,
            )

            existing = candidates_by_code.get(stock_code)
            if not existing or heat > existing["heat"]:
                candidates_by_code[stock_code] = {
                    "stockCode": stock_code,
                    "stockName": stock_name,
                    "reason": reason,
                    "heat": heat,
                    "concept": concept["concept"],
                }

    candidates = sorted(
        candidates_by_code.values(),
        key=lambda item: item["heat"],
        reverse=True,
    )
    top_candidates = candidates[:limit]
    if top_candidates:
        return top_candidates

    if not allow_spot_fallback:
        return []

    return _build_candidates_from_spot(theme, limit)


def _load_concept_constituents(concept: dict) -> pd.DataFrame:
    concept_symbol = concept.get("conceptCode") or concept.get("concept")
    return AkShareAdapter.get_concept_constituents_frame(
        str(concept.get("concept") or concept_symbol),
        concept_code=str(concept_symbol),
    )


def _build_candidates_from_spot(theme: str, limit: int) -> list[dict]:
    spot_df = _get_spot_snapshot()

    code_column = _find_column(spot_df, ("代码", "code"))
    name_column = _find_column(spot_df, ("名称", "name"))
    turnover_column = _find_column(spot_df, ("换手率", "turnover"))
    change_column = _find_column(spot_df, ("涨跌幅", "涨跌", "change"))
    pe_column = _find_column(spot_df, ("市盈率", "pe"))

    if not code_column or not name_column:
        return []

    working_df = spot_df.copy()
    working_df["__turnover__"] = (
        pd.to_numeric(working_df[turnover_column], errors="coerce").fillna(0)
        if turnover_column
        else 0
    )
    working_df["__change__"] = (
        pd.to_numeric(working_df[change_column], errors="coerce").fillna(0)
        if change_column
        else 0
    )

    working_df = working_df.sort_values(
        by=["__turnover__", "__change__"], ascending=False
    ).head(limit * 4)

    results: list[dict] = []
    for _, row in working_df.iterrows():
        stock_code = _normalize_stock_code(row.get(code_column))
        if not stock_code:
            continue

        stock_name = str(row.get(name_column, "")).strip()
        if not stock_name:
            continue

        change_pct = _to_float(row.get(change_column))
        turnover = _to_float(row.get(turnover_column))
        pe_ratio = _to_float(row.get(pe_column))
        heat = _score_candidate_heat(
            concept_heat=55.0,
            change_pct=change_pct,
            turnover=turnover,
            pe_ratio=pe_ratio,
        )

        results.append(
            {
                "stockCode": stock_code,
                "stockName": stock_name,
                "reason": _build_candidate_reason(
                    concept_name=theme,
                    change_pct=change_pct,
                    turnover=turnover,
                    pe_ratio=pe_ratio,
                ),
                "heat": heat,
                "concept": theme,
            }
        )

    deduped: dict[str, dict] = {}
    for item in results:
        existing = deduped.get(item["stockCode"])
        if not existing or item["heat"] > existing["heat"]:
            deduped[item["stockCode"]] = item

    return sorted(deduped.values(), key=lambda item: item["heat"], reverse=True)[:limit]


def _fetch_theme_news_from_akshare(
    theme: str,
    days: int,
    limit: int,
    *,
    allow_candidate_spot_fallback: bool = True,
) -> list[dict]:
    candidate_stocks: list[dict] = []
    try:
        candidate_stocks = _fetch_candidates_from_akshare(
            theme=theme,
            limit=min(3, max(1, limit)),
            allow_spot_fallback=allow_candidate_spot_fallback,
        )
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Failed to fetch theme candidates for %s: %s", theme, exc)

    news_items: list[dict] = []
    max_workers = max(1, min(4, len(candidate_stocks)))
    if candidate_stocks:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(
                    _fetch_stock_news,
                    stock_code=candidate["stockCode"],
                    theme=theme,
                    days=days,
                    limit=4,
                ): candidate
                for candidate in candidate_stocks
            }
            for future in as_completed(future_map):
                try:
                    news_items.extend(future.result())
                except Exception as exc:  # noqa: BLE001
                    candidate = future_map[future]
                    LOGGER.warning(
                        "Failed to fetch stock news for %s: %s",
                        candidate.get("stockCode"),
                        exc,
                    )

    if not news_items:
        related_stocks = [
            str(candidate.get("stockCode") or "").strip()
            for candidate in candidate_stocks
            if str(candidate.get("stockCode") or "").strip()
        ]
        news_items.extend(
            _build_concept_snapshot_news(
                theme=theme,
                limit=limit,
                related_stocks=related_stocks,
            )
        )

    if not news_items:
        return []

    deduped = {item["id"]: item for item in news_items if item.get("id")}
    result = sorted(
        deduped.values(),
        key=lambda item: (item["publishedAt"], item["relevanceScore"]),
        reverse=True,
    )
    return result[:limit]


def _fetch_stock_news(stock_code: str, theme: str, days: int, limit: int) -> list[dict]:
    try:
        news_df = _call_akshare_with_retry(
            f"stock_news_em:{stock_code}",
            lambda: ak.stock_news_em(symbol=stock_code),
        )
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Failed to fetch stock news for %s: %s", stock_code, exc)
        return []

    if news_df.empty:
        return []

    title_column = _find_column(news_df, ("标题", "新闻标题", "title"))
    summary_column = _find_column(news_df, ("内容", "摘要", "新闻内容", "content"))
    source_column = _find_column(news_df, ("来源", "文章来源", "source"))
    time_column = _find_column(news_df, ("时间", "发布时间", "date"))
    link_column = _find_column(news_df, ("链接", "地址", "url"))

    if not title_column:
        return []

    results: list[dict] = []
    for _, row in news_df.head(limit).iterrows():
        title = _safe_text(row.get(title_column))
        summary = _safe_text(row.get(summary_column)) if summary_column else ""
        if not title:
            continue

        published_at = _to_iso_datetime(row.get(time_column))
        if not _is_news_within_days(published_at, days):
            continue
        source = _safe_text(row.get(source_column)) if source_column else "akshare:stock_news"
        link = _safe_text(row.get(link_column)) if link_column else ""
        merged_text = f"{title} {summary}".strip()
        sentiment = _infer_sentiment(merged_text)
        relevance_score = _compute_relevance_score(theme, merged_text, stock_code)

        digest = hashlib.md5(
            f"{stock_code}:{title}:{published_at}:{link}".encode("utf-8")
        ).hexdigest()

        results.append(
            {
                "id": digest[:16],
                "title": title,
                "summary": summary or title[:120],
                "source": source,
                "publishedAt": published_at,
                "sentiment": sentiment,
                "relevanceScore": relevance_score,
                "relatedStocks": [stock_code],
            }
        )

    return results


def _build_concept_snapshot_news(
    theme: str,
    limit: int,
    related_stocks: list[str] | None = None,
) -> list[dict]:
    concept_rows = _select_concepts(theme, top_n=max(3, limit))
    now = datetime.now(UTC)

    results: list[dict] = []
    for index, concept in enumerate(concept_rows[:limit]):
        concept_name = concept["concept"]
        change_pct = concept["changePct"]
        leader = concept["leaderStock"] or "暂无领涨股"
        up_count = concept["upCount"]
        down_count = concept["downCount"]

        sentiment = "neutral"
        if change_pct >= 1:
            sentiment = "positive"
        elif change_pct <= -1:
            sentiment = "negative"

        summary = (
            f"{concept_name}板块最新涨跌幅{change_pct:.2f}%，"
            f"上涨家数{up_count}、下跌家数{down_count}，"
            f"领涨股为{leader}。"
        )
        published_at = (now - timedelta(minutes=index * 20)).isoformat()
        digest = hashlib.md5(
            f"{theme}:{concept_name}:{published_at}".encode("utf-8")
        ).hexdigest()

        results.append(
            {
                "id": digest[:16],
                "title": f"{concept_name}板块景气快照",
                "summary": summary,
                "source": "akshare:concept_snapshot",
                "publishedAt": published_at,
                "sentiment": sentiment,
                "relevanceScore": _compute_relevance_score(theme, summary, None),
                "relatedStocks": related_stocks or [],
            }
        )

    return results


def _fetch_company_evidence_from_akshare(stock_code: str, concept: str) -> dict:
    snapshots = AkShareAdapter.get_stocks_by_codes([stock_code])
    if not snapshots:
        raise ValueError(f"Stock code not found in AkShare snapshot: {stock_code}")

    snapshot = snapshots[0]
    company_name = _safe_text(snapshot.get("name")) or _guess_company_name(stock_code)
    industry_name = _safe_text(snapshot.get("industry")) or "未知行业"
    change_pct = _to_float(snapshot.get("changePercent"))
    turnover = _to_float(snapshot.get("turnoverRate"))
    pe_ratio = _to_float(snapshot.get("pe"))
    market_cap = _to_float(snapshot.get("marketCap"))
    data_quality = (
        "partial"
        if str(snapshot.get("dataQuality") or "").strip().lower() == "partial"
        else "complete"
    )
    warning_codes = _dedupe_warning_codes(snapshot.get("warnings"))

    stock_news = _fetch_stock_news(
        stock_code=stock_code,
        theme=concept,
        days=30,
        limit=3,
    )
    positive_news = sum(1 for item in stock_news if item["sentiment"] == "positive")
    negative_news = sum(1 for item in stock_news if item["sentiment"] == "negative")
    neutral_news = sum(1 for item in stock_news if item["sentiment"] == "neutral")

    base_score = 62.0
    if change_pct is not None:
        base_score += max(-8, min(8, change_pct * 1.4))
    if turnover is not None:
        base_score += max(-3, min(10, turnover * 0.8))
    if pe_ratio is not None:
        if 0 < pe_ratio <= 45:
            base_score += 6
        elif pe_ratio > 80:
            base_score -= 5
    if market_cap is not None and market_cap > 0:
        base_score += min(6, max(0, market_cap / 10000))

    base_score += positive_news * 2.5
    base_score -= negative_news * 2.5
    base_score += neutral_news * 0.5

    credibility_score = int(max(45, min(95, round(base_score))))

    catalysts: list[str] = []
    risks: list[str] = []

    if change_pct is not None:
        if change_pct >= 2:
            catalysts.append(f"股价动量较强，近期涨跌幅为 {change_pct:.2f}%")
        elif change_pct <= -2:
            risks.append(f"短线波动偏弱，近期涨跌幅为 {change_pct:.2f}%")

    if turnover is not None:
        if turnover >= 3:
            catalysts.append(f"市场活跃度较高，换手率 {turnover:.2f}%")
        elif turnover < 0.8:
            risks.append(f"交易活跃度偏弱，换手率仅 {turnover:.2f}%")

    if pe_ratio is not None:
        if pe_ratio > 80:
            risks.append(f"估值偏高，动态市盈率 {pe_ratio:.2f}")
        elif 0 < pe_ratio <= 35:
            catalysts.append(f"估值相对可控，动态市盈率 {pe_ratio:.2f}")

    for item in stock_news[:2]:
        if item["sentiment"] == "positive":
            catalysts.append(item["title"])
        elif item["sentiment"] == "negative":
            risks.append(item["title"])

    if not catalysts:
        catalysts.append("近期数据未见显著恶化，维持跟踪")
    if not risks:
        risks.append("需关注行业轮动与主题热度回落风险")

    evidence_summary = (
        f"{company_name}（{stock_code}）当前属于{industry_name}，"
        f"围绕“{concept}”主题的可信度评估为 {credibility_score} 分。"
    )

    return {
        "stockCode": stock_code,
        "companyName": company_name,
        "concept": concept,
        "evidenceSummary": evidence_summary,
        "catalysts": catalysts[:3],
        "risks": risks[:3],
        "credibilityScore": credibility_score,
        "dataQuality": data_quality,
        "warnings": warning_codes,
        "updatedAt": datetime.now(UTC).isoformat(),
    }


def _fetch_company_research_pack_from_akshare(stock_code: str, concept: str) -> dict:
    evidence = _fetch_company_evidence_from_akshare(stock_code, concept)
    snapshots = AkShareAdapter.get_stocks_by_codes([stock_code])
    snapshot = snapshots[0] if snapshots else {}
    warning_codes = _dedupe_warning_codes(
        [*list(evidence.get("warnings") or []), *list(snapshot.get("warnings") or [])]
    )
    data_quality = "partial"
    if (
        str(evidence.get("dataQuality") or "").strip().lower() != "partial"
        and str(snapshot.get("dataQuality") or "").strip().lower() != "partial"
    ):
        data_quality = "complete"

    financial_highlights = [
        line
        for line in [
            _format_metric_line("总市值", snapshot.get("marketCap"), "亿元"),
            _format_metric_line("流通市值", snapshot.get("floatMarketCap"), "亿元"),
            _format_metric_line("市盈率", snapshot.get("pe")),
            _format_metric_line("市净率", snapshot.get("pb")),
            _format_metric_line("ROE", snapshot.get("roe")),
            _format_metric_line("涨跌幅", snapshot.get("changePercent"), "%"),
            _format_metric_line("换手率", snapshot.get("turnoverRate"), "%"),
        ]
        if line
    ]

    summary_notes = [evidence["evidenceSummary"], *evidence["catalysts"], *evidence["risks"]]

    reference_items = [
        {
            "id": f"{stock_code}:financial_snapshot",
            "title": f"{evidence['companyName']} 财务快照",
            "sourceName": "akshare:stock_snapshot",
            "snippet": "基于 AkShare 行情快照提取的结构化财务指标。",
            "extractedFact": "；".join(financial_highlights[:3])
            or evidence["evidenceSummary"],
            "publishedAt": evidence["updatedAt"],
            "credibilityScore": _normalize_credibility_score(
                evidence["credibilityScore"]
            ),
            "sourceType": "financial",
        }
    ]

    return {
        "stockCode": stock_code,
        "companyName": evidence["companyName"],
        "concept": concept,
        "financialHighlights": financial_highlights,
        "referenceItems": reference_items,
        "summaryNotes": summary_notes[:6],
        "dataQuality": data_quality,
        "warnings": warning_codes,
    }


def _select_concepts(theme: str, top_n: int) -> list[dict]:
    concept_rows, _ = _select_concepts_with_source(theme=theme, top_n=top_n)
    return concept_rows


def _select_concepts_with_source(theme: str, top_n: int) -> tuple[list[dict], str]:
    normalized_top_n = max(1, min(top_n, 20))
    all_rows = _load_concept_rows_from_akshare(theme)
    if not all_rows:
        return [], _CONCEPT_MATCH_SOURCE_AUTO

    rules = _RULES_REGISTRY.get_rules(theme)
    whitelist = rules.get("whitelist") if isinstance(rules.get("whitelist"), list) else []
    blacklist = rules.get("blacklist") if isinstance(rules.get("blacklist"), list) else []

    if whitelist:
        whitelist_rows = _match_by_whitelist(all_rows=all_rows, whitelist=whitelist)
        whitelist_rows = _apply_blacklist_filter(whitelist_rows, blacklist)
        if whitelist_rows:
            return whitelist_rows[:normalized_top_n], _CONCEPT_MATCH_SOURCE_WHITELIST

    auto_rows = _match_by_auto(theme=theme, all_rows=all_rows, limit=max(6, normalized_top_n))
    auto_rows = _apply_blacklist_filter(auto_rows, blacklist)
    if auto_rows:
        return auto_rows[:normalized_top_n], _CONCEPT_MATCH_SOURCE_AUTO

    zhipu_rows = _match_by_zhipu(
        theme=theme,
        all_rows=all_rows,
        limit=max(5, normalized_top_n * 2),
    )
    zhipu_rows = _apply_blacklist_filter(zhipu_rows, blacklist)
    if zhipu_rows:
        return zhipu_rows[:normalized_top_n], _CONCEPT_MATCH_SOURCE_ZHIPU

    return [], _CONCEPT_MATCH_SOURCE_AUTO


def _load_concept_rows_from_akshare(theme: str) -> list[dict]:
    concept_df = AkShareAdapter.get_concept_catalog_frame()
    if concept_df.empty:
        return []

    name_column = _find_column(concept_df, ("name", "板块名称", "概念名称", "名称"))
    code_column = _find_column(concept_df, ("code", "板块代码", "代码"))
    change_column = _find_column(concept_df, ("涨跌幅", "涨跌", "change"))
    leader_column = _find_column(concept_df, ("领涨股票", "领涨"))
    up_count_column = _find_column(concept_df, ("上涨家数", "上涨"))
    down_count_column = _find_column(concept_df, ("下跌家数", "下跌"))

    if not name_column:
        return []

    normalized_theme = _normalize_text(theme)
    rows: list[dict] = []
    for index, row in enumerate(concept_df.iterrows()):
        _, series = row
        concept_name = _safe_text(series.get(name_column))
        if not concept_name:
            continue

        concept_keys = _build_concept_match_keys(concept_name)
        matched_keys = [
            key
            for key in concept_keys
            if key and normalized_theme and key in normalized_theme
        ]
        specific_matched_keys = [
            key for key in matched_keys if not _is_generic_auto_key(key)
        ]
        max_matched_length = max((len(key) for key in matched_keys), default=0)
        max_specific_length = max((len(key) for key in specific_matched_keys), default=0)
        match_score = max_specific_length * 10 + len(specific_matched_keys) * 3
        if match_score <= 0:
            match_score = max_matched_length * 6 + len(matched_keys) * 2

        confidence_base = 0.45
        if max_specific_length > 0:
            confidence_base += min(0.35, max_specific_length / 18)
        elif max_matched_length > 0:
            confidence_base += min(0.2, max_matched_length / 24)
        confidence_base += min(0.08, len(specific_matched_keys) * 0.03)
        change_pct = _to_float(series.get(change_column)) or 0.0

        rows.append(
            {
                "concept": concept_name,
                "conceptCode": _safe_text(series.get(code_column)) if code_column else "",
                "changePct": change_pct,
                "leaderStock": _safe_text(series.get(leader_column)) if leader_column else "",
                "upCount": int(_to_float(series.get(up_count_column)) or 0)
                if up_count_column
                else 0,
                "downCount": int(_to_float(series.get(down_count_column)) or 0)
                if down_count_column
                else 0,
                "heat": max(35.0, min(95.0, 58.0 + change_pct * 4)),
                "matchScore": float(match_score),
                "textMatchScore": float(max_matched_length),
                "confidence": round(max(0.4, min(0.9, confidence_base)), 2),
                "aliases": [],
                "reason": "",
                "source": _CONCEPT_MATCH_SOURCE_AUTO,
                "conceptKeys": concept_keys,
                "matchedKeys": matched_keys,
                "matchedSpecificKeys": specific_matched_keys,
                "matchedKeyMaxLength": max_matched_length,
                "matchedSpecificKeyMaxLength": max_specific_length,
                "matchedKeyCount": len(matched_keys),
                "matchedSpecificKeyCount": len(specific_matched_keys),
                "catalogOrder": index,
            }
        )

    return rows


def _build_concept_match_keys(concept_name: str) -> list[str]:
    normalized_full_name = _normalize_text(concept_name)
    keys: list[str] = []
    if normalized_full_name:
        keys.append(normalized_full_name)

    for fragment in _CONCEPT_KEY_SPLIT_PATTERN.split(concept_name):
        normalized_fragment = _normalize_text(fragment)
        if normalized_fragment:
            keys.append(normalized_fragment)

    for fragment in re.findall(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+", concept_name):
        normalized_fragment = _normalize_text(fragment)
        if normalized_fragment:
            keys.append(normalized_fragment)

    deduped: list[str] = []
    seen: set[str] = set()
    for key in keys:
        if key in seen:
            continue
        seen.add(key)
        deduped.append(key)

    return deduped


def _is_generic_auto_key(value: str) -> bool:
    normalized_value = _normalize_text(value)
    return normalized_value in _GENERIC_AUTO_MATCH_KEYS


def _theme_has_non_generic_signal(theme: str) -> bool:
    normalized_theme = _normalize_text(theme)
    if not normalized_theme:
        return False

    remainder = normalized_theme
    for generic_key in sorted(_GENERIC_AUTO_MATCH_KEYS, key=len, reverse=True):
        remainder = remainder.replace(_normalize_text(generic_key), "")

    return len(remainder) >= 2


def _ranked_match_lengths(row: dict, *, prefer_specific: bool) -> tuple[int, int]:
    if prefer_specific:
        return (
            int(row.get("matchedSpecificKeyMaxLength") or 0),
            int(row.get("matchedSpecificKeyCount") or 0),
        )

    return (
        int(row.get("matchedKeyMaxLength") or 0),
        int(row.get("matchedKeyCount") or 0),
    )


def _call_akshare_with_retry(operation_name: str, fetch_fn: Callable[[], _T]) -> _T:
    return retry_sync(
        operation=fetch_fn,
        policy=_AKSHARE_RETRY_POLICY,
        should_retry=_is_transient_akshare_error,
        on_retry=lambda attempt, exc, sleep_ms: LOGGER.warning(
            "Transient AkShare failure for %s (attempt %s/%s): %s; retrying in %.0fms",
            operation_name,
            attempt,
            _AKSHARE_RETRY_POLICY.max_attempts,
            exc,
            sleep_ms,
        ),
    )


def _load_cached_akshare_payload(
    cache_key: str,
    ttl_seconds: int,
    operation_name: str,
    fetch_fn: Callable[[], _T],
) -> _T:
    fresh_value = _read_cache(cache_key, allow_stale=False)
    if fresh_value is not None:
        return _clone_cached_payload(fresh_value)

    stale_value = _read_cache(cache_key, allow_stale=True)

    try:
        value = _call_akshare_with_retry(operation_name, fetch_fn)
        if _is_useful_result(value):
            _write_cache(cache_key, value, ttl_seconds=ttl_seconds)
            return _clone_cached_payload(value)

        if stale_value is not None:
            LOGGER.warning(
                "Using stale AkShare cache for %s due to empty payload",
                operation_name,
            )
            return _clone_cached_payload(stale_value)

        return value
    except Exception as exc:  # noqa: BLE001
        if stale_value is not None:
            LOGGER.warning(
                "Using stale AkShare cache for %s after upstream failure: %s",
                operation_name,
                exc,
            )
            return _clone_cached_payload(stale_value)
        raise


def _clone_cached_payload(value: _T) -> _T:
    if isinstance(value, pd.DataFrame):
        return value.copy(deep=True)
    return value


def _is_transient_akshare_error(exc: Exception) -> bool:
    transient_request_errors = (
        requests_exceptions.ConnectionError,
        requests_exceptions.Timeout,
        requests_exceptions.ChunkedEncodingError,
    )
    transient_error_types = transient_request_errors + (RemoteDisconnected,)

    if isinstance(exc, transient_error_types):
        return True

    for current in _iter_exception_chain(exc):
        if isinstance(current, transient_error_types):
            return True

        message = str(current).lower()
        if any(marker in message for marker in _TRANSIENT_AKSHARE_ERROR_MARKERS):
            return True

    return False


def _iter_exception_chain(exc: Exception):
    current: BaseException | None = exc
    seen: set[int] = set()

    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current

        next_error: BaseException | None = None
        if current.__cause__ is not None:
            next_error = current.__cause__
        elif current.__context__ is not None:
            next_error = current.__context__
        elif len(current.args) > 1:
            nested = current.args[1]
            if isinstance(nested, BaseException):
                next_error = nested

        current = next_error


def _match_by_whitelist(all_rows: list[dict], whitelist: list[str]) -> list[dict]:
    matched_rows: list[dict] = []
    seen: set[str] = set()

    for whitelist_item in whitelist:
        matched = _match_term_to_concept(term=whitelist_item, all_rows=all_rows)
        if not matched:
            continue

        concept_key = _normalize_text(matched.get("concept"))
        if concept_key in seen:
            continue

        seen.add(concept_key)
        enriched = dict(matched)
        enriched["source"] = _CONCEPT_MATCH_SOURCE_WHITELIST
        enriched["confidence"] = max(float(enriched.get("confidence") or 0.0), 0.99)
        enriched["reason"] = f"命中白名单概念：{whitelist_item}"
        enriched["matchScore"] = max(float(enriched.get("matchScore") or 0.0), 12.0)
        matched_rows.append(enriched)

    return matched_rows


def _match_by_zhipu(theme: str, all_rows: list[dict], limit: int) -> list[dict]:
    candidates = _ZHIPU_SEARCH_CLIENT.search_theme_concepts(theme=theme, limit=limit)
    if not candidates:
        return []

    deduped: dict[str, dict] = {}
    for candidate in candidates:
        candidate_name = _safe_text(candidate.get("name"))
        if not candidate_name:
            continue

        confidence = _to_float(candidate.get("confidence")) or 0.0
        if confidence < 0.55:
            continue

        aliases = candidate.get("aliases") if isinstance(candidate.get("aliases"), list) else []
        matched_row = None
        search_terms = [candidate_name, *[str(alias) for alias in aliases]]
        for term in search_terms:
            matched_row = _match_term_to_concept(term=term, all_rows=all_rows)
            if matched_row:
                break

        if not matched_row:
            continue

        enriched = dict(matched_row)
        enriched["aliases"] = [str(alias).strip() for alias in aliases if str(alias).strip()]
        enriched["confidence"] = round(max(confidence, float(enriched.get("confidence") or 0.0)), 2)
        enriched["reason"] = _safe_text(candidate.get("reason")) or f"智谱 Web Search 匹配主题“{theme}”"
        enriched["source"] = "zhipu_web_search"
        enriched["matchScore"] = float(enriched.get("matchScore") or 0.0) + enriched["confidence"] * 10

        concept_key = _normalize_text(enriched.get("concept"))
        existing = deduped.get(concept_key)
        if not existing or enriched["confidence"] > float(existing.get("confidence") or 0.0):
            deduped[concept_key] = enriched

    ranked = sorted(
        deduped.values(),
        key=lambda item: (
            -float(item.get("confidence") or 0.0),
            -float(item.get("matchScore") or 0.0),
            int(item.get("catalogOrder") or 0),
        ),
    )
    return ranked[:limit]


def _match_by_auto(theme: str, all_rows: list[dict], limit: int) -> list[dict]:
    relevant_rows = [
        row for row in all_rows if int(row.get("matchedKeyCount") or 0) > 0
    ]
    if not relevant_rows:
        return []

    prefer_specific = any(
        int(row.get("matchedSpecificKeyCount") or 0) > 0 for row in relevant_rows
    )
    if prefer_specific:
        relevant_rows = [
            row for row in relevant_rows if int(row.get("matchedSpecificKeyCount") or 0) > 0
        ]
        if not relevant_rows:
            return []
    elif _theme_has_non_generic_signal(theme):
        return []

    ranked = sorted(
        relevant_rows,
        key=lambda item: (
            -_ranked_match_lengths(item, prefer_specific=prefer_specific)[0],
            -_ranked_match_lengths(item, prefer_specific=prefer_specific)[1],
            int(item.get("catalogOrder") or 0),
        ),
    )

    results: list[dict] = []
    for row in ranked[:limit]:
        enriched = dict(row)
        enriched["source"] = _CONCEPT_MATCH_SOURCE_AUTO
        enriched["reason"] = _build_auto_reason(theme=theme, row=row)
        top_match_length, matched_count = _ranked_match_lengths(
            enriched,
            prefer_specific=prefer_specific,
        )
        confidence = 0.5 + min(0.24, top_match_length / 18) + min(0.1, matched_count * 0.04)
        if prefer_specific:
            confidence += 0.05
        confidence = max(0.55, min(0.88, confidence))
        enriched["confidence"] = round(confidence, 2)
        results.append(enriched)

    return results


def _match_term_to_concept(term: str, all_rows: list[dict]) -> dict | None:
    normalized_term = _normalize_text(term)
    if not normalized_term:
        return None

    best_score = float("-inf")
    best_row: dict | None = None

    for row in all_rows:
        concept_keys = row.get("conceptKeys") if isinstance(row.get("conceptKeys"), list) else []
        if not concept_keys:
            continue

        score = float("-inf")
        for concept_key in concept_keys:
            if concept_key == normalized_term:
                score = max(score, 140.0 + len(concept_key))
                continue
            if normalized_term in concept_key or concept_key in normalized_term:
                score = max(score, 100.0 + min(len(concept_key), len(normalized_term)))

        if score == float("-inf"):
            continue

        score += float(row.get("matchScore") or 0.0)
        if score > best_score:
            best_score = score
            best_row = row

    return best_row


def _find_row_by_code(code: str, all_rows: list[dict]) -> dict | None:
    normalized_code = _normalize_text(code)
    if not normalized_code:
        return None

    for row in all_rows:
        concept_code = _normalize_text(_safe_text(row.get("conceptCode")))
        if concept_code and concept_code == normalized_code:
            return row

    return None


def _apply_blacklist_filter(rows: list[dict], blacklist: list[str]) -> list[dict]:
    if not blacklist:
        return rows

    filtered_rows: list[dict] = []
    for row in rows:
        concept_name = _safe_text(row.get("concept"))
        aliases = row.get("aliases") if isinstance(row.get("aliases"), list) else []
        if _is_blacklisted(concept_name, aliases, blacklist):
            continue
        filtered_rows.append(row)

    return filtered_rows


def _is_blacklisted(concept_name: str, aliases: list[str], blacklist: list[str]) -> bool:
    candidates = [concept_name, *aliases]

    for black_item in blacklist:
        normalized_black = _normalize_text(black_item)
        if not normalized_black:
            continue

        for candidate in candidates:
            normalized_candidate = _normalize_text(candidate)
            if not normalized_candidate:
                continue

            if normalized_black == normalized_candidate:
                return True

            if len(normalized_black) >= 2 and (
                normalized_black in normalized_candidate
                or normalized_candidate in normalized_black
            ):
                return True

    return False


def _to_concept_match_item(row: dict) -> dict:
    source = _safe_text(row.get("source")) or _CONCEPT_MATCH_SOURCE_AUTO
    confidence = _to_float(row.get("confidence")) or 0.0

    return {
        "name": _safe_text(row.get("concept")),
        "code": _safe_text(row.get("conceptCode")) or None,
        "aliases": row.get("aliases") if isinstance(row.get("aliases"), list) else [],
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
        "reason": _safe_text(row.get("reason")),
        "source": source,
    }


def _build_auto_reason(theme: str, row: dict) -> str:
    concept_name = _safe_text(row.get("concept"))
    matched_specific_keys = [
        str(item)
        for item in row.get("matchedSpecificKeys", [])
        if str(item).strip()
    ]
    matched_keys = [str(item) for item in row.get("matchedKeys", []) if str(item).strip()]
    effective_keys = matched_specific_keys or matched_keys
    if effective_keys:
        return (
            f"本地自动匹配：主题“{theme}”命中概念子串“{effective_keys[0]}”，"
            f"关联到概念“{concept_name}”"
        )
    return f"本地自动匹配：主题“{theme}”与概念“{concept_name}”文本相关性较高"


def _normalize_text(text: Any) -> str:
    if text is None:
        return ""
    lowered = str(text).strip().casefold()
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", lowered)


def _score_candidate_heat(
    concept_heat: float,
    change_pct: float | None,
    turnover: float | None,
    pe_ratio: float | None,
) -> float:
    score = concept_heat * 0.55
    score += (change_pct or 0) * 3.2
    score += (turnover or 0) * 1.7

    if pe_ratio is not None:
        if 0 < pe_ratio <= 35:
            score += 3
        elif pe_ratio > 90:
            score -= 3

    return max(25.0, min(100.0, round(score, 2)))


def _build_candidate_reason(
    concept_name: str,
    change_pct: float | None,
    turnover: float | None,
    pe_ratio: float | None,
) -> str:
    parts = [f"来自「{concept_name}」概念"]
    if change_pct is not None:
        parts.append(f"当日涨跌幅 {change_pct:.2f}%")
    if turnover is not None:
        parts.append(f"换手率 {turnover:.2f}%")
    if pe_ratio is not None:
        parts.append(f"动态市盈率 {pe_ratio:.2f}")
    return "，".join(parts)


def _compute_relevance_score(theme: str, text: str, stock_code: str | None) -> float:
    lowered_text = text.lower()
    lowered_theme = theme.lower()
    score = 0.38

    if lowered_theme and lowered_theme in lowered_text:
        score += 0.26

    for token in _tokenize(theme):
        if token and token in lowered_text:
            score += 0.08

    if stock_code and stock_code in lowered_text:
        score += 0.1

    return round(max(0.2, min(0.95, score)), 2)


def _infer_sentiment(text: str) -> str:
    positive_hits = sum(1 for word in POSITIVE_KEYWORDS if word in text)
    negative_hits = sum(1 for word in NEGATIVE_KEYWORDS if word in text)

    if positive_hits - negative_hits >= 1:
        return "positive"
    if negative_hits - positive_hits >= 1:
        return "negative"
    return "neutral"


def _find_column(df: pd.DataFrame, keywords: tuple[str, ...]) -> str | None:
    if df.empty:
        return None

    columns = [str(column) for column in df.columns]
    lowered_columns = [column.lower() for column in columns]

    for keyword in keywords:
        lower_keyword = keyword.lower()
        for index, column in enumerate(lowered_columns):
            if lower_keyword in column:
                return columns[index]

    return None


def _to_iso_datetime(raw_value: Any) -> str:
    parsed = _parse_datetime(raw_value)
    if parsed is None:
        return datetime.now(UTC).isoformat()
    return parsed.isoformat()


def _parse_datetime(raw_value: Any) -> datetime | None:
    if raw_value is None:
        return None

    if isinstance(raw_value, datetime):
        dt = raw_value
    else:
        value = str(raw_value).strip()
        if not value:
            return None

        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            dt = None

        if dt is None:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d"):
                try:
                    dt = datetime.strptime(value, fmt)
                    break
                except ValueError:
                    continue

        if dt is None:
            return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _is_news_within_days(published_at: str, days: int) -> bool:
    parsed = _parse_datetime(published_at)
    if parsed is None:
        return False

    cutoff = datetime.now(UTC) - timedelta(days=max(1, days))
    return parsed >= cutoff


def _to_float(raw_value: Any) -> float | None:
    if raw_value is None:
        return None

    if isinstance(raw_value, (float, int)):
        return float(raw_value)

    text = str(raw_value).strip().replace(",", "")
    if not text:
        return None
    if text.endswith("%"):
        text = text[:-1]

    try:
        return float(text)
    except ValueError:
        return None


def _safe_text(raw_value: Any) -> str:
    if raw_value is None:
        return ""
    return str(raw_value).strip()


def _format_metric_line(label: str, value: Any, suffix: str = "") -> str | None:
    numeric = _to_float(value)
    if numeric is None:
        return None

    if suffix == "%":
        return f"{label}: {numeric:.2f}%"

    if suffix:
        return f"{label}: {numeric:.2f}{suffix}"

    return f"{label}: {numeric:.2f}"


def _normalize_credibility_score(value: int | float | None) -> float | None:
    if value is None:
        return None

    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None

    if numeric <= 1:
        return max(0.0, min(1.0, numeric))

    return max(0.0, min(1.0, numeric / 100))


def _normalize_stock_code(raw_value: Any) -> str:
    if raw_value is None:
        return ""

    text = str(raw_value).upper().strip()
    text = text.replace("SH", "").replace("SZ", "").replace("BJ", "")
    matched = re.search(r"(\d{6})", text)
    if not matched:
        return ""
    return matched.group(1)


def _tokenize(text: str) -> list[str]:
    tokens = [segment.strip().casefold() for segment in re.split(r"[^\w\u4e00-\u9fff]+", text)]
    return [token for token in tokens if len(token) >= 2]


def _build_mock_theme_news(theme: str, days: int, limit: int) -> list[dict]:
    base_titles = [
        "政策密集跟踪，产业资本关注度抬升",
        "龙头企业订单与产能节奏同步改善",
        "上游成本扰动缓和，盈利中枢修复",
        "机构调研密度提升，赛道分化加剧",
        "海外需求边际回暖，出口链条受益",
        "关键技术迭代提速，设备投资开启",
        "供需结构再平衡，竞争格局优化",
        "估值逐步回归理性，资金偏好重构",
        "主题热度回升，交易活跃度提升",
        "产业协同增强，跨界合作加深",
    ]

    now = datetime.now(UTC)
    items: list[dict] = []
    for index in range(min(limit, len(base_titles))):
        seed = f"{theme}-{index}-{days}"
        digest = hashlib.md5(seed.encode("utf-8")).hexdigest()
        score = int(digest[:2], 16) / 255
        sentiment = "neutral"
        if score > 0.66:
            sentiment = "positive"
        elif score < 0.33:
            sentiment = "negative"

        published_at = (now - timedelta(hours=index * max(1, days // 2))).isoformat()
        items.append(
            {
                "id": f"{theme}-{index}",
                "title": f"{theme}: {base_titles[index]}",
                "summary": f"围绕{theme}的公开信息较少，当前为降级兜底摘要。",
                "source": "intelligence-fallback",
                "publishedAt": published_at,
                "sentiment": sentiment,
                "relevanceScore": round(max(0.2, min(0.95, score)), 2),
                "relatedStocks": _guess_related_stocks(theme),
            }
        )

    return items


def _build_mock_company_evidence(stock_code: str, concept: str) -> dict:
    seed_text = f"{stock_code}-{concept}"
    digest = hashlib.sha256(seed_text.encode("utf-8")).hexdigest()
    random.seed(int(digest[:8], 16))
    credibility_score = random.randint(55, 88)

    return {
        "stockCode": stock_code,
        "companyName": _guess_company_name(stock_code),
        "concept": concept,
        "evidenceSummary": f"{stock_code} 在“{concept}”方向当前走降级兜底评估。",
        "catalysts": [
            "等待后续公告验证订单与产能节奏",
            "关注行业需求边际回暖的持续性",
            "跟踪资金偏好变化与估值修复",
        ],
        "risks": [
            "主题交易拥挤导致波动放大",
            "业绩兑现节奏不及预期",
            "上游成本与政策变量扰动",
        ],
        "credibilityScore": credibility_score,
        "dataQuality": "partial",
        "warnings": ["mock_fallback"],
        "updatedAt": datetime.now(UTC).isoformat(),
    }


def _build_mock_company_research_pack(stock_code: str, concept: str) -> dict:
    evidence = _build_mock_company_evidence(stock_code, concept)

    return {
        "stockCode": stock_code,
        "companyName": evidence["companyName"],
        "concept": concept,
        "financialHighlights": [
            "缺少实时财务快照，当前返回降级摘要。",
            "建议结合最新财报与交易所公告进一步核验。",
        ],
        "referenceItems": [
            {
                "id": f"{stock_code}:fallback_financial_summary",
                "title": f"{evidence['companyName']} 降级财务摘要",
                "sourceName": "intelligence-fallback",
                "snippet": "上游财务数据暂不可用，已回退到兜底摘要。",
                "extractedFact": evidence["evidenceSummary"],
                "publishedAt": evidence["updatedAt"],
                "credibilityScore": _normalize_credibility_score(
                    evidence["credibilityScore"]
                ),
                "sourceType": "financial",
            }
        ],
        "summaryNotes": [evidence["evidenceSummary"], *evidence["risks"][:2]],
        "dataQuality": "partial",
        "warnings": ["mock_fallback"],
    }


def _build_mock_candidates(theme: str, limit: int) -> list[dict]:
    pool = {
        "ai": [
            ("002230", "科大讯飞"),
            ("603019", "中科曙光"),
            ("300308", "中际旭创"),
            ("688041", "海光信息"),
        ],
        "semicon": [
            ("688981", "中芯国际"),
            ("603986", "兆易创新"),
            ("688012", "中微公司"),
            ("688256", "寒武纪"),
        ],
        "new_energy": [
            ("300750", "宁德时代"),
            ("002594", "比亚迪"),
            ("601012", "隆基绿能"),
            ("600438", "通威股份"),
        ],
        "default": [
            ("600036", "招商银行"),
            ("600519", "贵州茅台"),
            ("601318", "中国平安"),
            ("000858", "五粮液"),
        ],
    }

    lower = theme.lower()
    if "ai" in lower or "人工智能" in theme:
        selected = pool["ai"]
    elif "半导体" in theme or "芯片" in theme:
        selected = pool["semicon"]
    elif "新能源" in theme or "储能" in theme:
        selected = pool["new_energy"]
    else:
        selected = pool["default"]

    results: list[dict] = []
    for index, (stock_code, stock_name) in enumerate(selected[:limit]):
        heat = max(50, 88 - index * 6)
        results.append(
            {
                "stockCode": stock_code,
                "stockName": stock_name,
                "reason": f"降级兜底候选，主题“{theme}”匹配度较高",
                "heat": float(heat),
                "concept": theme,
            }
        )
    return results


def _guess_related_stocks(theme: str) -> list[str]:
    lower = theme.lower()
    if "ai" in lower or "人工智能" in theme:
        return ["002230", "603019", "300308"]
    if "半导体" in theme or "芯片" in theme:
        return ["688981", "603986", "688012"]
    if "新能源" in theme or "储能" in theme:
        return ["300750", "002594", "601012"]
    return ["600036", "600519", "601318"]


def _guess_company_name(stock_code: str) -> str:
    mapping = {
        "002230": "科大讯飞",
        "603019": "中科曙光",
        "300308": "中际旭创",
        "688981": "中芯国际",
        "603986": "兆易创新",
        "688012": "中微公司",
        "300750": "宁德时代",
        "002594": "比亚迪",
        "601012": "隆基绿能",
        "600036": "招商银行",
        "600519": "贵州茅台",
        "601318": "中国平安",
    }

    return mapping.get(stock_code, f"公司{stock_code}")


def _dedupe_warning_codes(raw_warnings: Any) -> list[str]:
    if not isinstance(raw_warnings, list):
        return []

    normalized = [str(item).strip() for item in raw_warnings if str(item).strip()]
    return list(dict.fromkeys(normalized))
