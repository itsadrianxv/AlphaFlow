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


@dataclass(frozen=True)
class RadarIndustry:
    name: str
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class NewsRetrievalResult:
    items: list[dict]
    warnings: list[GatewayWarning] = field(default_factory=list)


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
    ) -> NewsRetrievalResult:
        terms = [*_MACRO_TERMS]
        stocks: list[str] = []
        for company in companies:
            terms.extend((company.company_name, company.stock_code, *company.aliases))
            stocks.append(company.stock_code)
        for industry in industries:
            terms.extend((industry.name, *industry.aliases))
        query = NewsQuery(
            scope="macro",
            target="事件雷达",
            days=days,
            limit=limit,
            terms=tuple(_unique_text(terms)),
            related_stocks=tuple(_unique_text(stocks)),
        )
        end_at = datetime.now(_SHANGHAI)
        raw_items, warnings = self._fetch_sources(
            start_at=end_at - timedelta(days=days),
            end_at=end_at,
            kinds=("fast", "major", "cctv"),
            fast_limit=min(1500, max(limit * 15, 300)),
        )
        recalled = self._recall(raw_items, query)
        deduped = self._dedupe(recalled)
        targets = {
            "companies": [
                {
                    "stockCode": item.stock_code,
                    "companyName": item.company_name,
                    "aliases": list(item.aliases),
                }
                for item in companies
            ],
            "industries": [
                {"name": item.name, "aliases": list(item.aliases)}
                for item in industries
            ],
            "includeMacro": True,
        }
        return self._analyze_and_standardize(
            deduped[: min(120, max(limit * 4, 50))],
            query=query,
            warnings=warnings,
            targets=targets,
        )

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
                ranked = self._rerank(candidates, query, attributed)
            except Exception as exc:  # noqa: BLE001
                analysis_warnings.append(
                    GatewayWarning(
                        code="news_rerank_failed",
                        message=f"新闻重排失败: {exc}",
                    )
                )

        complete = bool(attributed) and bool(ranked)
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
        standardized = [item for item in standardized if item["relevanceScore"] > 0]
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
    ) -> dict[str, dict]:
        payload = {
            "scope": query.scope,
            "target": query.target,
            "instructions": (
                "逐条阅读完整 content 并结合 attribution 输出 title、summary、sentiment、"
                "relevanceScore、eventType、matchReason。summary 不超过120字；"
                "sentiment 只能为 positive、neutral、negative；relevanceScore 为0到1。"
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
                "model": "deepseek-chat",
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
            "relatedStocks": _unique_text([*query.related_stocks, *model_stocks]),
            "scopeTags": _unique_text(scope_tags),
            "eventType": _text(ranking.get("eventType")) or "其他",
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
