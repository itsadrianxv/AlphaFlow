"""Zhipu Web Search client for A-share concept mapping."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any

import httpx

LOGGER = logging.getLogger(__name__)

_DEFAULT_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
_DEFAULT_MODEL = "glm-4-plus"
_DEFAULT_TIMEOUT_SECONDS = 3.0
_DEFAULT_RETRIES = 0
_MIN_CONFIDENCE = 0.55

_GENERIC_EXACT_NAMES = {
    "a股",
    "沪深两市",
    "中国股市",
    "股票市场",
    "概念板块",
    "行业板块",
}
_GENERIC_KEYWORDS = ("指数", "etf", "基金", "港股", "美股")


def _env_float(name: str, default: float, minimum: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        parsed = float(raw_value)
    except ValueError:
        return default

    return parsed if parsed >= minimum else default


def _env_int(name: str, default: int, minimum: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        parsed = int(raw_value)
    except ValueError:
        return default

    return parsed if parsed >= minimum else default


class ZhipuSearchClient:
    """Client wrapper for querying concept mappings from Zhipu Web Search."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        endpoint: str | None = None,
        timeout_seconds: float | None = None,
        retries: int | None = None,
    ) -> None:
        self.api_key = (api_key or os.getenv("ZHIPU_API_KEY", "")).strip()
        self.model = (model or os.getenv("ZHIPU_WEB_SEARCH_MODEL", _DEFAULT_MODEL)).strip()
        self.endpoint = (
            endpoint or os.getenv("ZHIPU_WEB_SEARCH_ENDPOINT", _DEFAULT_ENDPOINT)
        ).strip()
        self.timeout_seconds = timeout_seconds or _env_float(
            "ZHIPU_WEB_SEARCH_TIMEOUT_SECONDS", _DEFAULT_TIMEOUT_SECONDS, 1.0
        )
        self.retries = retries if retries is not None else _env_int(
            "ZHIPU_WEB_SEARCH_RETRIES", _DEFAULT_RETRIES, 0
        )

    def search_theme_concepts(self, theme: str, limit: int) -> list[dict]:
        """Search concept boards for the given theme and return cleaned concepts."""
        normalized_theme = theme.strip()
        normalized_limit = max(1, min(limit, 20))
        if not normalized_theme:
            return []

        if not self.api_key:
            LOGGER.info("ZHIPU_API_KEY not configured, skip web search for theme '%s'", theme)
            return []

        payload = self._build_request_payload(normalized_theme, normalized_limit)
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        for attempt in range(self.retries + 1):
            try:
                with httpx.Client(timeout=self.timeout_seconds) as client:
                    response = client.post(self.endpoint, json=payload, headers=headers)
                response.raise_for_status()
                return self._parse_response_payload(response.json(), normalized_limit)
            except Exception as exc:  # noqa: BLE001
                if attempt < self.retries:
                    LOGGER.debug(
                        "Zhipu web search failed for '%s' (attempt %s/%s): %s",
                        normalized_theme,
                        attempt + 1,
                        self.retries + 1,
                        exc,
                    )
                else:
                    LOGGER.warning(
                        "Zhipu web search failed for '%s' (attempt %s/%s): %s",
                        normalized_theme,
                        attempt + 1,
                        self.retries + 1,
                        exc,
                    )
                if attempt < self.retries:
                    time.sleep(min(1.2 * (attempt + 1), 2.5))

        return []

    def _build_request_payload(self, theme: str, limit: int) -> dict:
        system_prompt = (
            "你是A股投研助手。任务是把主题词映射为“A股概念板块”，"
            "禁止返回泛行业词、指数、ETF或非A股概念。"
            "只输出可解析JSON对象，不要Markdown，不要解释文本。"
            "JSON格式固定为："
            '{"concepts":[{"name":"", "code":"", "aliases":[], "confidence":0.0, '
            '"reason":"", "source":"zhipu_web_search"}]}。'
            "confidence必须在0到1之间，source必须固定为zhipu_web_search。"
        )
        user_prompt = (
            f"主题词：{theme}\n"
            f"最多返回 {limit} 个A股概念板块。\n"
            "必须优先返回具体概念板块名称，并尽可能提供板块代码。"
        )
        return {
            "model": self.model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "tools": [{"type": "web_search", "web_search": {"enable": True}}],
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

    def _parse_response_payload(self, payload: dict, limit: int) -> list[dict]:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            return []

        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if not isinstance(message, dict):
            return []

        content = message.get("content")
        raw_text = self._extract_text(content)
        if not raw_text:
            return []

        parsed = _load_json_safely(raw_text)
        if not isinstance(parsed, dict):
            return []

        concepts = parsed.get("concepts")
        if not isinstance(concepts, list):
            return []

        return _sanitize_concepts(concepts, limit=limit)

    @staticmethod
    def _extract_text(content: Any) -> str:
        if isinstance(content, str):
            return content.strip()

        if isinstance(content, list):
            chunks: list[str] = []
            for item in content:
                if isinstance(item, dict):
                    text = item.get("text")
                    if isinstance(text, str) and text.strip():
                        chunks.append(text.strip())
            return "\n".join(chunks).strip()

        return ""


def _load_json_safely(text: str) -> dict | None:
    normalized = text.strip()
    if not normalized:
        return None

    try:
        parsed = json.loads(normalized)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    matched = re.search(r"\{.*\}", normalized, re.DOTALL)
    if not matched:
        return None

    try:
        parsed = json.loads(matched.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _sanitize_concepts(raw_concepts: list[Any], limit: int) -> list[dict]:
    deduped: dict[str, dict] = {}

    for raw_item in raw_concepts:
        if not isinstance(raw_item, dict):
            continue

        name = _safe_text(raw_item.get("name"))
        if not name or _is_generic_name(name):
            continue

        confidence = _normalize_confidence(raw_item.get("confidence"))
        if confidence < _MIN_CONFIDENCE:
            continue

        aliases = _normalize_aliases(raw_item.get("aliases"), name)
        reason = _safe_text(raw_item.get("reason")) or "基于智谱 Web Search 自动匹配"
        code = _safe_text(raw_item.get("code")) or None
        normalized_name = _normalize_name(name)
        candidate = {
            "name": name,
            "code": code,
            "aliases": aliases,
            "confidence": round(confidence, 2),
            "reason": reason,
            "source": "zhipu_web_search",
        }

        existing = deduped.get(normalized_name)
        if not existing or candidate["confidence"] > existing["confidence"]:
            deduped[normalized_name] = candidate

    ranked = sorted(deduped.values(), key=lambda item: item["confidence"], reverse=True)
    return ranked[:limit]


def _normalize_confidence(raw_value: Any) -> float:
    if raw_value is None:
        return 0.0

    if isinstance(raw_value, (int, float)):
        parsed = float(raw_value)
    else:
        text = _safe_text(raw_value).replace("%", "")
        if not text:
            return 0.0
        try:
            parsed = float(text)
        except ValueError:
            return 0.0
        if parsed > 1.0:
            parsed = parsed / 100.0

    return max(0.0, min(1.0, parsed))


def _normalize_aliases(raw_value: Any, concept_name: str) -> list[str]:
    if isinstance(raw_value, list):
        aliases = [_safe_text(item) for item in raw_value]
    elif isinstance(raw_value, str):
        aliases = [_safe_text(item) for item in re.split(r"[,，、;；/]+", raw_value)]
    else:
        aliases = []

    cleaned = []
    seen: set[str] = set()
    normalized_name = _normalize_name(concept_name)

    for alias in aliases:
        if not alias:
            continue
        normalized_alias = _normalize_name(alias)
        if not normalized_alias or normalized_alias == normalized_name:
            continue
        if normalized_alias in seen:
            continue
        seen.add(normalized_alias)
        cleaned.append(alias)

    return cleaned


def _is_generic_name(name: str) -> bool:
    normalized = _normalize_name(name)
    if not normalized:
        return True
    if normalized in _GENERIC_EXACT_NAMES:
        return True
    return any(keyword in normalized for keyword in _GENERIC_KEYWORDS)


def _normalize_name(value: str) -> str:
    return re.sub(r"[\s_]+", "", value.strip().lower())


def _safe_text(raw_value: Any) -> str:
    if raw_value is None:
        return ""
    return str(raw_value).strip()
