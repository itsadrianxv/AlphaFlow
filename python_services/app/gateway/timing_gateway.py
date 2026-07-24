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
    TimingMarketContextAvailability,
    TimingBar,
    TimingBarsData,
    TimingBarsResponse,
    TimingEvidenceBatchData,
    TimingEvidenceBatchResponse,
    TimingSignalBatchData,
    TimingSignalBatchResponse,
    TimingSignalData,
    TimingSignalResponse,
    TimingTimeframe,
)
from app.data_providers import get_default_data_provider
from app.data_providers.contracts import DataProvider, DailyBar, MarketSnapshotRow, StockProfile, Timeframe
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
from app.services.timing_evidence import timing_evidence_service

SIGNAL_BENCHMARK_CODES = ["510300", "510500", "159915"]
MARKET_INDEX_CODES = [
    ("000300.SH", "沪深300", "510300"),
    ("000905.SH", "中证500", "510500"),
    ("399006.SZ", "创业板指", "159915"),
    ("000688.SH", "科创50", "588000"),
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

    def get_evidence_batch(
        self,
        *,
        request_id: str,
        stock_codes: list[str],
        as_of_date: str | None,
        timeframes: list[TimingTimeframe],
        indicator_ids: list[str],
        lookback_days: int,
    ) -> TimingEvidenceBatchResponse:
        started_at = time.perf_counter()
        items = []
        errors: list[BatchItemError] = []
        warnings: list[GatewayWarning] = []
        resolved_request_date = as_of_date or datetime.now(UTC).strftime("%Y-%m-%d")
        benchmark_histories = self._load_signal_benchmark_histories(
            as_of_date=resolved_request_date,
            lookback_days=lookback_days,
        )

        for stock_code in stock_codes:
            try:
                items.append(self._build_evidence_data(
                    stock_code=stock_code,
                    as_of_date=resolved_request_date,
                    timeframes=timeframes,
                    indicator_ids=indicator_ids,
                    lookback_days=lookback_days,
                    benchmark_history=benchmark_histories.get("510300"),
                ))
            except Exception as exc:  # noqa: BLE001
                errors.append(BatchItemError(
                    stockCode=stock_code,
                    code=str(getattr(exc, "code", "evidence_fetch_failed")),
                    message=str(exc),
                ))

        if errors:
            warnings.append(GatewayWarning(
                code="partial_results",
                message="批量择时证据存在部分失败，详情见 data.errors",
            ))
        return TimingEvidenceBatchResponse(
            meta=build_meta(
                request_id=request_id,
                provider=self._signal_data_provider.provider_name,
                started_at=started_at,
                cache_hit=False,
                is_stale=False,
                warnings=warnings,
                as_of=max((item.asOfDate for item in items), default=resolved_request_date),
            ),
            data=TimingEvidenceBatchData(items=items, errors=errors),
        )

    def _build_evidence_data(
        self,
        *,
        stock_code: str,
        as_of_date: str,
        timeframes: list[TimingTimeframe],
        indicator_ids: list[str],
        lookback_days: int,
        benchmark_history: pd.DataFrame | None,
    ):
        profile = self._signal_data_provider.get_stock_profile(stock_code)
        histories: dict[str, pd.DataFrame] = {}
        for timeframe in dict.fromkeys(timeframes):
            try:
                if timeframe.startswith("MINUTE_"):
                    start_date = self._resolve_intraday_start(start=None, end=as_of_date)
                    end_date = self._normalize_intraday_end(as_of_date)
                    adjust = ""
                else:
                    start_date = self._resolve_start_date(
                        start=None,
                        end=as_of_date,
                        lookback_days=self._timeframe_lookback_days(timeframe, lookback_days * 2),
                    )
                    end_date = as_of_date
                    adjust = "qfq"
                histories[timeframe] = self._get_stock_bars(
                    self._signal_data_provider,
                    stock_code=stock_code,
                    start_date=start_date,
                    end_date=end_date,
                    adjust=adjust,
                    timeframe=timeframe,
                )
            except GatewayError:
                histories[timeframe] = pd.DataFrame()

        if "DAILY" not in histories or histories["DAILY"].empty:
            raise GatewayError(
                code="daily_bars_required",
                message=f"{stock_code} 缺少日线，无法构建择时证据",
                status_code=422,
                provider=self._signal_data_provider.provider_name,
            )

        start_date = self._resolve_start_date(start=None, end=as_of_date, lookback_days=lookback_days * 2)
        end_date = as_of_date.replace("-", "")
        special_frames: dict[str, pd.DataFrame] = {}
        special_errors: dict[str, str] = {}
        for dataset in ("stk_factor_pro", "cyq_perf", "stk_nineturn", "stk_auction_o"):
            params = {
                "ts_code": profile.tsCode,
                "start_date": start_date,
                "end_date": end_date,
            }
            if dataset == "stk_nineturn":
                params["freq"] = "daily"
            try:
                special_frames[dataset] = self._get_raw_frame(
                    self._signal_data_provider, dataset, **params,
                )
                if special_frames[dataset].empty:
                    special_errors[dataset] = "接口返回空数据"
            except Exception as exc:  # noqa: BLE001
                special_errors[dataset] = str(exc)

        latest_daily = timing_indicators_service.normalize_history(histories["DAILY"]).iloc[-1]
        tradable = bool(float(latest_daily["volume"]) > 0)
        return timing_evidence_service.build(
            stock_code=stock_code,
            stock_name=profile.stockName,
            as_of_date=as_of_date,
            histories=histories,
            special_frames=special_frames,
            special_errors=special_errors,
            indicator_ids=indicator_ids,
            benchmark_history=benchmark_history,
            tradable=tradable,
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
        normalized_timeframe = timeframe.strip().upper()
        if normalized_timeframe not in {
            "DAILY",
            "WEEKLY",
            "MONTHLY",
            "MINUTE_60",
            "MINUTE_30",
            "MINUTE_15",
            "MINUTE_1",
        }:
            raise GatewayError(
                code="invalid_timeframe",
                message=f"不支持的行情周期: {timeframe}",
                status_code=400,
                provider="timing",
            )
        is_intraday = normalized_timeframe.startswith("MINUTE_")
        if is_intraday:
            resolved_start = self._resolve_intraday_start(start=start, end=end)
            resolved_end = self._normalize_intraday_end(end)
            effective_adjust = "none"
        else:
            resolved_start = (
                self._resolve_start_date(
                    start=start,
                    end=end,
                    lookback_days=self._timeframe_lookback_days(
                        normalized_timeframe,
                        timing_indicators_service.minimum_lookback_days * 2,
                    ),
                )
                if start is None
                else self._resolve_start_date(start=start, end=end, lookback_days=0)
            )
            resolved_end = end
            effective_adjust = adjust
        try:
            history = self._get_stock_bars(
                self._signal_data_provider,
                stock_code=stock_code,
                start_date=resolved_start,
                end_date=resolved_end,
                adjust=effective_adjust,
                timeframe=normalized_timeframe,
            )
        except GatewayError as error:
            if error.code != "bars_not_found" or start is not None or is_intraday:
                raise
            history = self._get_stock_bars(
                self._signal_data_provider,
                stock_code=stock_code,
                start_date=None,
                end_date=resolved_end,
                adjust=effective_adjust,
                timeframe=normalized_timeframe,
            )

        normalized = timing_indicators_service.normalize_history(history)
        bars = [
            TimingBar(
                tradeDate=(
                    row.trade_date.strftime("%Y-%m-%d %H:%M:%S")
                    if normalized_timeframe.startswith("MINUTE_")
                    else row.trade_date.strftime("%Y-%m-%d")
                ),
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
            timeframe=normalized_timeframe,
            adjust=effective_adjust,
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
        histories: dict[str, pd.DataFrame] = {}
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
            timeframe="DAILY",
        )
        histories["DAILY"] = history
        timeframe_warnings: dict[str, str] = {}
        for timeframe in (
            "WEEKLY",
            "MONTHLY",
            *( ("MINUTE_60", "MINUTE_30", "MINUTE_15", "MINUTE_1") if include_bars else () ),
        ):
            try:
                if timeframe.startswith("MINUTE_"):
                    minute_start = self._resolve_intraday_start(
                        start=None,
                        end=as_of_date,
                    )
                    minute_end = self._normalize_intraday_end(as_of_date)
                    histories[timeframe] = self._get_stock_bars(
                        self._signal_data_provider,
                        stock_code=stock_code,
                        start_date=minute_start,
                        end_date=minute_end,
                        adjust="",
                        timeframe=timeframe,
                    )
                    continue

                histories[timeframe] = self._get_stock_bars(
                    self._signal_data_provider,
                    stock_code=stock_code,
                    start_date=self._resolve_start_date(
                        start=None,
                        end=as_of_date,
                        lookback_days=self._timeframe_lookback_days(
                            timeframe,
                            lookback_days * 2,
                        ),
                    ),
                    end_date=as_of_date,
                    adjust="qfq",
                    timeframe=timeframe,
                )
            except GatewayError as error:
                timeframe_warnings[timeframe] = str(error)

        effective_benchmark_histories = (
            benchmark_histories
            if benchmark_histories is not None
            else self._load_signal_benchmark_histories(
                as_of_date=as_of_date,
                lookback_days=lookback_days,
            )
        )

        normalized_bar_histories = {
            key: timing_indicators_service.normalize_history(frame)
            for key, frame in histories.items()
        }

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
            timeframe_histories={
                key: value
                for key, value in histories.items()
                if key in {"DAILY", "WEEKLY", "MONTHLY"}
            },
            timeframe_warnings=timeframe_warnings,
            bar_histories=normalized_bar_histories,
        )

    def _build_market_context(
        self,
        *,
        as_of_date: str | None,
    ) -> MarketContextSnapshotData:
        warnings: list[str] = []
        universe = self._get_market_snapshot(
            self._market_context_provider,
            as_of_date=as_of_date,
        )
        if not universe:
            raise GatewayError(
                code="market_snapshot_empty",
                message="全市场日行情为空，无法生成择时市场环境。",
                status_code=503,
                provider=self._market_context_provider.provider_name,
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
        volume_ratio_values = [
            float(item.volumeRatio or 0)
            for item in universe
            if item.volumeRatio is not None
        ]
        stock_limit_available = any(
            bool(getattr(item, "limitStatus", None))
            or getattr(item, "upLimit", None) is not None
            or getattr(item, "downLimit", None) is not None
            for item in universe
        )

        resolved_as_of = self._resolve_universe_as_of(universe) or as_of_date
        index_frames, indexes, index_warnings = self._load_market_index_context(
            as_of_date=as_of_date,
        )
        warnings.extend(index_warnings)
        if len(indexes) < 2:
            raise GatewayError(
                code="market_indexes_unavailable",
                message="可用指数行情少于 2 个，无法生成稳定的择时市场环境。",
                status_code=503,
                provider=self._market_context_provider.provider_name,
            )

        latest_index_as_of = self._resolve_index_as_of(index_frames)
        if latest_index_as_of:
            resolved_as_of = latest_index_as_of

        latest_breadth = self._build_latest_breadth(
            change_values,
            turnover_values,
            resolved_as_of or datetime.now(UTC).strftime("%Y-%m-%d"),
        )
        latest_volatility = self._build_latest_volatility(
            universe,
            change_values,
            indexes,
            resolved_as_of or datetime.now(UTC).strftime("%Y-%m-%d"),
        )

        breadth_series, volatility_series, leadership_series = self._build_market_series(
            index_frames=index_frames,
            latest_breadth=latest_breadth,
            latest_volatility=latest_volatility,
        )

        latest_leadership = leadership_series[-1]
        hsgt_flow_score, hsgt_available, hsgt_warning = self._resolve_hsgt_flow_score(
            as_of_date=resolved_as_of,
        )
        if hsgt_warning:
            warnings.append(hsgt_warning)
        daily_basic_available = bool(turnover_values or volume_ratio_values)
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
        activity_score = round(
            min(
                100,
                max(
                    0,
                    ((sum(turnover_values) / len(turnover_values)) if turnover_values else 0)
                    * 10
                    + ((sum(volume_ratio_values) / len(volume_ratio_values)) if volume_ratio_values else 1)
                    * 20,
                ),
            ),
            2,
        )
        breadth_score = round(
            min(100, max(0, latest_breadth.positiveRatio * 70 + latest_breadth.aboveThreePctRatio * 30) * 100),
            2,
        )
        risk_score = round(
            min(
                100,
                max(
                    0,
                    latest_volatility.highVolatilityRatio * 45
                    + latest_breadth.belowThreePctRatio * 30
                    + (latest_volatility.limitDownLikeCount / max(latest_breadth.totalCount, 1)) * 25,
                )
                * 100,
            ),
            2,
        )
        state_score = round(
            min(
                100,
                max(
                    0,
                    benchmark_strength * 0.4
                    + breadth_score * 0.32
                    + (100 - risk_score) * 0.18
                    + activity_score * 0.05
                    + hsgt_flow_score * 0.05,
                ),
            ),
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
                northboundFlowScore=hsgt_flow_score,
                activityScore=activity_score,
            ),
            source="tushare:daily,daily_basic,index_daily,stk_limit,moneyflow_hsgt",
            availability=TimingMarketContextAvailability(
                daily=True,
                dailyBasic=daily_basic_available,
                indexDaily=True,
                stockLimit=stock_limit_available,
                indexDailyBasic=False,
                hsgtFlow=hsgt_available,
                warnings=warnings,
            ),
        )

    def _load_market_index_context(
        self,
        *,
        as_of_date: str | None,
    ) -> tuple[dict[str, pd.DataFrame], list[MarketIndexSnapshot], list[str]]:
        index_frames: dict[str, pd.DataFrame] = {}
        indexes: list[MarketIndexSnapshot] = []
        warnings: list[str] = []
        start_date = self._resolve_start_date(
            start=None,
            end=as_of_date,
            lookback_days=260,
        )

        for ts_code, fallback_name, legacy_code in MARKET_INDEX_CODES:
            try:
                history = self._load_index_history(
                    ts_code=ts_code,
                    legacy_code=legacy_code,
                    start_date=start_date,
                    end_date=as_of_date,
                )
                normalized = timing_indicators_service.normalize_history(history)
                sliced = timing_indicators_service.slice_as_of(normalized, as_of_date)
                enriched = timing_indicators_service.calculate_indicators(sliced)
                index_frames[ts_code] = enriched.tail(20).reset_index(drop=True)
                indexes.append(
                    self._build_index_snapshot(
                        code=ts_code,
                        name=fallback_name,
                        enriched=enriched,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"{ts_code} index_daily unavailable: {exc}")

        return index_frames, indexes, warnings

    def _load_index_history(
        self,
        *,
        ts_code: str,
        legacy_code: str,
        start_date: str,
        end_date: str | None,
    ) -> pd.DataFrame:
        raw_frame = self._get_raw_frame(
            self._market_context_provider,
            "index_daily",
            ts_code=ts_code,
            start_date=start_date,
            **({"end_date": end_date.replace("-", "")} if end_date else {}),
        )
        if not raw_frame.empty:
            return self._daily_bars_to_timing_frame(
                [
                    DailyBar(
                        stockCode=ts_code,
                        tradeDate=str(row.get("trade_date")),
                        open=self._safe_float(row.get("open")),
                        high=self._safe_float(row.get("high")),
                        low=self._safe_float(row.get("low")),
                        close=self._safe_float(row.get("close")),
                        volume=self._safe_float(row.get("vol")),
                        amount=self._safe_float(row.get("amount")),
                        turnoverRate=None,
                    )
                    for _, row in raw_frame.iterrows()
                ]
            )

        return self._get_stock_bars(
            self._market_context_provider,
            stock_code=legacy_code,
            start_date=start_date,
            end_date=end_date,
            adjust="qfq",
        )

    def _build_index_snapshot(
        self,
        *,
        code: str,
        name: str,
        enriched: pd.DataFrame,
    ) -> MarketIndexSnapshot:
        latest = enriched.iloc[-1]
        previous_close = (
            float(enriched.iloc[-2]["close"])
            if len(enriched.index) >= 2
            else float(latest["close"])
        )
        change_pct = ((float(latest["close"]) / max(previous_close, 0.0001)) - 1) * 100
        atr_ratio = float(latest["atr14"] / max(latest["close"], 0.0001))

        return MarketIndexSnapshot(
            code=code,
            name=name,
            close=round(float(latest["close"]), 4),
            changePct=round(change_pct, 4),
            return5d=round(float(latest["return_5d"]) * 100, 4),
            return10d=round(float(latest["return_10d"]) * 100, 4),
            ema20=round(float(latest["ema20"]), 4),
            ema60=round(float(latest["ema60"]), 4),
            aboveEma20=bool(latest["close"] >= latest["ema20"]),
            aboveEma60=bool(latest["close"] >= latest["ema60"]),
            atrRatio=round(atr_ratio, 4),
            signalDirection=self._direction_from_price(
                float(latest["close"]),
                float(latest["ema20"]),
                float(latest["ema60"]),
            ),
        )

    def _resolve_hsgt_flow_score(
        self,
        *,
        as_of_date: str | None,
    ) -> tuple[float, bool, str | None]:
        end_date = (
            datetime.strptime(as_of_date, "%Y-%m-%d")
            if as_of_date
            else datetime.now(UTC).replace(tzinfo=None)
        )
        try:
            raw_frame = self._get_raw_frame(
                self._market_context_provider,
                "moneyflow_hsgt",
                start_date=(end_date - timedelta(days=14)).strftime("%Y%m%d"),
                end_date=end_date.strftime("%Y%m%d"),
            )
            if raw_frame.empty:
                return 50.0, False, "moneyflow_hsgt unavailable: empty response"
            row = raw_frame.sort_values("trade_date", ascending=False).iloc[0]
            north_money = self._safe_float(row.get("north_money"))
            if north_money is None:
                return 50.0, False, "moneyflow_hsgt unavailable: north_money missing"
            return max(0, min(100, 50 + north_money / 20)), True, None
        except Exception as exc:  # noqa: BLE001
            return 50.0, False, f"moneyflow_hsgt unavailable: {exc}"

    def _resolve_index_as_of(self, index_frames: dict[str, pd.DataFrame]) -> str | None:
        dates = []
        for frame in index_frames.values():
            if frame.empty:
                continue
            dates.append(frame.iloc[-1]["trade_date"].strftime("%Y-%m-%d"))
        return max(dates) if dates else None

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
        universe: list[MarketSnapshotRow],
        change_values: list[float],
        indexes: list[MarketIndexSnapshot],
        as_of_date: str,
    ) -> MarketVolatilityPoint:
        total_count = max(len(change_values), 1)
        high_volatility_count = len([value for value in change_values if abs(value) >= 5])
        limit_down_like_count = len(
            [
                item
                for item in universe
                if (getattr(item, "limitStatus", None) in {"D", "-1", "limit_down"})
                or (
                    item.close is not None
                    and getattr(item, "downLimit", None) is not None
                    and item.close <= float(getattr(item, "downLimit")) * 1.005
                )
                or (item.changePercent is not None and item.changePercent <= -9)
            ]
        )
        index_atr_ratio = (
            round(sum(item.atrRatio for item in indexes) / len(indexes), 4)
            if indexes
            else 0.0
        )
        return MarketVolatilityPoint(
            asOfDate=as_of_date,
            highVolatilityCount=high_volatility_count,
            highVolatilityRatio=round(high_volatility_count / total_count, 4),
            limitDownLikeCount=limit_down_like_count,
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

    def _safe_float(self, value: object) -> float | None:
        if value is None:
            return None
        try:
            if pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass
        text = str(value).strip()
        if not text or text.lower() in {"nan", "none", "null", "--"}:
            return None
        try:
            return float(text.replace(",", ""))
        except ValueError:
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
        timeframe: Timeframe = "DAILY",
    ) -> pd.DataFrame:
        try:
            if hasattr(provider, "get_bars"):
                bars = provider.get_bars(
                    stock_code=stock_code,
                    timeframe=timeframe,
                    start_date=start_date,
                    end_date=end_date,
                    adjust=adjust,
                )
            else:
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
                message=f"{timeframe} bars not found for {stock_code}",
                status_code=404,
                provider=provider.provider_name,
            )
        return self._daily_bars_to_timing_frame(bars)

    def _timeframe_lookback_days(self, timeframe: str, bars: int) -> int:
        multiplier = {"DAILY": 1, "WEEKLY": 7, "MONTHLY": 31}.get(timeframe, 1)
        return bars * multiplier

    def _resolve_intraday_start(self, *, start: str | None, end: str | None) -> str:
        if start:
            return self._normalize_intraday_start(start)
        base_text = end or datetime.now(UTC).strftime("%Y-%m-%d")
        base = pd.Timestamp(base_text).normalize() - pd.Timedelta(days=30)
        return f"{base.strftime('%Y-%m-%d')} 09:00:00"

    def _normalize_intraday_start(self, value: str) -> str:
        parsed = pd.Timestamp(value)
        if pd.isna(parsed):
            raise GatewayError(
                code="invalid_start_date",
                message=f"无效的分钟行情开始时间: {value}",
                status_code=400,
                provider="gateway",
            )
        return parsed.strftime("%Y-%m-%d %H:%M:%S")

    def _normalize_intraday_end(self, value: str | None) -> str:
        if value is None:
            return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
        parsed = pd.Timestamp(value)
        if pd.isna(parsed):
            raise GatewayError(
                code="invalid_end_date",
                message=f"无效的分钟行情结束时间: {value}",
                status_code=400,
                provider="gateway",
            )
        if parsed.hour == 0 and parsed.minute == 0 and parsed.second == 0:
            parsed = parsed.replace(hour=15)
        return parsed.strftime("%Y-%m-%d %H:%M:%S")

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

    def _get_raw_frame(
        self,
        provider: DataProvider,
        dataset: str,
        **params: str,
    ) -> pd.DataFrame:
        raw_loader = getattr(provider, "get_raw_frame", None)
        if raw_loader is None:
            return pd.DataFrame()
        try:
            frame = raw_loader(dataset, **params)
        except DataProviderError as exc:
            raise self._to_gateway_error(exc) from exc
        return frame.copy() if isinstance(frame, pd.DataFrame) else pd.DataFrame()

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
