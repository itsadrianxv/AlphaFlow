"""In-process metrics recorder for gateway observability."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
import threading
from typing import Any


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class _Observation:
    count: int = 0
    total: float = 0.0
    min: float | None = None
    max: float | None = None
    last: float | None = None

    def observe(self, value: float) -> None:
        self.count += 1
        self.total += value
        self.last = value
        self.min = value if self.min is None else min(self.min, value)
        self.max = value if self.max is None else max(self.max, value)

    def to_dict(self) -> dict[str, float | int | None]:
        average = self.total / self.count if self.count else 0.0
        return {
            "count": self.count,
            "total": round(self.total, 4),
            "avg": round(average, 4),
            "min": None if self.min is None else round(self.min, 4),
            "max": None if self.max is None else round(self.max, 4),
            "last": None if self.last is None else round(self.last, 4),
        }


class MetricsRecorder:
    def __init__(self) -> None:
        self._counter_store: dict[str, dict[tuple[tuple[str, str], ...], float]] = defaultdict(dict)
        self._observation_store: dict[str, dict[tuple[tuple[str, str], ...], _Observation]] = defaultdict(dict)
        self._lock = threading.Lock()

    def clear(self) -> None:
        with self._lock:
            self._counter_store.clear()
            self._observation_store.clear()

    def increment(
        self,
        name: str,
        value: float = 1.0,
        labels: dict[str, Any] | None = None,
    ) -> None:
        label_key = self._normalize_labels(labels)
        with self._lock:
            current = self._counter_store[name].get(label_key, 0.0)
            self._counter_store[name][label_key] = current + value

    def observe(
        self,
        name: str,
        value: float,
        labels: dict[str, Any] | None = None,
    ) -> None:
        label_key = self._normalize_labels(labels)
        with self._lock:
            series = self._observation_store[name].get(label_key)
            if series is None:
                series = _Observation()
                self._observation_store[name][label_key] = series
            series.observe(value)

    def record_provider_latency(self, dataset: str, provider: str, latency_ms: float) -> None:
        self.observe(
            "provider_request_latency_ms",
            latency_ms,
            labels={"dataset": dataset, "provider": provider},
        )

    def record_provider_error(self, dataset: str, provider: str, code: str) -> None:
        self.increment(
            "provider_error_count",
            labels={"dataset": dataset, "provider": provider, "code": code},
        )

    def record_cache_result(
        self,
        dataset: str,
        provider: str,
        cache_hit: bool,
        is_stale: bool,
    ) -> None:
        labels = {"dataset": dataset, "provider": provider}
        self.observe("cache_hit_ratio", 1.0 if cache_hit else 0.0, labels=labels)
        self.observe("stale_fallback_ratio", 1.0 if is_stale else 0.0, labels=labels)

    def record_retry(self, dataset: str, provider: str) -> None:
        self.increment(
            "retry_count",
            labels={"dataset": dataset, "provider": provider},
        )

    def record_empty_payload(self, dataset: str, provider: str, is_empty: bool) -> None:
        self.observe(
            "empty_payload_ratio",
            1.0 if is_empty else 0.0,
            labels={"dataset": dataset, "provider": provider},
        )

    def record_batch_success(
        self,
        dataset: str,
        provider: str,
        success_count: int,
        total_count: int,
    ) -> None:
        ratio = 0.0 if total_count <= 0 else success_count / total_count
        self.observe(
            "batch_success_ratio",
            ratio,
            labels={"dataset": dataset, "provider": provider},
        )

    def record_concept_match_source(self, source: str, theme: str | None = None) -> None:
        labels = {"source": source}
        if theme:
            labels["theme"] = theme
        self.increment("concept_match_source_distribution", labels=labels)

    def record_theme_request(self, dataset: str, theme: str) -> None:
        self.increment(
            "theme_request_count",
            labels={"dataset": dataset, "theme": theme},
        )

    def top_themes(self, limit: int = 5) -> list[str]:
        with self._lock:
            raw_series = dict(self._counter_store.get("theme_request_count", {}))

        ranking: dict[str, float] = defaultdict(float)
        for label_key, value in raw_series.items():
            labels = dict(label_key)
            theme = labels.get("theme", "").strip()
            if theme:
                ranking[theme] += value

        ordered = sorted(ranking.items(), key=lambda item: (-item[1], item[0]))
        return [theme for theme, _ in ordered[:limit]]

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            counter_store = {
                name: dict(series) for name, series in self._counter_store.items()
            }
            observation_store = {
                name: dict(series) for name, series in self._observation_store.items()
            }

        return {
            "capturedAt": _iso_now(),
            "counters": {
                name: [
                    {
                        "labels": dict(label_key),
                        "value": round(value, 4),
                    }
                    for label_key, value in sorted(series.items())
                ]
                for name, series in sorted(counter_store.items())
            },
            "observations": {
                name: [
                    {
                        "labels": dict(label_key),
                        **observation.to_dict(),
                    }
                    for label_key, observation in sorted(series.items())
                ]
                for name, series in sorted(observation_store.items())
            },
        }

    @staticmethod
    def _normalize_labels(labels: dict[str, Any] | None) -> tuple[tuple[str, str], ...]:
        if labels is None:
            return ()
        return tuple(sorted((str(key), str(value)) for key, value in labels.items() if value is not None))


metrics_recorder = MetricsRecorder()

