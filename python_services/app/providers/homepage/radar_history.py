"""为首页固定快照生成新闻事件及其相关历史时间线。"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime, timedelta
import hashlib
import json
from typing import Any, Protocol
from zoneinfo import ZoneInfo

_SHANGHAI = ZoneInfo("Asia/Shanghai")
_TRACE_WINDOW_DAYS = 30
_DEFAULT_CURRENT_DAYS = 7
_DEFAULT_TRACE_DAYS = 365
_DEFAULT_MAX_EVENTS = 30
_DEFAULT_FEATURED_EVENTS = 3
_MAX_HISTORICAL_EVENTS = 5
_MAX_TRACE_WORKERS = 4
_HISTORY_VERSION = "homepage-news-radar.v1"


class RadarProvider(Protocol):
    def get_radar(self, **kwargs: Any) -> Any: ...


def _warning_text(value: Any) -> str:
    code = str(getattr(value, "code", "") or "").strip()
    message = str(getattr(value, "message", "") or value).strip()
    return f"{code}:{message}" if code else message


def _event_id(item: dict[str, Any]) -> str:
    value = str(item.get("id") or item.get("sourceItemId") or "").strip()
    if value:
        return value
    encoded = json.dumps(item, ensure_ascii=False, sort_keys=True, default=str)
    return f"news:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"


def _published_at(item: dict[str, Any]) -> datetime | None:
    value = item.get("publishedAt") or item.get("published_at")
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=_SHANGHAI)
    return parsed.astimezone(_SHANGHAI)


def _trace_anchor(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": event.get("title", ""),
        "summary": event.get("summary", ""),
        "eventType": event.get("eventType", ""),
        "relatedStocks": event.get("relatedStocks") or [],
        "scopeTags": event.get("scopeTags") or [],
    }


def _timeline_item(event: dict[str, Any], anchor_id: str) -> dict[str, Any] | None:
    event_id = _event_id(event)
    published_at = event.get("publishedAt") or event.get("published_at")
    if not published_at or not event.get("title"):
        return None
    return {
        "id": f"{anchor_id}:timeline:{event_id}",
        "occurredAt": str(published_at),
        "title": str(event.get("title") or ""),
        "summary": str(event.get("summary") or event.get("content") or ""),
        "eventId": event_id,
        "url": event.get("url"),
        "source": str(event.get("source") or "新闻源"),
        "evidenceItemIds": [],
        "kind": "observed",
    }


def _trace_one_event(
    provider: RadarProvider,
    event: dict[str, Any],
    *,
    trace_days: int,
) -> tuple[str, list[dict[str, Any]], list[str]]:
    anchor_id = _event_id(event)
    event_time = _published_at(event)
    if event_time is None:
        return anchor_id, [], [f"trace_invalid_event_time:{anchor_id}"]

    windows = (trace_days + _TRACE_WINDOW_DAYS - 1) // _TRACE_WINDOW_DAYS
    jobs = [
        (index, event_time - timedelta(days=index * _TRACE_WINDOW_DAYS))
        for index in range(windows)
    ]
    batches: list[tuple[int, list[dict[str, Any]], list[str]]] = []

    def fetch_window(job: tuple[int, datetime]):
        index, end_at = job
        try:
            result = provider.get_radar(
                companies=(),
                industries=(),
                days=_TRACE_WINDOW_DAYS,
                limit=30,
                end_at=end_at,
                include_macro=False,
                trace_anchor=_trace_anchor(event),
            )
            item_warnings = [
                str(warning)
                for item in result.items
                for warning in item.get("warnings") or []
                if str(warning).strip()
            ]
            return index, [dict(item) for item in result.items], [
                _warning_text(warning) for warning in result.warnings
            ] + item_warnings
        except Exception as exc:  # noqa: BLE001
            return index, [], [
                f"homepage_trace_window_failed:{type(exc).__name__}:{exc}"
            ]

    with ThreadPoolExecutor(
        max_workers=min(_MAX_TRACE_WORKERS, max(1, len(jobs)))
    ) as executor:
        futures = [executor.submit(fetch_window, job) for job in jobs]
        for future in as_completed(futures):
            batches.append(future.result())

    historical_by_id: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    for _, items, batch_warnings in sorted(batches):
        warnings.extend(batch_warnings)
        for item in items:
            item_id = _event_id(item)
            item_time = _published_at(item)
            if item_id == anchor_id or item_time is None or item_time >= event_time:
                continue
            historical_by_id.setdefault(item_id, item)

    historical = sorted(
        historical_by_id.values(),
        key=lambda item: str(item.get("publishedAt") or item.get("published_at") or ""),
        reverse=True,
    )[:_MAX_HISTORICAL_EVENTS]
    return anchor_id, historical, warnings


def build_radar_history(
    provider: RadarProvider,
    *,
    end_at: datetime,
    current_days: int = _DEFAULT_CURRENT_DAYS,
    trace_days: int = _DEFAULT_TRACE_DAYS,
    max_events: int = _DEFAULT_MAX_EVENTS,
    featured_events: int = _DEFAULT_FEATURED_EVENTS,
) -> dict[str, Any]:
    """生成可直接固化进首页 manifest 的 overview 影响映射结果。"""

    current_result = provider.get_radar(
        companies=(),
        industries=(),
        days=current_days,
        limit=max_events,
        end_at=end_at,
        include_macro=True,
        trace_anchor=None,
    )
    current_items = [dict(item) for item in current_result.items]
    warnings = [_warning_text(warning) for warning in current_result.warnings]
    for item in current_items:
        warnings.extend(
            str(warning)
            for warning in item.get("warnings") or []
            if str(warning).strip()
        )
    current_items.sort(
        key=lambda item: (
            float(item.get("relevanceScore") or 0),
            str(item.get("publishedAt") or ""),
        ),
        reverse=True,
    )
    featured = current_items[: max(0, min(featured_events, 3))]
    history_by_event: dict[str, list[dict[str, Any]]] = {}
    if featured and trace_days > 0:
        with ThreadPoolExecutor(max_workers=len(featured)) as executor:
            futures = [
                executor.submit(
                    _trace_one_event,
                    provider,
                    event,
                    trace_days=trace_days,
                )
                for event in featured
            ]
            for future in as_completed(futures):
                event_id, historical, event_warnings = future.result()
                history_by_event[event_id] = historical
                warnings.extend(event_warnings)

    radar_events: list[dict[str, Any]] = []
    for event in current_items:
        event_id = _event_id(event)
        timeline_events = [event, *history_by_event.get(event_id, [])]
        timeline = [
            item
            for item in (
                _timeline_item(candidate, event_id) for candidate in timeline_events
            )
            if item is not None
        ]
        timeline.sort(key=lambda item: item["occurredAt"])
        event_warnings = list(warnings) if event_id in history_by_event else []
        enriched = {
            "event": event,
            "impactEdges": [],
            "portfolioHits": [],
            "importanceScore": float(event.get("relevanceScore") or 0.5),
        }
        if event_id in { _event_id(item) for item in featured }:
            enriched["analysis"] = {
                "timeline": timeline,
                "scenarios": [],
                "historyReady": True,
                "historyVersion": _HISTORY_VERSION,
                "traceState": {
                    "oldestOccurredAt": timeline[0]["occurredAt"] if timeline else None,
                    "tracedDays": trace_days,
                    "eventCount": len(timeline),
                    "canContinue": False,
                },
                "warnings": event_warnings,
            }
        radar_events.append(enriched)

    status = "partial" if warnings else "complete"
    as_of = end_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return {
        "mode": "overview",
        "analysisStatus": status,
        "asOf": as_of,
        "context": {
            "watchLists": [],
            "companies": [],
            "industries": [],
            "hypotheses": [],
        },
        "events": radar_events,
        "impactEdges": [],
        "timeline": [],
        "scenarios": [],
        "evidenceCitations": [],
        "warnings": list(dict.fromkeys(warnings)),
        "featuredEventIds": [_event_id(event) for event in featured],
        "historyVersion": _HISTORY_VERSION,
    }
