"""Minishare 原始新闻能力，只负责请求、校验和字段标准化。"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
import hashlib
import os
import re
from typing import Literal
from zoneinfo import ZoneInfo

import pandas as pd

from app.gateway.common import GatewayError

NewsSourceKind = Literal["fast", "major", "cctv"]
_SHANGHAI = ZoneInfo("Asia/Shanghai")


@dataclass(frozen=True)
class RawNewsRecord:
    sourceKind: NewsSourceKind
    sourceName: str
    url: str | None
    title: str
    content: str
    publishedAt: str
    contentHash: str
    sourceItemId: str

    def to_dict(self) -> dict:
        return asdict(self)


class MinishareNewsClient:
    """Minishare 三类新闻接口的薄封装。"""

    def __init__(self, token: str | None = None) -> None:
        self.token = (token or os.getenv("MINISHARE_TOKEN", "")).strip()

    def fetch_fast_news(
        self,
        start_at: datetime,
        end_at: datetime,
        limit: int = 500,
        offset: int = 0,
        src: str | None = None,
    ) -> list[RawNewsRecord]:
        kwargs: dict[str, object] = {
            "start_date": _format_datetime(start_at),
            "end_date": _format_datetime(end_at),
            "limit": min(1500, max(1, limit)),
            "offset": max(0, offset),
        }
        if src:
            kwargs["src"] = src
        frame = self._call("news", **kwargs)
        self._require_columns(frame, {"datetime", "content"}, "新闻快讯")
        records: list[RawNewsRecord] = []
        for row in frame.fillna("").to_dict(orient="records"):
            content = _text(row.get("content"))
            published_at = _normalize_datetime(row.get("datetime"))
            if not content or not published_at:
                continue
            records.append(
                _record(
                    source_kind="fast",
                    source_name=src or "minishare:news",
                    url=None,
                    title=_headline(content, "新闻快讯"),
                    content=content,
                    published_at=published_at,
                )
            )
        return records

    def fetch_major_news(
        self,
        start_at: datetime,
        end_at: datetime,
    ) -> list[RawNewsRecord]:
        frame = self._call(
            "major_news",
            start_date=_format_datetime(start_at),
            end_date=_format_datetime(end_at),
        )
        self._require_columns(
            frame,
            {"title", "pub_time", "src", "url", "content"},
            "长新闻",
        )
        records: list[RawNewsRecord] = []
        for row in frame.fillna("").to_dict(orient="records"):
            content = _text(row.get("content"))
            published_at = _normalize_datetime(row.get("pub_time"))
            if not content or not published_at:
                continue
            records.append(
                _record(
                    source_kind="major",
                    source_name=_text(row.get("src")) or "minishare:major_news",
                    url=_text(row.get("url")) or None,
                    title=_text(row.get("title")) or _headline(content, "长新闻"),
                    content=content,
                    published_at=published_at,
                )
            )
        return records

    def fetch_cctv_news(self, target_date: date | str) -> list[RawNewsRecord]:
        date_value = (
            target_date.strftime("%Y%m%d")
            if isinstance(target_date, date)
            else str(target_date).replace("-", "")
        )
        frame = self._call("cctv_news", date=date_value)
        self._require_columns(frame, {"date", "title", "content"}, "CCTV 新闻")
        records: list[RawNewsRecord] = []
        for row in frame.fillna("").to_dict(orient="records"):
            content = _text(row.get("content"))
            published_at = _normalize_date(row.get("date") or date_value)
            if not content or not published_at:
                continue
            records.append(
                _record(
                    source_kind="cctv",
                    source_name="CCTV 新闻联播",
                    url=None,
                    title=_text(row.get("title")) or _headline(content, "新闻联播"),
                    content=content,
                    published_at=published_at,
                )
            )
        return records

    def _call(self, method: str, **kwargs: object) -> pd.DataFrame:
        if not self.token:
            raise GatewayError(
                code="minishare_not_configured",
                message="MINISHARE_TOKEN 未配置",
                status_code=503,
                provider="minishare",
            )
        try:
            import minishare as ms

            frame = getattr(ms.pro_api(self.token), method)(**kwargs)
        except Exception as exc:  # noqa: BLE001
            raise GatewayError(
                code=f"minishare_{method}_failed",
                message=f"Minishare {method} 请求失败: {exc}",
                status_code=502,
                provider="minishare",
            ) from exc
        if not isinstance(frame, pd.DataFrame):
            raise GatewayError(
                code=f"minishare_{method}_invalid_response",
                message=f"Minishare {method} 未返回 DataFrame",
                status_code=502,
                provider="minishare",
            )
        return frame

    @staticmethod
    def _require_columns(frame: pd.DataFrame, columns: set[str], label: str) -> None:
        missing = sorted(columns.difference(frame.columns))
        if missing:
            raise GatewayError(
                code="minishare_news_invalid_response",
                message=f"Minishare {label}响应缺少字段: {', '.join(missing)}",
                status_code=502,
                provider="minishare",
            )


def _record(
    *,
    source_kind: NewsSourceKind,
    source_name: str,
    url: str | None,
    title: str,
    content: str,
    published_at: str,
) -> RawNewsRecord:
    content_hash = hashlib.sha256(_normalize_text(content).encode("utf-8")).hexdigest()
    source_item_id = hashlib.sha256(
        f"{source_kind}|{published_at}|{title}|{content_hash}".encode("utf-8")
    ).hexdigest()[:24]
    return RawNewsRecord(
        sourceKind=source_kind,
        sourceName=source_name,
        url=url,
        title=title,
        content=content,
        publishedAt=published_at,
        contentHash=content_hash,
        sourceItemId=source_item_id,
    )


def _format_datetime(value: datetime) -> str:
    return value.astimezone(_SHANGHAI).strftime("%Y-%m-%d %H:%M:%S")


def _normalize_datetime(value: object) -> str | None:
    normalized = _text(value).replace("Z", "+00:00")
    if not normalized:
        return None
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_SHANGHAI)
    return parsed.astimezone(_SHANGHAI).isoformat()


def _normalize_date(value: object) -> str | None:
    normalized = re.sub(r"\D", "", _text(value))[:8]
    try:
        parsed = datetime.strptime(normalized, "%Y%m%d").replace(tzinfo=_SHANGHAI)
    except ValueError:
        return None
    return parsed.isoformat()


def _headline(content: str, fallback: str) -> str:
    normalized = re.sub(r"^【([^】]+)】", r"\1", content).strip()
    return re.split(r"[。；;\n]", normalized, maxsplit=1)[0][:80] or fallback


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def _text(value: object) -> str:
    return str(value or "").strip()
