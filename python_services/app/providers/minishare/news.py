"""Minishare news retrieval, deterministic recall and DeepSeek enrichment."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
import hashlib
import json
import os
import re
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
import pandas as pd

from app.gateway.common import GatewayError

NewsScope = Literal["macro", "theme", "industry", "company"]
_SHANGHAI = ZoneInfo("Asia/Shanghai")
_MACRO_TERMS = (
    "国务院", "央行", "货币政策", "利率", "降准", "降息", "社融", "通胀",
    "GDP", "PMI", "汇率", "关税", "美联储", "财政", "监管",
)


@dataclass(frozen=True)
class NewsQuery:
    scope: NewsScope
    target: str
    days: int
    limit: int
    terms: tuple[str, ...] = ()
    related_stocks: tuple[str, ...] = ()


@dataclass
class MinishareNewsProvider:
    """Retrieves raw Minishare news and turns it into provider-neutral records."""

    token: str | None = None
    deepseek_api_key: str | None = None
    deepseek_base_url: str | None = None
    deepseek_timeout_ms: int | None = None
    provider_name: str = field(default="minishare", init=False)

    def __post_init__(self) -> None:
        self.token = (self.token or os.getenv("MINISHARE_TOKEN", "")).strip()
        self.deepseek_api_key = (
            self.deepseek_api_key or os.getenv("DEEPSEEK_API_KEY", "")
        ).strip()
        self.deepseek_base_url = (
            self.deepseek_base_url or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        ).rstrip("/")
        raw_timeout = self.deepseek_timeout_ms or os.getenv("DEEPSEEK_TIMEOUT_MS", "15000")
        try:
            self.deepseek_timeout_ms = max(1_000, int(raw_timeout))
        except (TypeError, ValueError):
            self.deepseek_timeout_ms = 15_000

    def get_news(self, query: NewsQuery) -> list[dict]:
        if not self.token:
            raise GatewayError(
                code="minishare_not_configured",
                message="MINISHARE_TOKEN 未配置",
                status_code=503,
                provider=self.provider_name,
            )
        if not self.deepseek_api_key:
            raise GatewayError(
                code="news_reranker_not_configured",
                message="DEEPSEEK_API_KEY 未配置，无法完成新闻重排",
                status_code=503,
                provider=self.provider_name,
            )

        end_at = datetime.now(_SHANGHAI)
        start_at = end_at - timedelta(days=query.days)
        raw_items = self._fetch(start_at=start_at, end_at=end_at, limit=min(500, max(query.limit * 8, 80)))
        recalled = self._recall(raw_items, query)
        if not recalled:
            return []
        return self._enrich(recalled[: min(80, max(query.limit * 4, 20))], query)[: query.limit]

    def _fetch(self, *, start_at: datetime, end_at: datetime, limit: int) -> list[dict]:
        try:
            import minishare as ms

            frame = ms.pro_api(self.token).news(
                start_date=start_at.strftime("%Y-%m-%d %H:%M:%S"),
                end_date=end_at.strftime("%Y-%m-%d %H:%M:%S"),
                limit=limit,
            )
        except Exception as exc:  # noqa: BLE001
            raise GatewayError(
                code="minishare_news_failed",
                message=f"Minishare 新闻请求失败: {exc}",
                status_code=502,
                provider=self.provider_name,
            ) from exc
        if not isinstance(frame, pd.DataFrame) or not {"datetime", "content"}.issubset(frame.columns):
            raise GatewayError(
                code="minishare_news_invalid_response",
                message="Minishare 新闻响应缺少 datetime 或 content 字段",
                status_code=502,
                provider=self.provider_name,
            )

        deduped: dict[str, dict] = {}
        for row in frame[["datetime", "content"]].fillna("").to_dict(orient="records"):
            content = str(row["content"]).strip()
            published_at = self._normalize_time(str(row["datetime"]))
            if not content or not published_at:
                continue
            stable_id = hashlib.sha256(f"{published_at}|{content}".encode("utf-8")).hexdigest()[:24]
            deduped.setdefault(stable_id, {"id": stable_id, "content": content, "publishedAt": published_at})
        return sorted(deduped.values(), key=lambda item: item["publishedAt"], reverse=True)

    def _recall(self, items: list[dict], query: NewsQuery) -> list[dict]:
        terms = tuple(dict.fromkeys(term.strip() for term in (query.terms or (_MACRO_TERMS if query.scope == "macro" else (query.target,))) if term.strip()))
        recalled: list[dict] = []
        for item in items:
            text = item["content"]
            matched = [term for term in terms if term.lower() in text.lower()]
            if not matched:
                continue
            candidate = dict(item)
            candidate["matchedTerms"] = matched
            candidate["initialRelevanceScore"] = round(min(0.98, 0.45 + 0.16 * len(matched)), 2)
            recalled.append(candidate)
        return recalled

    def _enrich(self, candidates: list[dict], query: NewsQuery) -> list[dict]:
        prompt = {
            "scope": query.scope,
            "target": query.target,
            "relatedStockCandidates": list(query.related_stocks),
            "instructions": "仅对每条候选新闻输出 JSON。title 不超过 50 字，summary 不超过 120 字。sentiment 只能为 positive、neutral、negative；relevanceScore 为 0 到 1；eventType 为简短中文事件类型；matchReason 说明与目标的关系。只保留确实相关的新闻。",
            "candidates": candidates,
        }
        try:
            response = httpx.post(
                f"{self.deepseek_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.deepseek_api_key}", "Content-Type": "application/json"},
                json={
                    "model": "deepseek-chat",
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": "你是严谨的A股新闻事件分类器。只输出 JSON 对象：{\\\"items\\\":[...]}。"},
                        {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                    ],
                },
                timeout=self.deepseek_timeout_ms / 1000,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(_json_object(content))
            enriched = parsed.get("items")
            if not isinstance(enriched, list):
                raise ValueError("缺少 items 数组")
        except Exception as exc:  # noqa: BLE001
            raise GatewayError(
                code="news_rerank_failed",
                message=f"DeepSeek 新闻重排失败: {exc}",
                status_code=502,
                provider=self.provider_name,
            ) from exc

        source_by_id = {item["id"]: item for item in candidates}
        result: list[dict] = []
        for item in enriched:
            if not isinstance(item, dict) or str(item.get("id") or "") not in source_by_id:
                continue
            source = source_by_id[str(item["id"])]
            relevance = _score(item.get("relevanceScore"))
            if relevance <= 0:
                continue
            stocks = [str(code) for code in item.get("relatedStocks") or [] if re.fullmatch(r"\d{6}", str(code))]
            result.append({
                "id": source["id"],
                "title": _text(item.get("title")) or _headline(source["content"]),
                "summary": _text(item.get("summary")) or source["content"][:120],
                "source": "minishare:news",
                "publishedAt": source["publishedAt"],
                "sentiment": item.get("sentiment") if item.get("sentiment") in {"positive", "neutral", "negative"} else "neutral",
                "relevanceScore": relevance,
                "relatedStocks": list(dict.fromkeys([*query.related_stocks, *stocks])),
                "scopeTags": [query.scope],
                "eventType": _text(item.get("eventType")) or "其他",
                "matchReason": _text(item.get("matchReason")) or "命中目标关键词：" + "、".join(source["matchedTerms"]),
            })
        return sorted(result, key=lambda item: (item["relevanceScore"], item["publishedAt"]), reverse=True)

    @staticmethod
    def _normalize_time(value: str) -> str | None:
        try:
            normalized = value.strip().replace("Z", "+00:00")
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_SHANGHAI)
            return parsed.astimezone(_SHANGHAI).isoformat()
        except ValueError:
            return None


def _json_object(content: str) -> str:
    matched = re.search(r"\{[\s\S]*\}", str(content))
    if not matched:
        raise ValueError("模型未返回 JSON")
    return matched.group(0)


def _headline(content: str) -> str:
    normalized = re.sub(r"^【([^】]+)】", r"\1", content).strip()
    return re.split(r"[。；;]", normalized, maxsplit=1)[0][:50] or "新闻快讯"


def _text(value: object) -> str:
    return str(value or "").strip()


def _score(value: object) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0
