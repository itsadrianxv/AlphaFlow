"""Unified gateway for timing bars, multi-engine signal context, and market context."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import time

import pandas as pd

from app.contracts.common import BatchItemError
from app.contracts.meta import GatewayWarning
from app.contracts.timing import (
    MarketBreadthPoint,
    MarketContextFeatureSnapshot,
    MarketContextSnapshotData,
    MarketContextSnapshotResponse,
    MarketIndexSnapshot,
    MarketLeadershipPoint,
    MarketVolatilityPoint,
    TimingBar,
    TimingBarsData,
    TimingBarsResponse,
    TimingSignalBatchData,
    TimingSignalBatchResponse,
    TimingSignalData,
    TimingSignalResponse,
)
from app.data_providers import get_default_data_provider
from app.data_providers.contracts import DataProvider, DailyBar, MarketSnapshotRow, StockProfile
from app.data_providers.errors import (
    DataProviderConfigurationError,
    DataProviderError,
    DataUnavailableError,
    InvalidSymbolError,
    UnsupportedDatasetError,
)
from app.gateway.common import GatewayError, build_meta, execute_cached, gateway_cache
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy
from app.services.timing_indicators import timing_indicators_service

SIGNAL_BENCHMARK_CODES = ["510300", "510500", "159915"]
MARKET_PROXY_CODES = [
    ("510300", "CSI 300 ETF"),
    ("510500", "CSI 500 ETF"),
    ("159915", "ChiNext ETF"),
    ("588000", "STAR 50 ETF"),
]


class TimingGateway:
    def __init__(
        self,
        data_provider: DataProvider | None = None,
        signal_data_provider: DataProvider | None = None,
        market_context_provider: DataProvider | None = None,
    ) -> None:
        provider = data_provider or get_default_data_provider()
        self._signal_data_provider = signal_data_provider or provider
        self._market_context_provider = market_context_provider or provider
        self._retry_policy = RetryPolicy()
        self._cache = gateway_cache

    def get_bars(
        self,
        *,
        request_id: str,
        stock_code: str,
        start: str | None,
        end: str | None,
        timeframe: str,
        adjust: str,
        force_refresh: bool = False,
    ) -> TimingBarsResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="timing_bars",
            provider=self._signal_data_provider.provider_name,
            params={
                "stockCode": stock_code,
                "start": start,
                "end": end,
                "timeframe": timeframe,
                "adjust": adjust,
            },
            fetcher=lambda: self._build_bars_data(
                stock_code=stock_code,
                start=start,
                end=end,
                timeframe=timeframe,
                adjust=adjust,
            ),
            cache_policy=get_cache_policy("timing_bars"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return TimingBarsResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=result.data,
        )

    def get_signal(
        self,
        *,
        request_id: str,
        stock_code: str,
        as_of_date: str | None,
        lookback_days: int | None,
        include_bars: bool = False,
        force_refresh: bool = False,
    ) -> TimingSignalResponse:
        started_at = time.perf_counter()
        result = self._get_signal_result(
            stock_code=stock_code,
            as_of_date=as_of_date,
            lookback_days=lookback_days,
            include_bars=include_bars,
            force_refresh=force_refresh,
        )

        return TimingSignalResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=result.data,
        )

    def get_signal_batch(
        self,
        *,
        request_id: str,
        stock_codes: list[str],
        as_of_date: str | None,
        lookback_days: int | None,
        include_bars: bool = False,
        force_refresh: bool = False,
    ) -> TimingSignalBatchResponse:
        started_at = time.perf_counter()
        items: list[TimingSignalData] = []
        errors: list[BatchItemError] = []
        warnings: list[GatewayWarning] = []
        cache_hits: list[bool] = []
        stale_hits: list[bool] = []
        as_of_values: list[str] = []
        stock_snapshots = self._get_stock_snapshots(self._signal_data_provider, stock_codes)
        benchmark_histories = self._load_signal_benchmark_histories(
            as_of_date=as_of_date,
            lookback_days=lookback_days,
        )

        for stock_code in stock_codes:
            try:
                result = self._get_signal_result(
                    stock_code=stock_code,
                    as_of_date=as_of_date,
                    lookback_days=lookback_days,
                    include_bars=include_bars,
                    force_refresh=force_refresh,
                    stock=stock_snapshots.get(stock_code),
                    benchmark_histories=benchmark_histories,
                )
                items.append(result.data)
                cache_hits.append(result.cache_hit)
                stale_hits.append(result.is_stale)
                as_of_values.append(result.as_of)
                warnings.extend(result.warnings)
            except Exception as exc:  # noqa: BLE001
                errors.append(
                    BatchItemError(
                        stockCode=stock_code,
                        code=str(getattr(exc, "code", "signal_fetch_failed")),
                        message=str(exc),
                    ),
                )

        if errors:
            warnings.append(
                GatewayWarning(
                    code="partial_results",
                    message="批量择时信号存在部分失败，详情见 data.errors",
                ),
            )

        return TimingSignalBatchResponse(
            meta=build_meta(
                request_id=request_id,
                provider=self._signal_data_provider.provider_name,
                started_at=started_at,
                cache_hit=bool(items) and all(cache_hits),
                is_stale=any(stale_hits),
                warnings=self._dedupe_warnings(warnings),
                as_of=max(as_of_values)
                if as_of_values
                else datetime.now(UTC).isoformat(),
            ),
            data=TimingSignalBatchData(items=items, errors=errors),
        )

    def get_market_context(
        self,
        *,
        request_id: str,
        as_of_date: str | None = None,
        force_refresh: bool = False,
    ) -> MarketContextSnapshotResponse:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="timing_market_context",
            provider=self._market_context_provider.provider_name,
            params={"asOfDate": as_of_date},
            fetcher=lambda: self._build_market_context(as_of_date=as_of_date),
            cache_policy=get_cache_policy("timing_signal"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

        return MarketContextSnapshotResponse(
            meta=build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ),
            data=result.data,
        )

    def _build_bars_data(
        self,
        *,
        stock_code: str,
        start: str | None,
        end: str | None,
        timeframe: str,
        adjust: str,
    ) -> TimingBarsData:
        stock = self._get_stock_snapshot(self._signal_data_provider, stock_code)
        resolved_start = (
            self._resolve_start_date(
                start=start,
                end=end,
                lookback_days=timing_indicators_service.minimum_lookback_days * 2,
            )
            if start is None
            else self._resolve_start_date(start=start, end=end, lookback_days=0)
        )
        try:
            history = self._get_stock_bars(
                self._signal_data_provider,
                stock_code=stock_code,
                start_date=resolved_start,
                end_date=end,
                adjust=adjust,
            )
        except GatewayError as error:
            if error.code != "bars_not_found" or start is not None:
                raise
            history = self._get_stock_bars(
                self._signal_data_provider,
                stock_code=stock_code,
                start_date=None,
                end_date=end,
                adjust=adjust,
            )

        normalized = timing_indicators_service.normalize_history(history)
        bars = [
            TimingBar(
                tradeDate=row.trade_date.strftime("%Y-%m-%d"),
                open=round(float(row.open), 4),
                high=round(float(row.high), 4),
                low=round(float(row.low), 4),
                close=round(float(row.close), 4),
                volume=round(float(row.volume), 4),
                amount=None if row.amount is None else round(float(row.amount), 4),
                turnoverRate=None
                if row.turnover_rate is None
                else round(float(row.turnover_rate), 4),
            )
            for row in normalized.itertuples(index=False)
        ]

        return TimingBarsData(
            stockCode=stock_code,
            stockName=str(stock.get("name") or stock.get("stockName") or stock_code),
            timeframe=timeframe,
            adjust=adjust,
            bars=bars,
        )

    def _get_signal_result(
        self,
        *,
        stock_code: str,
        as_of_date: str | None,
        lookback_days: int | None,
        include_bars: bool,
        force_refresh: bool,
        stock: dict[str, str] | None = None,
        benchmark_histories: dict[str, pd.DataFrame] | None = None,
    ):
        effective_lookback = max(
            lookback_days or timing_indicators_service.minimum_lookback_days,
            timing_indicators_service.minimum_lookback_days,
        )

        return execute_cached(
            dataset="timing_signal",
            provider=self._signal_data_provider.provider_name,
            params={
                "stockCode": stock_code,
                "asOfDate": as_of_date,
                "lookbackDays": effective_lookback,
                "includeBars": include_bars,
            },
            fetcher=lambda: self._build_signal_data(
                stock_code=stock_code,
                as_of_date=as_of_date,
                lookback_days=effective_lookback,
                include_bars=include_bars,
                stock=stock,
                benchmark_histories=benchmark_histories,
            ),
            cache_policy=get_cache_policy("timing_signal"),
            retry_policy=self._retry_policy,
            cache=self._cache,
            force_refresh=force_refresh,
        )

    def _build_signal_data(
        self,
        *,
        stock_code: str,
        as_of_date: str | None,
        lookback_days: int,
        include_bars: bool,
        stock: dict[str, str] | None = None,
        benchmark_histories: dict[str, pd.DataFrame] | None = None,
    ) -> TimingSignalData:
        stock_snapshot = stock or self._get_stock_snapshot(self._signal_data_provider, stock_code)
        history = self._get_stock_bars(
            self._signal_data_provider,
            stock_code=stock_code,
            start_date=self._resolve_start_date(
                start=None,
                end=as_of_date,
                lookback_days=lookback_days * 2,
            ),
            end_date=as_of_date,
            adjust="qfq",
        )

        effective_benchmark_histories = (
            benchmark_histories
            if benchmark_histories is not None
            else self._load_signal_benchmark_histories(
                as_of_date=as_of_date,
                lookback_days=lookback_days,
            )
        )

        return timing_indicators_service.build_signal(
            stock_code=stock_code,
            stock_name=str(
                stock_snapshot.get("name")
                or stock_snapshot.get("stockName")
                or stock_code
            ),
            history=history,
            benchmark_histories=effective_benchmark_histories,
            as_of_date=as_of_date,
            include_bars=include_bars,
        )

    def _build_market_context(
        self,
        *,
        as_of_date: str | None,
    ) -> MarketContextSnapshotData:
        universe = self._get_market_snapshot(
            self._market_context_provider,
            as_of_date=as_of_date,
        )

        change_values = [
            float(item.changePercent or 0)
            for item in universe
            if item.changePercent is not None
        ]
        turnover_values = [
            float(item.turnoverRate or 0)
            for item in universe
            if item.turnoverRate is not None
        ]

        index_frames: dict[str, pd.DataFrame] = {}
        indexes: list[MarketIndexSnapshot] = []
        resolved_as_of = self._resolve_universe_as_of(universe) or as_of_date

        for code, fallback_name in MARKET_PROXY_CODES:
            stock = self._get_stock_snapshot(self._market_context_provider, code)
            history = self._get_stock_bars(
                self._market_context_provider,
                stock_code=code,
                start_date=self._resolve_start_date(
                    start=None,
                    end=as_of_date,
                    lookback_days=260,
                ),
                end_date=as_of_date,
                adjust="qfq",
            )
            normalized = timing_indicators_service.normalize_history(history)
            sliced = timing_indicators_service.slice_as_of(normalized, as_of_date)
            enriched = timing_indicators_service.calculate_indicators(sliced)
            latest = enriched.iloc[-1]
            previous_close = float(enriched.iloc[-2]["close"]) if len(enriched.index) >= 2 else float(latest["close"])
            change_pct = ((float(latest["close"]) / max(previous_close, 0.0001)) - 1) * 100
            atr_ratio = float(latest["atr14"] / max(latest["close"], 0.0001))
            resolved_as_of = latest["trade_date"].strftime("%Y-%m-%d")

            index_frames[code] = enriched.tail(20).reset_index(drop=True)
            indexes.append(
                MarketIndexSnapshot(
                    code=code,
                    name=str(stock.get("name") or stock.get("stockName") or fallback_name),
                    close=round(float(latest["close"]), 4),
                    changePct=round(change_pct, 4),
                    return5d=round(float(latest["return_5d"]) * 100, 4),
                    return10d=round(float(latest["return_10d"]) * 100, 4),
                    ema20=round(float(latest["ema20"]), 4),
                    ema60=round(float(latest["ema60"]), 4),
                    aboveEma20=bool(latest["close"] >= latest["ema20"]),
                    aboveEma60=bool(latest["close"] >= latest["ema60"]),
                    atrRatio=round(atr_ratio, 4),
                    signalDirection=self._direction_from_price(float(latest["close"]), float(latest["ema20"]), float(latest["ema60"])),
                )
            )

        latest_breadth = self._build_latest_breadth(change_values, turnover_values, resolved_as_of or datetime.now(UTC).strftime("%Y-%m-%d"))
        latest_volatility = self._build_latest_volatility(change_values, indexes, resolved_as_of or datetime.now(UTC).strftime("%Y-%m-%d"))

        breadth_series, volatility_series, leadership_series = self._build_market_series(
            index_frames=index_frames,
            latest_breadth=latest_breadth,
            latest_volatility=latest_volatility,
        )

        latest_leadership = leadership_series[-1]
        benchmark_strength = round(
            (
                sum(
                    (
                        (1 if item.return5d > 0 else 0)
                        + (1 if item.aboveEma20 else 0)
                        + (1 if item.aboveEma60 else 0)
                    )
                    for item in indexes
                )
                / max(len(indexes) * 3, 1)
            )
            * 100,
            2,
        )
        breadth_score = round(
            min(100, max(0, latest_breadth.positiveRatio * 70 + latest_breadth.aboveThreePctRatio * 30) * 100),
            2,
        )
        risk_score = round(
            min(100, max(0, latest_volatility.highVolatilityRatio * 60 + latest_breadth.belowThreePctRatio * 40) * 100),
            2,
        )
        state_score = round(
            min(100, max(0, benchmark_strength * 0.45 + breadth_score * 0.35 + (100 - risk_score) * 0.2)),
            2,
        )

        return MarketContextSnapshotData(
            asOfDate=resolved_as_of or datetime.now(UTC).strftime("%Y-%m-%d"),
            indexes=indexes,
            latestBreadth=latest_breadth,
            latestVolatility=latest_volatility,
            latestLeadership=latest_leadership,
            breadthSeries=breadth_series,
            volatilitySeries=volatility_series,
            leadershipSeries=leadership_series,
            features=MarketContextFeatureSnapshot(
                benchmarkStrength=benchmark_strength,
                breadthScore=breadth_score,
                riskScore=risk_score,
                stateScore=state_score,
            ),
        )

    def _build_latest_breadth(
        self,
        change_values: list[float],
        turnover_values: list[float],
        as_of_date: str,
    ) -> MarketBreadthPoint:
        total_count = len(change_values)
        advancing_count = len([value for value in change_values if value > 0])
        declining_count = len([value for value in change_values if value < 0])
        flat_count = max(total_count - advancing_count - declining_count, 0)

        return MarketBreadthPoint(
            asOfDate=as_of_date,
            totalCount=total_count,
            advancingCount=advancing_count,
            decliningCount=declining_count,
            flatCount=flat_count,
            positiveRatio=round(advancing_count / total_count, 4) if total_count > 0 else 0.0,
            aboveThreePctRatio=round(len([value for value in change_values if value >= 3]) / max(total_count, 1), 4),
            belowThreePctRatio=round(len([value for value in change_values if value <= -3]) / max(total_count, 1), 4),
            medianChangePct=round(float(pd.Series(change_values).median()), 4) if change_values else 0.0,
            averageTurnoverRate=round(sum(turnover_values) / len(turnover_values), 4) if turnover_values else None,
        )

    def _build_latest_volatility(
        self,
        change_values: list[float],
        indexes: list[MarketIndexSnapshot],
        as_of_date: str,
    ) -> MarketVolatilityPoint:
        total_count = max(len(change_values), 1)
        high_volatility_count = len([value for value in change_values if abs(value) >= 5])
        index_atr_ratio = (
            round(sum(item.atrRatio for item in indexes) / len(indexes), 4)
            if indexes
            else 0.0
        )
        return MarketVolatilityPoint(
            asOfDate=as_of_date,
            highVolatilityCount=high_volatility_count,
            highVolatilityRatio=round(high_volatility_count / total_count, 4),
            limitDownLikeCount=len([value for value in change_values if value <= -9]),
            indexAtrRatio=index_atr_ratio,
        )

    def _build_market_series(
        self,
        *,
        index_frames: dict[str, pd.DataFrame],
        latest_breadth: MarketBreadthPoint,
        latest_volatility: MarketVolatilityPoint,
    ) -> tuple[list[MarketBreadthPoint], list[MarketVolatilityPoint], list[MarketLeadershipPoint]]:
        if not index_frames:
            return [latest_breadth], [latest_volatility], []

        reference_code = next(iter(index_frames))
        reference_frame = index_frames[reference_code]
        breadth_series: list[MarketBreadthPoint] = []
        volatility_series: list[MarketVolatilityPoint] = []
        leadership_series: list[MarketLeadershipPoint] = []
        previous_leader_code: str | None = None

        for row_index in range(len(reference_frame.index)):
            date_text = reference_frame.iloc[row_index]["trade_date"].strftime("%Y-%m-%d")
            proxy_rows = []
            for code, frame in index_frames.items():
                if row_index >= len(frame.index):
                    continue
                proxy_rows.append((code, frame.iloc[row_index]))

            if not proxy_rows:
                continue

            positive_count = len([item for _, item in proxy_rows if float(item["return_1d"]) > 0])
            above_three_count = len([item for _, item in proxy_rows if float(item["return_1d"]) * 100 >= 3])
            below_three_count = len([item for _, item in proxy_rows if float(item["return_1d"]) * 100 <= -3])
            latest_proxy = row_index == len(reference_frame.index) - 1

            breadth_series.append(
                latest_breadth
                if latest_proxy
                else MarketBreadthPoint(
                    asOfDate=date_text,
                    totalCount=len(proxy_rows),
                    advancingCount=positive_count,
                    decliningCount=len([item for _, item in proxy_rows if float(item["return_1d"]) < 0]),
                    flatCount=len([item for _, item in proxy_rows if float(item["return_1d"]) == 0]),
                    positiveRatio=round(positive_count / len(proxy_rows), 4),
                    aboveThreePctRatio=round(above_three_count / len(proxy_rows), 4),
                    belowThreePctRatio=round(below_three_count / len(proxy_rows), 4),
                    medianChangePct=round(float(pd.Series([float(item["return_1d"]) * 100 for _, item in proxy_rows]).median()), 4),
                    averageTurnoverRate=None,
                )
            )

            index_atr_ratio = sum(
                float(item["atr14"] / max(item["close"], 0.0001)) for _, item in proxy_rows
            ) / len(proxy_rows)
            volatility_series.append(
                latest_volatility
                if latest_proxy
                else MarketVolatilityPoint(
                    asOfDate=date_text,
                    highVolatilityCount=len(
                        [item for _, item in proxy_rows if abs(float(item["return_1d"]) * 100) >= 2.5]
                    ),
                    highVolatilityRatio=round(
                        len([item for _, item in proxy_rows if abs(float(item["return_1d"]) * 100) >= 2.5])
                        / len(proxy_rows),
                        4,
                    ),
                    limitDownLikeCount=len(
                        [item for _, item in proxy_rows if float(item["return_1d"]) * 100 <= -4]
                    ),
                    indexAtrRatio=round(index_atr_ratio, 4),
                )
            )

            ranking_5d = [
                code
                for code, _ in sorted(
                    proxy_rows,
                    key=lambda item: float(item[1]["return_5d"]),
                    reverse=True,
                )
            ]
            ranking_10d = [
                code
                for code, _ in sorted(
                    proxy_rows,
                    key=lambda item: float(item[1]["return_10d"]),
                    reverse=True,
                )
            ]
            leader_code = ranking_5d[0]
            switched = previous_leader_code is not None and previous_leader_code != leader_code
            leadership_series.append(
                MarketLeadershipPoint(
                    asOfDate=date_text,
                    leaderCode=leader_code,
                    leaderName=leader_code,
                    ranking5d=ranking_5d,
                    ranking10d=ranking_10d,
                    switched=switched,
                    previousLeaderCode=previous_leader_code,
                )
            )
            previous_leader_code = leader_code

        return breadth_series, volatility_series, leadership_series

    def _direction_from_price(self, close: float, ema20: float, ema60: float) -> str:
        if close >= ema20 >= ema60:
            return "bullish"
        if close <= ema20 <= ema60:
            return "bearish"
        return "neutral"

    def _resolve_universe_as_of(self, universe: list[MarketSnapshotRow]) -> str | None:
        for item in universe:
            if item.tradeDate:
                return item.tradeDate
        return None

    def _get_stock_snapshot(self, provider: DataProvider, stock_code: str) -> dict[str, str]:
        try:
            return self._stock_profile_to_snapshot(provider.get_stock_profile(stock_code))
        except DataProviderError as exc:
            raise self._to_gateway_error(exc) from exc

    def _get_stock_snapshots(
        self,
        provider: DataProvider,
        stock_codes: list[str],
    ) -> dict[str, dict[str, str]]:
        snapshots: dict[str, dict[str, str]] = {}
        for stock_code in stock_codes:
            try:
                snapshot = self._get_stock_snapshot(provider, stock_code)
            except GatewayError:
                continue
            snapshots[stock_code] = snapshot
        return snapshots

    def _get_stock_bars(
        self,
        provider: DataProvider,
        *,
        stock_code: str,
        start_date: str | None,
        end_date: str | None,
        adjust: str,
    ) -> pd.DataFrame:
        try:
            bars = provider.get_daily_bars(
                stock_code=stock_code,
                start_date=start_date,
                end_date=end_date,
                adjust=adjust,
            )
        except DataProviderError as exc:
            raise self._to_gateway_error(exc, dataset="bars") from exc
        if not bars:
            raise GatewayError(
                code="bars_not_found",
                message=f"Daily bars not found for {stock_code}",
                status_code=404,
                provider=provider.provider_name,
            )
        return self._daily_bars_to_timing_frame(bars)

    def _get_benchmark_bars(
        self,
        provider: DataProvider,
        *,
        benchmark_code: str,
        start_date: str | None,
        end_date: str | None,
    ) -> pd.DataFrame:
        return self._get_stock_bars(
            provider,
            stock_code=benchmark_code,
            start_date=start_date,
            end_date=end_date,
            adjust="qfq",
        )

    def _get_market_snapshot(
        self,
        provider: DataProvider,
        *,
        as_of_date: str | None,
    ) -> list[MarketSnapshotRow]:
        try:
            return provider.get_market_snapshot(as_of_date=as_of_date)
        except DataProviderError as exc:
            raise self._to_gateway_error(exc) from exc

    def _stock_profile_to_snapshot(self, profile: StockProfile) -> dict[str, str]:
        return {
            "code": profile.stockCode,
            "name": profile.stockName,
            "industry": profile.industry,
            "stockName": profile.stockName,
        }

    def _daily_bars_to_timing_frame(self, bars: list[DailyBar]) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "日期": [bar.tradeDate for bar in bars],
                "股票代码": [bar.stockCode for bar in bars],
                "开盘": [bar.open for bar in bars],
                "收盘": [bar.close for bar in bars],
                "最高": [bar.high for bar in bars],
                "最低": [bar.low for bar in bars],
                "成交量": [bar.volume for bar in bars],
                "成交额": [bar.amount for bar in bars],
                "换手率": [bar.turnoverRate for bar in bars],
            }
        ).reset_index(drop=True)

    def _to_gateway_error(
        self,
        error: DataProviderError,
        *,
        dataset: str | None = None,
    ) -> GatewayError:
        if isinstance(error, UnsupportedDatasetError):
            return GatewayError(
                code="invalid_adjust",
                message=str(error),
                status_code=400,
                provider=error.provider,
            )
        if isinstance(error, InvalidSymbolError):
            return GatewayError(
                code="stock_not_found",
                message=str(error),
                status_code=404,
                provider=error.provider,
            )
        if isinstance(error, DataUnavailableError):
            return GatewayError(
                code="bars_not_found" if dataset == "bars" else "data_unavailable",
                message=str(error),
                status_code=404 if dataset == "bars" else 503,
                provider=error.provider,
            )
        if isinstance(error, DataProviderConfigurationError):
            return GatewayError(
                code="provider_configuration_error",
                message=str(error),
                status_code=503,
                provider=error.provider,
            )
        return GatewayError(
            code=error.code,
            message=str(error),
            status_code=503,
            provider=error.provider,
        )

    def _resolve_start_date(
        self,
        *,
        start: str | None,
        end: str | None,
        lookback_days: int,
    ) -> str:
        if start:
            return start.replace("-", "")

        if end:
            base = datetime.strptime(end, "%Y-%m-%d")
        else:
            base = datetime.now(UTC)

        return (base - timedelta(days=lookback_days)).strftime("%Y%m%d")

    def _dedupe_warnings(self, warnings: list[GatewayWarning]) -> list[GatewayWarning]:
        seen: set[tuple[str, str]] = set()
        deduped: list[GatewayWarning] = []

        for warning in warnings:
            key = (warning.code, warning.message)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(warning)

        return deduped

    def _load_signal_benchmark_histories(
        self,
        *,
        as_of_date: str | None,
        lookback_days: int | None,
    ) -> dict[str, pd.DataFrame]:
        benchmark_histories: dict[str, pd.DataFrame] = {}
        effective_lookback = max(
            lookback_days or timing_indicators_service.minimum_lookback_days,
            timing_indicators_service.minimum_lookback_days,
        )
        start_date = self._resolve_start_date(
            start=None,
            end=as_of_date,
            lookback_days=effective_lookback * 2,
        )
        for benchmark_code in SIGNAL_BENCHMARK_CODES:
            benchmark_histories[benchmark_code] = (
                self._get_benchmark_bars(
                    self._signal_data_provider,
                    benchmark_code=benchmark_code,
                    start_date=start_date,
                    end_date=as_of_date,
                )
            )
        return benchmark_histories


timing_gateway = TimingGateway()
