from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from app.providers.homepage import DataCutoff, HomepageDataItemRequest, MinishareHomepageProviderAdapter
from app.providers.homepage.radar_history import build_radar_history


def _event(event_id: str, published_at: str, score: float) -> dict:
    return {
        "id": event_id,
        "title": event_id,
        "summary": "同一核心主题",
        "source": "测试新闻源",
        "publishedAt": published_at,
        "sentiment": "neutral",
        "relevanceScore": score,
        "relatedStocks": [],
        "scopeTags": ["macro"],
        "eventType": "news",
        "matchReason": "测试",
    }


class _RadarProvider:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def get_radar(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("trace_anchor"):
            return SimpleNamespace(
                items=[
                    _event("history", "2026-07-20T10:00:00+08:00", 0.8),
                    _event("future", "2026-08-05T10:00:00+08:00", 0.9),
                ],
                warnings=[],
            )
        return SimpleNamespace(
            items=[_event("current", "2026-08-04T10:00:00+08:00", 0.9)],
            warnings=[],
        )


def test_history_keeps_only_prior_events_and_builds_timeline() -> None:
    provider = _RadarProvider()

    result = build_radar_history(
        provider,
        end_at=datetime.fromisoformat("2026-08-04T23:59:59+08:00"),
        trace_days=30,
    )

    timeline = result["events"][0]["analysis"]["timeline"]
    assert [item["eventId"] for item in timeline] == ["history", "current"]
    assert result["featuredEventIds"] == ["current"]
    assert all(call.get("trace_anchor") for call in provider.calls[1:])


def test_minishare_homepage_adapter_persists_history_as_one_json_observation() -> None:
    provider = _RadarProvider()
    adapter = MinishareHomepageProviderAdapter(
        client=object(),
        radar_provider=provider,
    )
    request = HomepageDataItemRequest(
        dataset_key="news.radar_history",
        requested_scope={
            "targetTradeDate": "2026-08-04",
            "phase": "POST_MARKET",
            "endAt": "2026-08-04T23:59:59+08:00",
            "currentDays": 7,
            "traceDays": 30,
            "maxEvents": 30,
            "featuredEvents": 3,
        },
        target_data_cutoff=DataCutoff(
            "published_at", "2026-08-04T23:59:59+08:00"
        ),
    )

    result = adapter.fetch(request)

    assert result.result_status == "success"
    history = result.observations[0].value_json
    assert history["events"][0]["analysis"]["timeline"][0]["eventId"] == "history"
    assert result.actual_data_cutoff == request.target_data_cutoff
