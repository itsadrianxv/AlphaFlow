"""Minishare 三源新闻召回、去重、归属、重排与证据标准化。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from difflib import SequenceMatcher
import hashlib
import json
import os
import re
from typing import Literal
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, wait
from multiprocessing import get_context
from queue import Empty

import httpx

from app.contracts.meta import GatewayWarning
from app.gateway.common import GatewayError
from app.providers.minishare.client import MinishareNewsClient, RawNewsRecord

NewsScope = Literal["macro", "theme", "industry", "company"]
_SHANGHAI = ZoneInfo("Asia/Shanghai")
_SOURCE_PRIORITY = {"fast": 1, "cctv": 2, "major": 3}
_MACRO_TERMS = (
    "国务院", "央行", "货币政策", "利率", "降准", "降息", "社融", "通胀",
    "GDP", "PMI", "汇率", "关税", "美联储", "财政", "监管", "资本开支",
    "需求", "流动性", "风险偏好", "大宗商品", "房地产", "出口", "消费",
)
_TRACE_GENERIC_TERMS = {
    "公司", "行业", "市场", "今日", "最新", "相关", "表示", "发布", "同比",
    "增长", "下降", "需求", "价格", "投资", "资本", "上半", "半年", "消息",
}
_TRACE_RELATIONS = {"same_event", "prior_signal", "follow_up"}
_TRACE_MIN_RELEVANCE = 0.65


@dataclass(frozen=True)
class NewsQuery:
    scope: NewsScope
    target: str
    days: int
    limit: int
    terms: tuple[str, ...] = ()
    related_stocks: tuple[str, ...] = ()


@dataclass(frozen=True)
class RadarCompany:
    stock_code: str
    company_name: str
    aliases: tuple[str, ...] = ()
    priority: int | None = None


@dataclass(frozen=True)
class RadarIndustry:
    name: str
    aliases: tuple[str, ...] = ()
    priority: int | None = None


@dataclass(frozen=True)
class NewsRetrievalResult:
    items: list[dict]
    warnings: list[GatewayWarning] = field(default_factory=list)


@dataclass(frozen=True)
class DailyNewsRetrievalResult:
    items: list[dict]
    source_status: dict[str, bool]
    warnings: list[GatewayWarning] = field(default_factory=list)


def _fetch_daily_source_process(
    token: str,
    kind: str,
    start_at: datetime,
    end_at: datetime,
    output,
) -> None:
    try:
        client = MinishareNewsClient(token)
        if kind == "fast":
            records = client.fetch_fast_news(start_at, end_at, limit=750)
        elif kind == "major":
            records = client.fetch_major_news(start_at, end_at)
        else:
            records = client.fetch_cctv_news(start_at.date())
        output.put((kind, True, [item.to_dict() for item in records], ""))
    except Exception as exc:  # noqa: BLE001
        output.put((kind, False, [], str(exc)))


def _fetch_daily_sources_isolated(
    *, token: str, start_at: datetime, end_at: datetime
) -> DailyNewsRetrievalResult:
    """Use one killable process per upstream source to enforce a real deadline."""
    context = get_context("spawn" if os.name == "nt" else "fork")
    output = context.Queue()
    processes = {
        kind: context.Process(
            target=_fetch_daily_source_process,
            args=(token, kind, start_at, end_at, output),
            daemon=True,
        )
        for kind in ("fast", "major", "cctv")
    }
    for process in processes.values():
        process.start()

    records: list[RawNewsRecord] = []
    warnings: list[GatewayWarning] = []
    source_status = {kind: False for kind in processes}
    deadline = datetime.now().timestamp() + 15
    results: dict[str, tuple[bool, list[dict], str]] = {}
    while len(results) < len(processes) and datetime.now().timestamp() < deadline:
        try:
            kind, succeeded, payload, message = output.get(timeout=0.1)
            results[kind] = (succeeded, payload, message)
        except Empty:
            continue
    for kind, process in processes.items():
        if process.is_alive():
            process.terminate()
        process.join(timeout=1)
        result = results.get(kind)
        if result is None:
            warnings.append(GatewayWarning(
                code=f"minishare_{kind}_timeout",
                message=f"{kind} 新闻源请求超时(15000ms)",
            ))
            continue
        succeeded, payload, message = result
        if succeeded:
            records.extend(_raw_record_from_dict(item) for item in payload)
            source_status[kind] = True
        else:
            warnings.append(GatewayWarning(
                code=f"minishare_{kind}_partial",
                message=f"{kind} 新闻源暂不可用: {message}",
            ))
    output.close()
    if not any(source_status.values()):
        raise GatewayError(
            code="minishare_news_failed",
            message="Minishare 新闻源全部不可用",
            status_code=502,
            provider="minishare",
            warnings=warnings,
        )
    return DailyNewsRetrievalResult(
        items=[item.to_dict() for item in records],
        source_status=source_status,
        warnings=warnings,
    )


@dataclass
class MinishareNewsProvider:
    """按业务范围编排 Minishare 三类新闻并输出 provider-neutral 证据。"""

    token: str | None = None
    deepseek_api_key: str | None = None
    deepseek_base_url: str | None = None
    deepseek_timeout_ms: int | None = None
    client: MinishareNewsClient | None = None
    provider_name: str = field(default="minishare", init=False)

    def __post_init__(self) -> None:
        self.token = (self.token or os.getenv("MINISHARE_TOKEN", "")).strip()
        self.deepseek_api_key = (
            self.deepseek_api_key or os.getenv("DEEPSEEK_API_KEY", "")
        ).strip()
        self.deepseek_base_url = (
            self.deepseek_base_url
            or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        ).rstrip("/")
        raw_timeout = self.deepseek_timeout_ms or os.getenv(
            "DEEPSEEK_TIMEOUT_MS", "15000"
        )
        try:
            self.deepseek_timeout_ms = max(1_000, int(raw_timeout))
        except (TypeError, ValueError):
            self.deepseek_timeout_ms = 15_000
        self.client = self.client or MinishareNewsClient(self.token)

    def get_news(self, query: NewsQuery) -> list[dict]:
        return self.get_news_result(query).items

    def get_news_result(self, query: NewsQuery) -> NewsRetrievalResult:
        if not self.token:
            raise GatewayError(
                code="minishare_not_configured",
                message="MINISHARE_TOKEN 未配置",
                status_code=503,
                provider=self.provider_name,
            )
        end_at = datetime.now(_SHANGHAI)
        start_at = end_at - timedelta(days=query.days)
        raw_items, warnings = self._fetch_sources(
            start_at=start_at,
            end_at=end_at,
            kinds=self._source_kinds(query.scope),
            fast_limit=min(1500, max(query.limit * 12, 120)),
        )
        recalled = self._recall(raw_items, query)
        deduped = self._dedupe(recalled)
        return self._analyze_and_standardize(
            deduped[: min(100, max(query.limit * 5, 30))],
            query=query,
            warnings=warnings,
        )

    def get_radar(
        self,
        *,
        companies: tuple[RadarCompany, ...],
        industries: tuple[RadarIndustry, ...],
        days: int,
        limit: int,
        end_at: datetime | None = None,
        include_macro: bool = True,
        trace_anchor: dict | None = None,
    ) -> NewsRetrievalResult:
        terms = [*_MACRO_TERMS] if include_macro else []
        stocks: list[str] = []
        for company in companies:
            terms.extend((company.company_name, company.stock_code, *company.aliases))
        for industry in industries:
            terms.extend((industry.name, *industry.aliases))
        if trace_anchor:
            terms.extend(
                (
                    str(trace_anchor.get("title") or ""),
                    str(trace_anchor.get("summary") or ""),
                    str(trace_anchor.get("eventType") or ""),
                )
            )
        query = NewsQuery(
            scope="macro",
            target="事件雷达",
            days=days,
            limit=limit,
            terms=tuple(_unique_text(terms)),
            related_stocks=(),
        )
        end_at = end_at or datetime.now(_SHANGHAI)
        if end_at.tzinfo is None:
            end_at = end_at.replace(tzinfo=_SHANGHAI)
        else:
            end_at = end_at.astimezone(_SHANGHAI)
        raw_items, warnings = self._fetch_sources(
            start_at=end_at - timedelta(days=days),
            end_at=end_at,
            kinds=("fast", "major")
            if trace_anchor
            else ("fast", "major", "cctv"),
            fast_limit=min(1500, max(limit * 15, 300)),
        )
        deduped = self._radar_candidates(
            raw_items,
            companies,
            industries,
            end_at=end_at,
            days=days,
            limit=limit,
            include_macro=include_macro,
            trace_anchor=trace_anchor,
        )
        targets = {
            "companies": [
                {
                    "stockCode": item.stock_code,
                    "companyName": item.company_name,
                    "aliases": list(item.aliases),
                    "priority": item.priority,
                }
                for item in companies
            ],
            "industries": [
                {"name": item.name, "aliases": list(item.aliases), "priority": item.priority}
                for item in industries
            ],
            "includeMacro": include_macro,
        }
        return self._analyze_and_standardize(
            deduped[: min(120, max(limit * 4, 50))],
            query=query,
            warnings=warnings,
            targets=targets,
            preserve_order=True,
            trace_anchor=trace_anchor,
        )

    def get_daily_raw(self, target_date: datetime) -> DailyNewsRetrievalResult:
        """Fetch one Shanghai calendar day without applying radar-specific filters."""
        if not self.token:
            raise GatewayError(
                code="minishare_not_configured",
                message="MINISHARE_TOKEN 未配置",
                status_code=503,
                provider=self.provider_name,
            )
        day = target_date.astimezone(_SHANGHAI)
        start_at = day.replace(hour=0, minute=0, second=0, microsecond=0)
        end_at = start_at + timedelta(days=1) - timedelta(microseconds=1)
        if isinstance(self.client, MinishareNewsClient):
            return _fetch_daily_sources_isolated(
                token=self.token,
                start_at=start_at,
                end_at=end_at,
            )
        return self._get_daily_raw_with_client(start_at, end_at)

    def _get_daily_raw_with_client(
        self, start_at: datetime, end_at: datetime
    ) -> DailyNewsRetrievalResult:
        """Mock-friendly fallback; production requests use isolated processes."""
        records: list[RawNewsRecord] = []
        warnings: list[GatewayWarning] = []
        source_status: dict[str, bool] = {"fast": False, "major": False, "cctv": False}

        def fetch(kind: str) -> list[RawNewsRecord]:
            if kind == "fast":
                return self.client.fetch_fast_news(start_at, end_at, limit=750)
            if kind == "major":
                return self.client.fetch_major_news(start_at, end_at)
            return self.client.fetch_cctv_news(start_at.date())

        # The Minishare SDK is synchronous. A bounded worker prevents one source
        # from serializing the other two while the route itself runs in FastAPI's pool.
        executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="minishare-news")
        futures = {executor.submit(fetch, kind): kind for kind in source_status}
        done, pending = wait(futures, timeout=15)
        for future in done:
            kind = futures[future]
            try:
                records.extend(future.result())
                source_status[kind] = True
            except Exception as exc:  # noqa: BLE001
                warnings.append(GatewayWarning(
                    code=f"minishare_{kind}_partial",
                    message=f"{kind} 新闻源暂不可用: {getattr(exc, 'message', exc)}",
                ))
        for future in pending:
            kind = futures[future]
            future.cancel()
            warnings.append(GatewayWarning(
                code=f"minishare_{kind}_timeout",
                message=f"{kind} 新闻源请求超时(15000ms)",
            ))
        # Do not wait for a hung SDK call here. The route returns partial data and
        # the bounded FastAPI worker remains isolated from the event loop.
        executor.shutdown(wait=False, cancel_futures=True)
        if not any(source_status.values()):
            raise GatewayError(
                code="minishare_news_failed",
                message="Minishare 新闻源全部不可用",
                status_code=502,
                provider=self.provider_name,
                warnings=warnings,
            )
        return DailyNewsRetrievalResult(
            items=[item.to_dict() for item in records],
            source_status=source_status,
            warnings=warnings,
        )

    def resolve_radar(
        self,
        *,
        raw_items: list[dict],
        companies: tuple[RadarCompany, ...],
        industries: tuple[RadarIndustry, ...],
        days: int,
        limit: int,
        end_at: datetime | None = None,
        include_macro: bool = True,
        trace_anchor: dict | None = None,
    ) -> NewsRetrievalResult:
        terms = [*_MACRO_TERMS] if include_macro else []
        for company in companies:
            terms.extend((company.company_name, company.stock_code, *company.aliases))
        for industry in industries:
            terms.extend((industry.name, *industry.aliases))
        if trace_anchor:
            terms.extend(
                (
                    str(trace_anchor.get("title") or ""),
                    str(trace_anchor.get("summary") or ""),
                    str(trace_anchor.get("eventType") or ""),
                )
            )
        query = NewsQuery(
            scope="macro", target="事件雷达", days=days, limit=limit,
            terms=tuple(_unique_text(terms)), related_stocks=(),
        )
        records = [_raw_record_from_dict(item) for item in raw_items]
        end_at = end_at or datetime.now(_SHANGHAI)
        if end_at.tzinfo is None:
            end_at = end_at.replace(tzinfo=_SHANGHAI)
        else:
            end_at = end_at.astimezone(_SHANGHAI)
        selected = self._radar_candidates(
            records,
            companies,
            industries,
            end_at=end_at,
            days=days,
            limit=limit,
            include_macro=include_macro,
            trace_anchor=trace_anchor,
        )
        targets = {
            "companies": [{"stockCode": item.stock_code, "companyName": item.company_name, "aliases": list(item.aliases), "priority": item.priority} for item in companies],
            "industries": [{"name": item.name, "aliases": list(item.aliases), "priority": item.priority} for item in industries],
            "includeMacro": include_macro,
        }
        return self._analyze_and_standardize(
            selected,
            query=query,
            warnings=[],
            targets=targets,
            preserve_order=True,
            trace_anchor=trace_anchor,
        )

    def _radar_candidates(
        self,
        items: list[RawNewsRecord],
        companies: tuple[RadarCompany, ...],
        industries: tuple[RadarIndustry, ...],
        *,
        end_at: datetime,
        days: int,
        limit: int,
        include_macro: bool = True,
        trace_anchor: dict | None = None,
    ) -> list[dict]:
        targets: list[tuple[int, tuple[str, ...]]] = []
        for index, company in enumerate(companies):
            terms = _unique_text((company.company_name, company.stock_code, *company.aliases))
            targets.append((company.priority if company.priority is not None else len(companies) - index, tuple(terms)))
        for index, industry in enumerate(industries):
            terms = _unique_text((industry.name, *industry.aliases))
            targets.append((industry.priority if industry.priority is not None else len(industries) - index, tuple(terms)))

        anchor_terms = _trace_terms(trace_anchor) if trace_anchor else set()
        anchor_stocks = {
            str(value)
            for value in (trace_anchor or {}).get("relatedStocks") or []
            if str(value)
        }
        prepared: list[dict] = []
        for raw in items:
            item = raw.to_dict()
            text = f"{raw.title}\n{raw.content}".lower()
            macro_matches = [term for term in _MACRO_TERMS if term.lower() in text]
            matched_targets = [
                priority
                for priority, terms in targets
                if any(term.lower() in text for term in terms)
            ]
            item["id"] = raw.sourceItemId
            item["matchedTerms"] = macro_matches or ["全局新闻"]
            item["targetPriority"] = max(matched_targets, default=-1)
            item["matchedStocks"] = [
                company.stock_code
                for company in companies
                if any(
                    term.lower() in text
                    for term in _unique_text((company.company_name, company.stock_code, *company.aliases))
                )
            ]
            normalized_text = re.sub(r"\s+", "", text)
            item["anchorMatches"] = sorted(
                term for term in anchor_terms if term.lower() in normalized_text
            )
            item["anchorStockMatch"] = bool(
                anchor_stocks.intersection(item["matchedStocks"])
            )
            item["macroMatchCount"] = len(macro_matches)
            item["initialRelevanceScore"] = round(
                min(0.98, 0.42 + 0.12 * max(1, len(macro_matches))), 2
            )
            prepared.append(item)

        recall_pool = prepared
        if trace_anchor or not include_macro:
            recall_pool = [
                item
                for item in prepared
                if item.get("targetPriority", -1) >= 0
                or item["anchorMatches"]
                or item["anchorStockMatch"]
            ]

        # 共享日库最多会传入 2000 条新闻；先做确定性精排，避免近似去重退化为 O(n²)。
        exact_by_hash: dict[str, dict] = {}
        for item in recall_pool:
            current = exact_by_hash.get(item["contentHash"])
            if current is None or (
                _SOURCE_PRIORITY.get(item["sourceKind"], 0), len(item["content"])
            ) > (
                _SOURCE_PRIORITY.get(current["sourceKind"], 0),
                len(current["content"]),
            ):
                exact_by_hash[item["contentHash"]] = item
        preselected = sorted(
            exact_by_hash.values(),
            key=lambda item: (
                bool(item.get("anchorStockMatch")),
                len(item.get("anchorMatches") or []),
                item.get("targetPriority", -1),
                item["initialRelevanceScore"],
                item["publishedAt"],
                _SOURCE_PRIORITY.get(item["sourceKind"], 0),
            ),
            reverse=True,
        )[: max(180, limit * 6)]
        deduped = self._dedupe(preselected)
        window_seconds = max(1, days * 86_400)
        for item in deduped:
            published_at = datetime.fromisoformat(str(item["publishedAt"]).replace("Z", "+00:00"))
            if published_at.tzinfo is None:
                published_at = published_at.replace(tzinfo=_SHANGHAI)
            age_seconds = max(0, (end_at - published_at.astimezone(end_at.tzinfo)).total_seconds())
            freshness = max(0.0, 1.0 - age_seconds / window_seconds)
            source_refs = item.get("sourceRefs") or []
            coverage = min(1.0, len(source_refs) / 3)
            source_quality = _SOURCE_PRIORITY.get(item["sourceKind"], 0) / 3
            macro_coverage = min(1.0, item.get("macroMatchCount", 0) / 3)
            item["heatScore"] = round(
                freshness * 0.4 + coverage * 0.3 + source_quality * 0.2 + macro_coverage * 0.1,
                6,
            )

        target_news = sorted(
            (
                item
                for item in deduped
                if item.get("targetPriority", -1) >= 0
                or (trace_anchor and (item["anchorMatches"] or item["anchorStockMatch"]))
            ),
            key=lambda item: (
                bool(item.get("anchorStockMatch")),
                len(item.get("anchorMatches") or []),
                item["targetPriority"],
                item["heatScore"],
                item["publishedAt"],
                item["id"],
            ),
            reverse=True,
        )
        if trace_anchor or not include_macro:
            return target_news[:limit]
        selected_ids = {item["id"] for item in target_news[:limit]}
        global_news = sorted(
            (item for item in deduped if item["id"] not in selected_ids),
            key=lambda item: (item["heatScore"], item["publishedAt"], item["id"]),
            reverse=True,
        )
        return [*target_news[:limit], *global_news][:limit]

    @staticmethod
    def _source_kinds(scope: NewsScope) -> tuple[str, ...]:
        if scope == "macro":
            return ("fast", "major", "cctv")
        return ("fast", "major")

    def _fetch_sources(
        self,
        *,
        start_at: datetime,
        end_at: datetime,
        kinds: tuple[str, ...],
        fast_limit: int,
    ) -> tuple[list[RawNewsRecord], list[GatewayWarning]]:
        records: list[RawNewsRecord] = []
        warnings: list[GatewayWarning] = []
        succeeded = 0
        for kind in kinds:
            try:
                if kind == "fast":
                    fetched = self.client.fetch_fast_news(
                        start_at, end_at, limit=fast_limit
                    )
                elif kind == "major":
                    fetched = self.client.fetch_major_news(start_at, end_at)
                else:
                    fetched = []
                    cursor = start_at.date()
                    while cursor <= end_at.date():
                        fetched.extend(self.client.fetch_cctv_news(cursor))
                        cursor += timedelta(days=1)
                records.extend(fetched)
                succeeded += 1
            except Exception as exc:  # noqa: BLE001
                warnings.append(
                    GatewayWarning(
                        code=f"minishare_{kind}_partial",
                        message=f"{kind} 新闻源暂不可用: {getattr(exc, 'message', exc)}",
                    )
                )
        if succeeded == 0:
            raise GatewayError(
                code="minishare_news_failed",
                message="Minishare 新闻源全部不可用",
                status_code=502,
                provider=self.provider_name,
                warnings=warnings,
            )
        return records, warnings

    def _recall(
        self, items: list[RawNewsRecord], query: NewsQuery
    ) -> list[dict]:
        default_terms = _MACRO_TERMS if query.scope == "macro" else (query.target,)
        terms = _unique_text(query.terms or default_terms)
        recalled: list[dict] = []
        for raw in items:
            item = raw.to_dict()
            text = f"{raw.title}\n{raw.content}".lower()
            matched = [term for term in terms if term.lower() in text]
            if not matched:
                continue
            item["id"] = raw.sourceItemId
            item["matchedTerms"] = matched
            item["initialRelevanceScore"] = round(
                min(0.98, 0.42 + 0.12 * len(matched)), 2
            )
            recalled.append(item)
        return sorted(
            recalled,
            key=lambda item: (item["initialRelevanceScore"], item["publishedAt"]),
            reverse=True,
        )

    def _dedupe(self, items: list[dict]) -> list[dict]:
        groups: list[list[dict]] = []
        by_hash: dict[str, list[dict]] = {}
        for item in items:
            exact = by_hash.get(item["contentHash"])
            if exact is not None:
                exact.append(item)
                continue
            matched_group = next(
                (group for group in groups if _is_near_duplicate(group[0], item)),
                None,
            )
            if matched_group is None:
                matched_group = [item]
                groups.append(matched_group)
            else:
                matched_group.append(item)
            by_hash[item["contentHash"]] = matched_group

        canonical: list[dict] = []
        for group in groups:
            primary = max(
                group,
                key=lambda item: (
                    _SOURCE_PRIORITY.get(item["sourceKind"], 0),
                    len(item["content"]),
                ),
            )
            event_id = hashlib.sha256(
                "|".join(sorted(item["contentHash"] for item in group)).encode("utf-8")
            ).hexdigest()[:24]
            merged = dict(primary)
            merged["id"] = event_id
            merged["matchedTerms"] = _unique_text(
                term for item in group for term in item["matchedTerms"]
            )
            merged["initialRelevanceScore"] = max(
                item["initialRelevanceScore"] for item in group
            )
            merged["sourceRefs"] = [
                {
                    "sourceItemId": item["sourceItemId"],
                    "sourceKind": item["sourceKind"],
                    "sourceName": item["sourceName"],
                    "url": item["url"],
                    "publishedAt": item["publishedAt"],
                    "contentHash": item["contentHash"],
                }
                for item in sorted(
                    group,
                    key=lambda value: _SOURCE_PRIORITY.get(value["sourceKind"], 0),
                    reverse=True,
                )
            ]
            canonical.append(merged)
        return sorted(
            canonical,
            key=lambda item: (item["initialRelevanceScore"], item["publishedAt"]),
            reverse=True,
        )

    def _analyze_and_standardize(
        self,
        candidates: list[dict],
        *,
        query: NewsQuery,
        warnings: list[GatewayWarning],
        targets: dict | None = None,
        preserve_order: bool = False,
        trace_anchor: dict | None = None,
    ) -> NewsRetrievalResult:
        if not candidates:
            return NewsRetrievalResult(items=[], warnings=warnings)

        analysis_warnings = list(warnings)
        attributed: dict[str, dict] = {}
        ranked: dict[str, dict] = {}
        if not self.deepseek_api_key:
            analysis_warnings.append(
                GatewayWarning(
                    code="news_model_not_configured",
                    message="DEEPSEEK_API_KEY 未配置，已返回未归属、未重排的新闻证据",
                )
            )
        else:
            if not trace_anchor:
                try:
                    attributed = self._attribute(candidates, query, targets=targets)
                except Exception as exc:  # noqa: BLE001
                    analysis_warnings.append(
                        GatewayWarning(
                            code="news_attribution_failed",
                            message=f"新闻归属判断失败: {exc}",
                        )
                    )
            try:
                ranked = self._rerank(
                    candidates, query, attributed, trace_anchor=trace_anchor
                )
            except Exception as exc:  # noqa: BLE001
                analysis_warnings.append(
                    GatewayWarning(
                        code="news_rerank_failed",
                        message=f"新闻重排失败: {exc}",
                    )
                )

        complete = bool(ranked) and (bool(attributed) or trace_anchor is not None)
        standardized = [
            self._standardize(
                source,
                query,
                attribution=attributed.get(source["id"], {}),
                ranking=ranked.get(source["id"], {}),
                complete=complete,
                warnings=analysis_warnings,
            )
            for source in candidates
        ]
        if trace_anchor:
            accepted_ids = {
                source_id
                for source_id, ranking in ranked.items()
                if ranking.get("sharesCoreSubject") is True
                and ranking.get("eventRelation") in _TRACE_RELATIONS
                and _score(ranking.get("relevanceScore"), 0) >= _TRACE_MIN_RELEVANCE
            }
            standardized = [item for item in standardized if item["id"] in accepted_ids]
        else:
            standardized = [item for item in standardized if item["relevanceScore"] > 0]
        if preserve_order:
            order = {item["id"]: index for index, item in enumerate(candidates)}
            standardized.sort(key=lambda item: order.get(item["id"], len(order)))
        else:
            standardized.sort(
                key=lambda item: (item["relevanceScore"], item["publishedAt"]),
                reverse=True,
            )
        return NewsRetrievalResult(
            items=standardized[: query.limit], warnings=analysis_warnings
        )

    def _attribute(
        self, candidates: list[dict], query: NewsQuery, *, targets: dict | None
    ) -> dict[str, dict]:
        payload = {
            "scope": query.scope,
            "target": query.target,
            "targets": targets,
            "instructions": (
                "逐条阅读完整 content，判断其归属。每条输出 id、attributions、"
                "relatedStocks、scopeTags。attributions 中每项包含 targetType、"
                "targetId、targetName、relation、confidence、reason、evidenceQuote。"
                "evidenceQuote 必须来自正文原句。全球公司可保留名称，A股代码使用6位数字。"
            ),
            "candidates": [_model_candidate(item) for item in candidates],
        }
        return self._model_items(
            system="你是严谨的财经新闻归属分类器，只输出 JSON 对象 {\"items\":[...]}。",
            payload=payload,
        )

    def _rerank(
        self,
        candidates: list[dict],
        query: NewsQuery,
        attributed: dict[str, dict],
        *,
        trace_anchor: dict | None = None,
    ) -> dict[str, dict]:
        payload = {
            "scope": query.scope,
            "target": query.target,
            "traceAnchor": trace_anchor,
            "instructions": (
                "逐条阅读完整 content 并结合 attribution 输出 title、summary、sentiment、"
                "relevanceScore、eventType、matchReason。summary 不超过120字；"
                "sentiment 只能为 positive、neutral、negative；relevanceScore 为0到1。"
                + (
                    " 当前任务是判断候选新闻是否属于 traceAnchor 的同一事件脉络。"
                    "每条还必须输出 sharesCoreSubject 布尔值与 eventRelation；"
                    "eventRelation 只能为 same_event、prior_signal、follow_up、unrelated。"
                    "只有共享核心实体或行业主题，或者存在可说明的直接因果链，"
                    "才能将 sharesCoreSubject 设为 true。仅同属财经新闻，或只共享需求、"
                    "价格、市场、增长等泛化词，必须判为 unrelated 并给低于0.65的分数。"
                    if trace_anchor
                    else ""
                )
            ),
            "candidates": [
                {**_model_candidate(item), "attribution": attributed.get(item["id"])}
                for item in candidates
            ],
        }
        return self._model_items(
            system="你是严谨的财经新闻重排器，只输出 JSON 对象 {\"items\":[...]}。",
            payload=payload,
        )

    def _model_items(self, *, system: str, payload: dict) -> dict[str, dict]:
        response = httpx.post(
            f"{self.deepseek_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.deepseek_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-v4-flash",
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
            },
            timeout=self.deepseek_timeout_ms / 1000,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        parsed = json.loads(_json_object(content))
        items = parsed.get("items")
        if not isinstance(items, list):
            raise ValueError("模型响应缺少 items 数组")
        return {
            str(item["id"]): item
            for item in items
            if isinstance(item, dict) and item.get("id")
        }

    @staticmethod
    def _standardize(
        source: dict,
        query: NewsQuery,
        *,
        attribution: dict,
        ranking: dict,
        complete: bool,
        warnings: list[GatewayWarning],
    ) -> dict:
        relevance = _score(
            ranking.get("relevanceScore"), source["initialRelevanceScore"]
        )
        model_stocks = [
            str(code)
            for code in attribution.get("relatedStocks") or []
            if re.fullmatch(r"\d{6}", str(code))
        ]
        scope_tags = [
            value
            for value in attribution.get("scopeTags") or [query.scope]
            if value in {"macro", "theme", "industry", "company"}
        ]
        attributions = [
            _clean_attribution(value)
            for value in attribution.get("attributions") or []
            if isinstance(value, dict)
        ]
        attributions = [value for value in attributions if value]
        return {
            "id": source["id"],
            "title": _text(ranking.get("title")) or source["title"],
            "summary": _text(ranking.get("summary")) or source["content"][:120],
            "content": source["content"],
            "source": f"minishare:{source['sourceKind']}",
            "sourceKind": source["sourceKind"],
            "sourceRefs": source.get("sourceRefs") or [],
            "url": source.get("url"),
            "publishedAt": source["publishedAt"],
            "sentiment": ranking.get("sentiment")
            if ranking.get("sentiment") in {"positive", "neutral", "negative"}
            else "neutral",
            "relevanceScore": relevance,
            "relatedStocks": _unique_text([*source.get("matchedStocks", []), *query.related_stocks, *model_stocks]),
            "scopeTags": _unique_text(scope_tags),
            "eventType": _text(ranking.get("eventType")) or "其他",
            "eventRelation": ranking.get("eventRelation")
            if ranking.get("eventRelation") in _TRACE_RELATIONS
            else None,
            "matchReason": _text(ranking.get("matchReason"))
            or "命中目标关键词：" + "、".join(source["matchedTerms"]),
            "attributions": attributions,
            "analysisStatus": "complete" if complete else "partial",
            "warnings": _unique_text(warning.code for warning in warnings),
        }


def _model_candidate(item: dict) -> dict:
    # content 必须保持完整；不能以 summary 或固定长度切片替代。
    return {
        "id": item["id"],
        "title": item["title"],
        "content": item["content"],
        "publishedAt": item["publishedAt"],
        "sourceKind": item["sourceKind"],
        "sourceName": item["sourceName"],
        "matchedTerms": item["matchedTerms"],
    }


def _raw_record_from_dict(value: dict) -> RawNewsRecord:
    source_kind = str(value.get("sourceKind") or "fast")
    if source_kind not in {"fast", "major", "cctv"}:
        source_kind = "fast"
    content = _text(value.get("content"))
    title = _text(value.get("title")) or content[:80]
    published_at = _text(value.get("publishedAt"))
    if not content or not published_at:
        raise ValueError("原始新闻缺少 content 或 publishedAt")
    return RawNewsRecord(
        sourceKind=source_kind,
        sourceName=_text(value.get("sourceName")) or f"minishare:{source_kind}",
        url=_text(value.get("url")) or None,
        title=title,
        content=content,
        publishedAt=published_at,
        contentHash=_text(value.get("contentHash")) or hashlib.sha256(content.encode("utf-8")).hexdigest(),
        sourceItemId=_text(value.get("sourceItemId")) or hashlib.sha256(f"{source_kind}|{published_at}|{title}".encode("utf-8")).hexdigest()[:24],
    )


def _clean_attribution(value: dict) -> dict | None:
    target_name = _text(value.get("targetName"))
    if not target_name:
        return None
    return {
        "targetType": _text(value.get("targetType")) or "entity",
        "targetId": _text(value.get("targetId")) or None,
        "targetName": target_name,
        "relation": _text(value.get("relation")) or "contextual",
        "confidence": _score(value.get("confidence"), 0.5),
        "reason": _text(value.get("reason")),
        "evidenceQuote": _text(value.get("evidenceQuote")),
    }


def _is_near_duplicate(left: dict, right: dict) -> bool:
    try:
        distance = abs(
            datetime.fromisoformat(left["publishedAt"]).timestamp()
            - datetime.fromisoformat(right["publishedAt"]).timestamp()
        )
    except ValueError:
        return False
    if distance > 48 * 60 * 60:
        return False
    left_text = _fingerprint_text(f"{left['title']} {left['content'][:500]}")
    right_text = _fingerprint_text(f"{right['title']} {right['content'][:500]}")
    return SequenceMatcher(None, left_text, right_text).ratio() >= 0.86


def _fingerprint_text(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", value).lower()


def _trace_terms(anchor: dict) -> set[str]:
    text = " ".join(
        str(anchor.get(key) or "") for key in ("title", "summary", "eventType")
    ).lower()
    terms = {
        token
        for token in re.findall(r"[a-z][a-z0-9.+-]{1,}|\d{6}", text)
        if token not in _TRACE_GENERIC_TERMS
    }
    for chunk in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        for size in (2, 3, 4):
            terms.update(
                chunk[index : index + size]
                for index in range(len(chunk) - size + 1)
                if chunk[index : index + size] not in _TRACE_GENERIC_TERMS
            )
    return terms


def _json_object(content: str) -> str:
    matched = re.search(r"\{[\s\S]*\}", str(content))
    if not matched:
        raise ValueError("模型未返回 JSON")
    return matched.group(0)


def _unique_text(values) -> list[str]:
    return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))


def _text(value: object) -> str:
    return str(value or "").strip()


def _score(value: object, fallback: float = 0.0) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return max(0.0, min(1.0, fallback))
