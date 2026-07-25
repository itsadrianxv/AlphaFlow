"""Provider client backed entirely by TuShare."""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
import hashlib
import re
from typing import Any

import pandas as pd

from app.data_providers import TushareProvider
from app.data_providers.contracts import DailyBar, MarketSnapshotRow, StockProfile
from app.data_providers.errors import DataProviderError, DataUnavailableError, InvalidSymbolError
from app.gateway.common import GatewayError
from app.services.theme_concept_rules_registry import ThemeConceptRulesRegistry

_ETF_PREFIXES = ("15", "16", "18", "50", "51", "52", "56", "58", "159")
_RULES_REGISTRY = ThemeConceptRulesRegistry()
_GENERIC_THEME_KEYS = {"ai", "人工智能", "aigc"}
_HEATMAP_MAX_STOCKS_PER_CONCEPT = 100
_SW_INDUSTRY_SOURCE = "SW2021"
_SW_THEME_INDUSTRY_HINTS: dict[str, list[str]] = {
    "ai": ["计算机", "软件开发", "IT服务", "电子", "通信"],
    "人工智能": ["计算机", "软件开发", "IT服务", "电子", "通信"],
    "aigc": ["计算机", "软件开发", "IT服务", "传媒", "电子"],
    "机器人": ["机器人", "自动化设备", "机械设备", "通用设备"],
    "人形机器人": ["机器人", "自动化设备", "机械设备", "通用设备"],
    "半导体": ["半导体", "电子", "半导体设备", "半导体材料"],
    "芯片": ["半导体", "电子", "数字芯片设计", "模拟芯片设计"],
    "新能源": ["电力设备", "光伏设备", "电池", "新能源动力系统"],
    "光伏": ["光伏设备", "电力设备"],
    "储能": ["电池", "电力设备", "电网设备"],
    "汽车": ["汽车", "乘用车", "汽车零部件", "汽车电子电气系统"],
    "低空经济": ["航空装备", "国防军工", "航天装备", "机械设备"],
}


class TushareProviderClient:
    provider_name = "tushare"

    def __init__(self, provider: TushareProvider | None = None) -> None:
        self._provider = provider or TushareProvider()
        self._snapshot_cache: tuple[float, dict[str, dict[str, Any]]] | None = None
        self._concept_catalog_cache: tuple[float, list[dict[str, Any]]] | None = None

    def get_all_stock_codes(self) -> list[str]:
        return [profile.stockCode for profile in self._provider.get_stock_universe()]

    def is_a_share_trading_day(self, trading_date: date) -> bool:
        return self._provider.is_a_share_trading_day(trading_date)

    def get_stock_universe(self) -> list[dict[str, Any]]:
        snapshot_map = self._load_snapshot_map(allow_empty=True)
        rows: list[dict[str, Any]] = []
        for profile in self._provider.get_stock_universe():
            rows.append(self._profile_to_snapshot(profile, snapshot_map.get(profile.stockCode)))
        return rows

    def get_stock_snapshot(self, stock_code: str) -> dict[str, Any]:
        normalized_code = _normalize_stock_code(stock_code)
        if not normalized_code:
            raise GatewayError(
                code="invalid_stock_code",
                message=f"Invalid stock code: {stock_code}",
                status_code=400,
                provider=self.provider_name,
            )

        if _is_etf_code(normalized_code):
            etf = self._get_etf_snapshot(normalized_code)
            if etf:
                return etf

        try:
            profile = self._provider.get_stock_profile(normalized_code)
        except InvalidSymbolError as exc:
            raise GatewayError(
                code="stock_not_found",
                message=f"Stock not found: {normalized_code}",
                status_code=404,
                provider=self.provider_name,
            ) from exc

        snapshot_map = self._load_snapshot_map(allow_empty=True)
        return self._profile_to_snapshot(profile, snapshot_map.get(normalized_code))

    def get_stock_batch(self, stock_codes: list[str]) -> list[dict[str, Any]]:
        normalized_codes = _dedupe_stock_codes(stock_codes)
        if not normalized_codes:
            return []
        snapshot_map = self._load_snapshot_map(allow_empty=True)
        results: list[dict[str, Any]] = []
        for stock_code in normalized_codes:
            try:
                if _is_etf_code(stock_code):
                    etf = self._get_etf_snapshot(stock_code)
                    if etf:
                        results.append(etf)
                        continue
                profile = self._provider.get_stock_profile(stock_code)
            except DataProviderError:
                continue
            results.append(self._profile_to_snapshot(profile, snapshot_map.get(stock_code)))
        return results

    def get_available_industries(self) -> list[str]:
        industries = {
            profile.industry.strip()
            for profile in self._provider.get_stock_universe()
            if profile.industry.strip()
        }
        if not industries:
            frame = self._safe_raw_frame("index_classify")
            if not frame.empty and "industry_name" in frame.columns:
                industries = {
                    str(item).strip()
                    for item in frame["industry_name"].tolist()
                    if str(item).strip()
                }
        return sorted(industries)

    def get_indicator_history(self, stock_code: str, indicator: str, years: int) -> list[dict]:
        normalized_code = _normalize_stock_code(stock_code)
        normalized_years = max(1, min(int(years or 1), 10))
        indicator_key = indicator.strip().upper()
        metric_id = {
            "ROE": "roe_report",
            "EPS": "eps_report",
            "REVENUE": "revenue",
            "NET_PROFIT": "net_profit_parent",
            "DEBT_RATIO": "asset_liability_ratio",
        }.get(indicator_key)

        if metric_id:
            current_year = date.today().year
            periods = [str(current_year - offset) for offset in range(normalized_years, 0, -1)]
            series = self._provider.get_metric_series([normalized_code], [metric_id], periods)
            points = series.get(normalized_code, {}).get(metric_id, [])
            return [
                {
                    "date": point.endDate,
                    "value": point.value,
                    "isEstimated": False,
                }
                for point in points
            ]

        if indicator_key in {"PE", "PB"}:
            return self._load_valuation_history(normalized_code, indicator_key, normalized_years)
        return []

    def get_stock_bars(
        self,
        *,
        stock_code: str,
        start_date: str | None,
        end_date: str | None,
        adjust: str,
    ) -> pd.DataFrame:
        bars = self._provider.get_daily_bars(
            stock_code,
            start_date=start_date,
            end_date=end_date,
            adjust=adjust,
        )
        return pd.DataFrame([asdict(bar) for bar in bars])

    def get_theme_candidates(
        self,
        theme: str,
        limit: int,
        concept_hints: list[dict] | None = None,
    ) -> list[dict]:
        normalized_theme = theme.strip()
        if not normalized_theme:
            return []
        for board in self.get_hot_concept_boards(limit=5):
            if _normalize_text(board["theme"]) == _normalize_text(normalized_theme):
                return list(board["candidateStocks"][: max(1, min(limit, 10))])
        return []

    def get_theme_concepts(
        self,
        theme: str,
        limit: int,
        concept_hints: list[dict] | None = None,
    ) -> dict:
        concepts = self._select_concepts(theme=theme, limit=limit)
        return {
            "theme": theme.strip(),
            "matchedBy": "ths_index",
            "concepts": [
                {
                    "name": item["conceptName"],
                    "code": item.get("conceptCode") or None,
                    "aliases": [],
                    "confidence": item.get("confidence", 0.62),
                    "reason": item.get("reason") or f"TuShare THS 概念板块与主题“{theme}”名称匹配",
                    "source": "tushare:ths_index",
                }
                for item in concepts
            ],
        }

    def get_stock_evidence(self, stock_code: str, concept: str | None) -> dict:
        normalized_code = _normalize_stock_code(stock_code)
        concept_name = concept.strip() if concept else "通用赛道"
        snapshot = self.get_stock_snapshot(normalized_code)
        company_name = str(snapshot.get("name") or snapshot.get("stockName") or normalized_code)
        industry = str(snapshot.get("industry") or "未知行业")
        change_pct = _safe_float(snapshot.get("changePercent"))
        turnover = _safe_float(snapshot.get("turnoverRate"))
        pe_ratio = _safe_float(snapshot.get("pe"))
        market_cap = _safe_float(snapshot.get("marketCap"))

        base_score = 62.0
        if change_pct is not None:
            base_score += max(-8, min(8, change_pct * 1.4))
        if turnover is not None:
            base_score += max(-3, min(10, turnover * 0.8))
        if pe_ratio is not None:
            base_score += 6 if 0 < pe_ratio <= 45 else -5 if pe_ratio > 80 else 0
        if market_cap is not None and market_cap > 0:
            base_score += min(6, max(0, market_cap / 10000))
        credibility_score = int(max(45, min(95, round(base_score))))

        catalysts: list[str] = []
        risks: list[str] = []
        if change_pct is not None:
            if change_pct >= 2:
                catalysts.append(f"股价动量较强，近期涨跌幅为 {change_pct:.2f}%")
            elif change_pct <= -2:
                risks.append(f"短线波动偏弱，近期涨跌幅为 {change_pct:.2f}%")
        if turnover is not None:
            if turnover >= 3:
                catalysts.append(f"市场活跃度较高，换手率 {turnover:.2f}%")
            elif turnover < 0.8:
                risks.append(f"交易活跃度偏弱，换手率仅 {turnover:.2f}%")
        if pe_ratio is not None:
            if pe_ratio > 80:
                risks.append(f"估值偏高，动态市盈率 {pe_ratio:.2f}")
            elif 0 < pe_ratio <= 35:
                catalysts.append(f"估值相对可控，动态市盈率 {pe_ratio:.2f}")
        if not catalysts:
            catalysts.append("TuShare 行情和财务快照未见显著恶化，维持跟踪")
        if not risks:
            risks.append("需关注行业轮动、主题热度回落和数据权限缺口")

        return {
            "stockCode": normalized_code,
            "companyName": company_name,
            "concept": concept_name,
            "evidenceSummary": (
                f"{company_name}（{normalized_code}）当前属于{industry}，"
                f"围绕“{concept_name}”主题的可信度评估为 {credibility_score} 分。"
            ),
            "catalysts": catalysts[:3],
            "risks": risks[:3],
            "credibilityScore": credibility_score,
            "dataQuality": "complete",
            "warnings": [],
            "updatedAt": datetime.now(UTC).isoformat(),
        }

    def get_stock_research_pack(self, stock_code: str, concept: str | None) -> dict:
        evidence = self.get_stock_evidence(stock_code=stock_code, concept=concept)
        snapshot = self.get_stock_snapshot(stock_code)
        financial_highlights = [
            line
            for line in [
                _format_metric_line("总市值", snapshot.get("marketCap"), "亿元"),
                _format_metric_line("流通市值", snapshot.get("floatMarketCap"), "亿元"),
                _format_metric_line("市盈率", snapshot.get("pe")),
                _format_metric_line("市净率", snapshot.get("pb")),
                _format_metric_line("ROE", snapshot.get("roe")),
                _format_metric_line("涨跌幅", snapshot.get("changePercent"), "%"),
                _format_metric_line("换手率", snapshot.get("turnoverRate"), "%"),
            ]
            if line
        ]
        return {
            "stockCode": evidence["stockCode"],
            "companyName": evidence["companyName"],
            "concept": evidence["concept"],
            "financialHighlights": financial_highlights,
            "referenceItems": [
                {
                    "id": f"{evidence['stockCode']}:tushare_financial_snapshot",
                    "title": f"{evidence['companyName']} TuShare 财务快照",
                    "sourceName": "tushare:financial_snapshot",
                    "snippet": "基于 TuShare 行情、估值和财务指标提取的结构化摘要。",
                    "extractedFact": "；".join(financial_highlights[:3])
                    or evidence["evidenceSummary"],
                    "publishedAt": evidence["updatedAt"],
                    "credibilityScore": _normalize_credibility_score(evidence["credibilityScore"]),
                    "sourceType": "financial",
                }
            ],
            "summaryNotes": [
                evidence["evidenceSummary"],
                *evidence["catalysts"],
                *evidence["risks"],
            ],
            "dataQuality": evidence["dataQuality"],
            "warnings": evidence["warnings"],
        }

    def get_concept_catalog(self) -> list[dict]:
        frame = self._raw_frame("ths_index", exchange="A", type="N")
        items: list[dict[str, Any]] = []
        for _, row in frame.iterrows():
            concept_name = _pick_text(row, ["name", "概念名称", "板块名称"])
            concept_code = _pick_text(row, ["ts_code", "code", "板块代码"])
            if not concept_name or not concept_code:
                continue
            items.append(
                {
                    "conceptName": concept_name,
                    "conceptCode": concept_code,
                    "conceptLevel": "N",
                    "leadingStock": None,
                    "changePercent": None,
                    "upCount": None,
                    "downCount": None,
                    "source": "tushare:ths_index",
                }
            )
        return list(items)

    def get_concept_constituents(
        self,
        concept_name: str,
        concept_code: str | None = None,
    ) -> list[dict]:
        resolved_code = concept_code or self._resolve_concept_code(concept_name)
        if not resolved_code:
            return []
        frame = self._raw_frame("ths_member", ts_code=resolved_code)
        items: list[dict[str, Any]] = []
        for _, row in frame.iterrows():
            stock_code = _normalize_stock_code(
                _pick_text(row, ["con_code", "code", "ts_code", "股票代码"])
            )
            if not stock_code:
                continue
            items.append(
                {
                    "conceptName": concept_name,
                    "stockCode": stock_code,
                    "stockName": _pick_text(row, ["con_name", "name", "stock_name", "股票名称"]) or stock_code,
                    "latestPrice": None,
                    "changePercent": None,
                    "turnoverRate": None,
                }
            )
        return items

    def get_hot_concept_themes(self, limit: int = 5) -> list[str]:
        return [item["theme"] for item in self.get_hot_concept_boards(limit=limit)]

    def get_hot_concept_boards(self, limit: int = 5) -> list[dict[str, Any]]:
        """Build the real-time THS concept-board snapshot without cache fallback."""
        normalized_limit = max(1, min(limit, 200))
        catalog = {item["conceptCode"]: item for item in self.get_concept_catalog()}
        hot_frame = self._raw_frame("ths_hot", market="概念板块", is_new="Y")
        if hot_frame.empty:
            return []
        hot_rows = [row for _, row in hot_frame.iterrows()]
        hot_rows.sort(key=lambda row: int(_safe_float(row.get("rank")) or 10**9))
        selected = [
            row for row in hot_rows
            if _pick_text(row, ["ts_code"]) in catalog
        ][:normalized_limit]
        if not selected:
            return []

        trade_date = _pick_text(selected[0], ["trade_date"])
        if not trade_date:
            raise DataUnavailableError("THS hot list has no trade date", provider=self.provider_name)
        limit_rows = self._load_limit_rows(trade_date)
        boards = [self._build_hot_board(row, catalog[_pick_text(row, ["ts_code"])], limit_rows) for row in selected]
        self._assign_board_heat_scores(boards)
        return boards

    def get_market_heatmap_snapshot(
        self,
        limit: int = 15,
        prefer_intraday: bool = False,
    ) -> dict[str, Any]:
        """构建供 A 股概念热力图使用的紧凑快照。"""
        normalized_limit = max(1, min(limit, 15))
        catalog = {item["conceptCode"]: item for item in self.get_concept_catalog()}
        hot_frame = self._raw_frame("ths_hot", market="概念板块", is_new="N")
        if hot_frame.empty:
            raise DataUnavailableError("THS concept hot list is unavailable", provider=self.provider_name)

        ranked_rows = [
            row
            for _, row in hot_frame.iterrows()
            if _pick_text(row, ["ts_code"]) in catalog
        ]
        hot_dates = [
            _format_ymd(_pick_text(row, ["trade_date"]))
            for row in ranked_rows
            if _format_ymd(_pick_text(row, ["trade_date"]))
        ]
        latest_hot_date = max(hot_dates, default="")
        if latest_hot_date:
            ranked_rows = [
                row
                for row in ranked_rows
                if _format_ymd(_pick_text(row, ["trade_date"])) == latest_hot_date
            ]

        hot_rows: list[pd.Series] = []
        seen_concept_codes: set[str] = set()
        seen_concept_names: set[str] = set()
        for row in sorted(
            ranked_rows,
            key=lambda item: int(_safe_float(item.get("rank")) or 10**9),
        ):
            concept_code = _pick_text(row, ["ts_code"])
            concept_name = _normalize_text(catalog[concept_code]["conceptName"])
            if concept_code in seen_concept_codes or concept_name in seen_concept_names:
                continue
            seen_concept_codes.add(concept_code)
            seen_concept_names.add(concept_name)
            hot_rows.append(row)
        if not hot_rows:
            raise DataUnavailableError("THS concept hot list has no recognized concepts", provider=self.provider_name)

        market_rows = self._provider.get_market_snapshot()
        market_by_code = {row.stockCode: row for row in market_rows if row.marketCap is not None}
        market_cap_as_of = max((row.tradeDate for row in market_rows), default="")
        trade_date = latest_hot_date or _format_ymd(_pick_text(hot_rows[0], ["trade_date"])) or market_cap_as_of
        intraday_change_map = self._load_intraday_change_map() if prefer_intraday else {}
        concepts: list[dict[str, Any]] = []
        for hot_row in hot_rows:
            concept_code = _pick_text(hot_row, ["ts_code"])
            catalog_item = catalog[concept_code]
            stocks: list[dict[str, Any]] = []
            for member in self.get_concept_constituents(catalog_item["conceptName"], concept_code):
                snapshot = market_by_code.get(member["stockCode"])
                if snapshot is None or snapshot.marketCap is None or snapshot.marketCap <= 0:
                    continue
                stocks.append(
                    {
                        "stockCode": snapshot.stockCode,
                        "stockName": snapshot.stockName or member["stockName"],
                        "marketCap": snapshot.marketCap,
                        "changePercent": intraday_change_map.get(snapshot.stockCode, snapshot.changePercent),
                    }
                )
            if not stocks:
                continue
            stocks.sort(key=lambda item: item["marketCap"], reverse=True)
            stocks = stocks[:_HEATMAP_MAX_STOCKS_PER_CONCEPT]
            total_market_cap = sum(item["marketCap"] for item in stocks)
            weighted_change_numerator = sum(
                item["marketCap"] * item["changePercent"]
                for item in stocks
                if item["changePercent"] is not None
            )
            weighted_change_denominator = sum(
                item["marketCap"] for item in stocks if item["changePercent"] is not None
            )
            concepts.append(
                {
                    "conceptCode": concept_code,
                    "conceptName": catalog_item["conceptName"],
                    "hotRank": int(_safe_float(hot_row.get("rank")) or 1),
                    "hotScore": _safe_float(hot_row.get("hot")),
                    "marketCap": total_market_cap,
                    "changePercent": round(weighted_change_numerator / weighted_change_denominator, 2)
                    if weighted_change_denominator
                    else None,
                    "stocks": stocks,
                }
            )
            if len(concepts) == normalized_limit:
                break
        if not concepts:
            raise DataUnavailableError("No listed A-share constituents in heatmap snapshot", provider=self.provider_name)
        return {
            "tradeDate": trade_date,
            "marketCapAsOf": market_cap_as_of or trade_date,
            "priceSource": "rt_min" if intraday_change_map else "daily",
            "concepts": concepts,
        }

    def _load_intraday_change_map(self) -> dict[str, float]:
        """实时分钟接口可用时返回最新涨跌幅。"""
        frame = self._safe_raw_frame("rt_min", freq="1min")
        if frame.empty:
            return {}
        changes: dict[str, float] = {}
        for _, row in frame.iterrows():
            stock_code = _normalize_stock_code(_pick_text(row, ["ts_code", "code"]))
            close = _safe_float(row.get("close"))
            pre_close = _safe_float(row.get("pre_close"))
            if not stock_code or close is None or pre_close in {None, 0}:
                continue
            changes[stock_code] = round((close / pre_close - 1) * 100, 4)
        return changes

    def _load_limit_rows(self, trade_date: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for limit_type in ("涨停池", "连板池", "冲刺涨停", "炸板池", "跌停池"):
            frame = self._raw_frame(
                "limit_list_ths", trade_date=trade_date, limit_type=limit_type
            )
            for _, row in frame.iterrows():
                stock_code = _normalize_stock_code(_pick_text(row, ["ts_code"]))
                if stock_code:
                    rows.append(
                        {
                            "stockCode": stock_code,
                            "stockName": _pick_text(row, ["name"]) or stock_code,
                            "limitType": _pick_text(row, ["limit_type"]) or limit_type,
                            "limitTag": _pick_text(row, ["tag"]),
                            "limitStatus": _pick_text(row, ["status"]),
                            "limitReason": _pick_text(row, ["lu_desc"]),
                            "limitOrder": _safe_float(row.get("limit_order")),
                            "limitAmount": _safe_float(row.get("limit_amount")),
                            "turnoverRate": _safe_float(row.get("turnover_rate")),
                        }
                    )
        return rows

    def _build_hot_board(
        self,
        hot_row: pd.Series,
        catalog_item: dict[str, Any],
        limit_rows: list[dict[str, Any]],
    ) -> dict[str, Any]:
        board_code = catalog_item["conceptCode"]
        trade_date = _pick_text(hot_row, ["trade_date"])
        end_date = datetime.strptime(trade_date, "%Y%m%d")
        start_date = (end_date - timedelta(days=10)).strftime("%Y%m%d")
        daily_frame = self._raw_frame(
            "ths_daily", ts_code=board_code, start_date=start_date, end_date=trade_date
        )
        if daily_frame.empty:
            raise DataUnavailableError(
                f"THS daily data unavailable for {board_code}", provider=self.provider_name
            )
        daily_frame = daily_frame.sort_values("trade_date")
        latest = daily_frame.iloc[-1]
        five_day = daily_frame.tail(5)
        five_day_return = 1.0
        for value in five_day.get("pct_change", []):
            five_day_return *= 1 + ((_safe_float(value) or 0.0) / 100)

        members = self.get_concept_constituents(catalog_item["conceptName"], board_code)
        member_codes = {item["stockCode"] for item in members}
        board_limit_rows = [item for item in limit_rows if item["stockCode"] in member_codes]
        limit_counts = {
            "limitUpCount": sum(item["limitType"] == "涨停池" for item in board_limit_rows),
            "continuationCount": sum(item["limitType"] == "连板池" for item in board_limit_rows),
            "rushLimitCount": sum(item["limitType"] == "冲刺涨停" for item in board_limit_rows),
            "brokenLimitCount": sum(item["limitType"] == "炸板池" for item in board_limit_rows),
            "limitDownCount": sum(item["limitType"] == "跌停池" for item in board_limit_rows),
        }
        candidates = [
            self._build_limit_candidate(item, catalog_item["conceptName"], int(_safe_float(hot_row.get("rank")) or 0))
            for item in board_limit_rows
        ]
        return {
            "theme": catalog_item["conceptName"],
            "conceptMatches": [{
                "name": catalog_item["conceptName"], "code": board_code, "aliases": [],
                "confidence": 1.0, "reason": "TuShare THS 概念热榜命中", "source": "tushare:ths_hot",
            }],
            "candidateStocks": sorted(candidates, key=lambda item: item["heat"], reverse=True)[:10],
            "marketEvidence": {
                "boardCode": board_code, "tradeDate": trade_date, "rankTime": _pick_text(hot_row, ["rank_time"]) or None,
                "rank": int(_safe_float(hot_row.get("rank")) or 1), "hot": _safe_float(hot_row.get("hot")),
                "pctChange": _safe_float(hot_row.get("pct_change")), "currentPrice": _safe_float(hot_row.get("current_price")),
                "rankReason": _pick_text(hot_row, ["rank_reason"]) or None, "constituentCount": len(members),
                "latestPctChange": _safe_float(latest.get("pct_change")), "fiveDayPctChange": round((five_day_return - 1) * 100, 2),
                "latestTurnoverRate": _safe_float(latest.get("turnover_rate")), **limit_counts,
            },
        }

    def _build_limit_candidate(self, item: dict[str, Any], concept: str, board_rank: int) -> dict[str, Any]:
        category_scores = {"连板池": 100.0, "涨停池": 85.0, "冲刺涨停": 65.0, "炸板池": 25.0, "跌停池": 0.0}
        order_score = min(15.0, max(0.0, (item["limitOrder"] or 0.0) / 10_000_000 * 15))
        turnover_score = min(10.0, max(0.0, (item["turnoverRate"] or 0.0) / 30 * 10))
        tag_bonus = min(10.0, _extract_board_days(item["limitTag"]) * 2.0)
        board_score = max(0.0, 10.0 - max(board_rank - 1, 0) * 1.5)
        heat = round(min(100.0, category_scores.get(item["limitType"], 0.0) * 0.55 + order_score + turnover_score + tag_bonus + board_score), 2)
        reason = "，".join(part for part in [
            f"{item['limitType']} {item['limitTag']}".strip(), item["limitStatus"], item["limitReason"],
        ] if part)
        return {**item, "concept": concept, "boardRank": board_rank, "heat": heat, "reason": reason or f"{concept} 成分股上榜 {item['limitType']}"}

    def _assign_board_heat_scores(self, boards: list[dict[str, Any]]) -> None:
        def normalized(values: list[float | None], value: float | None) -> float:
            numeric = [item for item in values if item is not None]
            if not numeric or value is None or max(numeric) == min(numeric):
                return 50.0
            return (value - min(numeric)) / (max(numeric) - min(numeric)) * 100

        evidence = [item["marketEvidence"] for item in boards]
        hot_values = [item["hot"] for item in evidence]
        rank_values = [float(item["rank"]) for item in evidence]
        change_values = [item["pctChange"] for item in evidence]
        five_day_values = [item["fiveDayPctChange"] for item in evidence]
        limit_values = [
            float(item["limitUpCount"] + item["continuationCount"] + item["rushLimitCount"] - item["brokenLimitCount"] - item["limitDownCount"])
            for item in evidence
        ]
        for board in boards:
            item = board["marketEvidence"]
            rank_score = 100 - normalized(rank_values, float(item["rank"]))
            limit_value = float(item["limitUpCount"] + item["continuationCount"] + item["rushLimitCount"] - item["brokenLimitCount"] - item["limitDownCount"])
            board["heatScore"] = round(
                normalized(hot_values, item["hot"]) * 0.35 + rank_score * 0.20
                + normalized(change_values, item["pctChange"]) * 0.15
                + normalized(five_day_values, item["fiveDayPctChange"]) * 0.15
                + normalized(limit_values, limit_value) * 0.15,
                2,
            )
            board["whyHot"] = (
                f"THS 概念板块热榜第 {item['rank']} 名，热度 {item['hot'] or 0:.0f}；"
                f"当日涨跌幅 {item['latestPctChange'] or 0:.2f}%，5 日累计 {item['fiveDayPctChange'] or 0:.2f}%；"
                f"涨停/连板/冲刺 {item['limitUpCount']}/{item['continuationCount']}/{item['rushLimitCount']}，"
                f"炸板/跌停 {item['brokenLimitCount']}/{item['limitDownCount']}。"
            )

    def get_concept_rules(self, theme: str) -> dict:
        return _RULES_REGISTRY.get_rules(theme)

    def update_concept_rules(
        self,
        theme: str,
        whitelist: list[str] | None = None,
        blacklist: list[str] | None = None,
        aliases: list[str] | None = None,
    ) -> dict:
        return _RULES_REGISTRY.upsert_rules(
            theme=theme,
            whitelist=whitelist,
            blacklist=blacklist,
            aliases=aliases,
        )

    def get_company_evidence_batch(self, stock_codes: list[str], concept: str) -> list[dict]:
        return [
            self.get_stock_evidence(stock_code=stock_code, concept=concept)
            for stock_code in _dedupe_stock_codes(stock_codes)
        ]

    def _profile_to_snapshot(
        self,
        profile: StockProfile,
        market_row: dict[str, Any] | None,
    ) -> dict[str, Any]:
        row = market_row or {}
        latest_metrics = self._safe_latest_metrics(
            [profile.stockCode],
            ["pe_ttm", "pb", "market_cap", "float_market_cap"],
        ).get(profile.stockCode, {})
        series = self._safe_metric_series(
            profile.stockCode,
            ["roe_report", "eps_report", "revenue", "net_profit_parent", "asset_liability_ratio"],
        )
        return {
            "code": profile.stockCode,
            "name": profile.stockName,
            "industry": profile.industry or "未知",
            "sector": profile.sector,
            "roe": series.get("roe_report"),
            "pe": row.get("pe") or latest_metrics.get("pe_ttm"),
            "pb": row.get("pb") or latest_metrics.get("pb"),
            "eps": series.get("eps_report"),
            "revenue": series.get("revenue"),
            "netProfit": series.get("net_profit_parent"),
            "debtRatio": series.get("asset_liability_ratio"),
            "marketCap": row.get("marketCap") or latest_metrics.get("market_cap"),
            "floatMarketCap": row.get("floatMarketCap") or latest_metrics.get("float_market_cap"),
            "turnoverRate": row.get("turnoverRate"),
            "changePercent": row.get("changePercent"),
            "close": row.get("close"),
            "dataDate": row.get("dataDate") or datetime.now(UTC).date().isoformat(),
            "securityType": "equity",
            "market": "CN-A",
        }

    def _load_snapshot_map(self, *, allow_empty: bool) -> dict[str, dict[str, Any]]:
        cached = self._snapshot_cache
        now = pd.Timestamp.utcnow().timestamp()
        if cached is not None and now - cached[0] <= 300:
            return dict(cached[1])
        try:
            rows = self._provider.get_market_snapshot()
        except DataProviderError:
            if allow_empty:
                return {}
            raise
        mapped = {
            row.stockCode: self._market_row_to_dict(row)
            for row in rows
            if row.stockCode
        }
        self._snapshot_cache = (now, mapped)
        return dict(mapped)

    def _market_row_to_dict(self, row: MarketSnapshotRow) -> dict[str, Any]:
        return {
            "code": row.stockCode,
            "stockCode": row.stockCode,
            "name": row.stockName,
            "stockName": row.stockName,
            "industry": row.industry,
            "close": row.close,
            "changePercent": row.changePercent,
            "turnoverRate": row.turnoverRate,
            "marketCap": row.marketCap,
            "floatMarketCap": row.floatMarketCap,
            "dataDate": row.tradeDate,
        }

    def _safe_latest_metrics(
        self,
        stock_codes: list[str],
        metric_ids: list[str],
    ) -> dict[str, dict[str, float | None]]:
        try:
            return self._provider.get_latest_metrics(stock_codes, metric_ids)
        except DataProviderError:
            return {stock_code: {} for stock_code in stock_codes}

    def _safe_metric_series(self, stock_code: str, metric_ids: list[str]) -> dict[str, float | None]:
        current_year = date.today().year
        periods = [str(current_year - 1)]
        try:
            series = self._provider.get_metric_series([stock_code], metric_ids, periods)
        except DataProviderError:
            return {}
        result: dict[str, float | None] = {}
        for metric_id, points in series.get(stock_code, {}).items():
            result[metric_id] = points[-1].value if points else None
        return result

    def _load_valuation_history(self, stock_code: str, indicator: str, years: int) -> list[dict]:
        profile = self._provider.get_stock_profile(stock_code)
        end_year = date.today().year - 1
        points: list[dict] = []
        for year in range(end_year - years + 1, end_year + 1):
            frame = self._safe_raw_frame(
                "daily_basic",
                ts_code=profile.tsCode,
                start_date=f"{year}1201",
                end_date=f"{year}1231",
            )
            if frame.empty:
                continue
            row = frame.sort_values("trade_date").iloc[-1]
            value = _safe_float(row.get("pe_ttm" if indicator == "PE" else "pb"))
            points.append({"date": f"{year}-12-31", "value": value, "isEstimated": False})
        return points

    def _select_concepts(
        self,
        *,
        theme: str,
        limit: int,
        concept_hints: list[dict] | None = None,
    ) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(limit, 20))
        theme_key = _normalize_text(theme)
        selected = []
        for item in self.get_concept_catalog():
            concept_key = _normalize_text(item.get("conceptName"))
            if not theme_key or not concept_key or (theme_key not in concept_key and concept_key not in theme_key):
                continue
            enriched = dict(item)
            enriched["confidence"] = 1.0 if theme_key == concept_key else 0.8
            enriched["reason"] = f"TuShare THS 概念板块名称匹配主题“{theme.strip()}”"
            enriched["source"] = "tushare:ths_index"
            selected.append(enriched)
        return sorted(selected, key=lambda item: item["confidence"], reverse=True)[:normalized_limit]

    def _select_hint_concepts(
        self,
        theme: str,
        catalog: list[dict[str, Any]],
        concept_hints: list[dict],
    ) -> list[dict[str, Any]]:
        matches: list[dict[str, Any]] = []
        for hint in concept_hints:
            hint_name = _normalize_text(hint.get("name"))
            if not hint_name:
                continue
            aliases = [
                _normalize_text(alias)
                for alias in hint.get("aliases", [])
                if _normalize_text(alias)
            ]
            terms = [hint_name, *aliases]
            for item in catalog:
                concept_key = _normalize_text(item.get("conceptName"))
                if not concept_key:
                    continue
                if not any(term in concept_key or concept_key in term for term in terms):
                    continue
                confidence = _normalize_credibility_score(hint.get("confidence")) or 0.62
                enriched = self._enrich_concept_match(
                    item,
                    theme,
                    min(0.82, max(0.58, confidence)),
                    "zhipu",
                )
                enriched["matchedBy"] = "zhipu"
                enriched["reason"] = hint.get("reason") or enriched["reason"]
                matches.append(enriched)
        return matches

    def _select_sw_hint_concepts(
        self,
        theme: str,
        catalog: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        theme_terms = [_normalize_text(theme)]
        rules = _RULES_REGISTRY.get_rules(theme)
        theme_terms.extend(_normalize_text(item) for item in rules.get("aliases", []))
        hints: list[str] = []
        for term in theme_terms:
            hints.extend(_SW_THEME_INDUSTRY_HINTS.get(term, []))
        normalized_hints = [_normalize_text(item) for item in hints if _normalize_text(item)]
        if not normalized_hints:
            return []
        matches: list[dict[str, Any]] = []
        for item in catalog:
            concept_key = _normalize_text(item.get("conceptName"))
            if not any(hint in concept_key or concept_key in hint for hint in normalized_hints):
                continue
            matches.append(self._enrich_concept_match(item, theme, 0.68, "sw_hint"))
        return matches

    def _enrich_concept_match(
        self,
        item: dict[str, Any],
        theme: str,
        confidence: float,
        source: str,
    ) -> dict[str, Any]:
        result = dict(item)
        result["confidence"] = round(max(0.0, min(1.0, confidence)), 2)
        result["reason"] = (
            f"规则白名单匹配主题“{theme}”"
            if source == "whitelist"
            else f"TuShare 申万行业“{item.get('conceptName')}”与主题“{theme}”文本相关"
        )
        result["source"] = item.get("source") or f"tushare:index_classify:{_SW_INDUSTRY_SOURCE}"
        return result

    def _resolve_concept_code(self, concept_name: str) -> str:
        normalized_name = _normalize_text(concept_name)
        for item in self.get_concept_catalog():
            current_name = _normalize_text(item.get("conceptName"))
            if current_name == normalized_name or normalized_name in current_name:
                return str(item.get("conceptCode") or "")
        return ""

    def _resolve_industry_item(
        self,
        concept_name: str,
        concept_code: str | None = None,
    ) -> dict[str, Any]:
        normalized_name = _normalize_text(concept_name)
        normalized_code = str(concept_code or "").strip()
        for item in self.get_concept_catalog():
            current_code = str(item.get("conceptCode") or "").strip()
            current_name = _normalize_text(item.get("conceptName"))
            if normalized_code and current_code == normalized_code:
                return item
            if normalized_name and (current_name == normalized_name or normalized_name in current_name):
                return item
        return {}

    def _get_etf_snapshot(self, stock_code: str) -> dict[str, Any] | None:
        ts_code = _resolve_fund_ts_code(stock_code)
        frame = self._safe_raw_frame("fund_basic", ts_code=ts_code, market="E")
        if frame.empty:
            return None
        row = frame.iloc[0]
        nav = self._safe_raw_frame("fund_nav", ts_code=ts_code)
        latest = nav.sort_values("nav_date" if "nav_date" in nav.columns else "end_date").iloc[-1] if not nav.empty else pd.Series()
        previous = nav.sort_values("nav_date" if "nav_date" in nav.columns else "end_date").iloc[-2] if len(nav.index) >= 2 else pd.Series()
        latest_nav = _safe_float(latest.get("unit_nav")) or _safe_float(latest.get("adj_nav"))
        previous_nav = _safe_float(previous.get("unit_nav")) or _safe_float(previous.get("adj_nav"))
        return {
            "code": stock_code,
            "name": _pick_text(row, ["name", "ts_code"]) or stock_code,
            "industry": "ETF",
            "sector": "ETF",
            "marketCap": None,
            "floatMarketCap": None,
            "turnoverRate": None,
            "changePercent": _pct_change(latest_nav, previous_nav),
            "pe": None,
            "pb": None,
            "close": latest_nav,
            "dataDate": _format_ymd(latest.get("nav_date") or latest.get("end_date")) if not latest.empty else datetime.now(UTC).date().isoformat(),
            "securityType": "etf",
            "market": "CN-ETF",
            "warnings": ["fund_daily_unavailable_using_fund_nav_proxy"],
        }

    def _safe_raw_frame(self, dataset: str, **params: str) -> pd.DataFrame:
        try:
            return self._raw_frame(dataset, **params)
        except DataProviderError:
            return pd.DataFrame()

    def _raw_frame(self, dataset: str, **params: str) -> pd.DataFrame:
        return self._provider.get_raw_frame(dataset, **params)


def _normalize_stock_code(value: Any) -> str:
    matched = re.search(r"(\d{6})", str(value or "").upper())
    return matched.group(1) if matched else ""


def _dedupe_stock_codes(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = _normalize_stock_code(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _is_etf_code(stock_code: str) -> bool:
    return any(stock_code.startswith(prefix) for prefix in _ETF_PREFIXES)


def _resolve_fund_ts_code(stock_code: str) -> str:
    if "." in stock_code:
        return stock_code.upper()
    suffix = "SH" if stock_code.startswith(("50", "51", "52", "56", "58")) else "SZ"
    return f"{stock_code}.{suffix}"


def _pick_text(row: pd.Series, fields: list[str]) -> str:
    for field in fields:
        if field in row:
            text = str(row.get(field) or "").strip()
            if text and text.lower() != "nan":
                return text
    return ""


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip().replace(",", "")
    if not text or text.lower() in {"nan", "none", "null", "--"}:
        return None
    if text.endswith("%"):
        text = text[:-1]
    try:
        return float(text)
    except ValueError:
        return None


def _format_ymd(value: Any) -> str:
    text = str(value or "").replace("-", "").strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    return text


def _infer_sw_level(index_code: Any) -> str:
    code = str(index_code or "").strip()
    if code.startswith("85"):
        return "L3"
    return ""


def _industry_member_params(index_code: str, level: Any) -> dict[str, str]:
    normalized_level = str(level or "").strip().upper()
    if normalized_level == "L1":
        return {"l1_code": index_code}
    if normalized_level == "L2":
        return {"l2_code": index_code}
    return {"l3_code": index_code}


def _pct_change(latest: float | None, previous: float | None) -> float | None:
    if latest is None or previous in {None, 0}:
        return None
    return round((latest / previous - 1) * 100, 4)


def _extract_board_days(tag: str | None) -> int:
    matched = re.search(r"(\d+)天\d+板", str(tag or ""))
    return int(matched.group(1)) if matched else 0


def _normalize_text(value: Any) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", str(value or "").strip().casefold())


def _concept_match_confidence(theme: str, item: dict[str, Any]) -> float:
    theme_key = _normalize_text(theme)
    concept_key = _normalize_text(item.get("conceptName"))
    if not theme_key or not concept_key:
        return 0.0
    if theme_key == concept_key:
        return 0.95
    if theme_key in concept_key or concept_key in theme_key:
        return 0.78
    tokens = [token for token in _tokenize(theme_key) if token not in _GENERIC_THEME_KEYS]
    hits = sum(1 for token in tokens if token and token in concept_key)
    if hits:
        return min(0.72, 0.52 + hits * 0.08)
    if theme_key in _GENERIC_THEME_KEYS and any(key in concept_key for key in _GENERIC_THEME_KEYS):
        return 0.62
    return 0.0


def _tokenize(text: str) -> list[str]:
    return [token for token in re.split(r"[\s,，、;；:/\\|+&\-]+", text) if len(token) >= 2]


def _score_candidate_heat(
    *,
    concept_heat: float,
    change_pct: float | None,
    turnover: float | None,
    pe_ratio: float | None,
) -> float:
    score = concept_heat * 0.55
    score += (change_pct or 0) * 3.2
    score += (turnover or 0) * 1.7
    if pe_ratio is not None:
        if 0 < pe_ratio <= 35:
            score += 3
        elif pe_ratio > 90:
            score -= 3
    return max(25.0, min(100.0, round(score, 2)))


def _build_candidate_reason(
    concept_name: str,
    change_pct: float | None,
    turnover: float | None,
    pe_ratio: float | None = None,
) -> str:
    parts = [f"来自「{concept_name}」概念"]
    if change_pct is not None:
        parts.append(f"当日涨跌幅 {change_pct:.2f}%")
    if turnover is not None:
        parts.append(f"换手率 {turnover:.2f}%")
    if pe_ratio is not None:
        parts.append(f"动态市盈率 {pe_ratio:.2f}")
    return "，".join(parts)


def _format_metric_line(label: str, value: Any, suffix: str = "") -> str | None:
    numeric = _safe_float(value)
    if numeric is None:
        return None
    if suffix == "%":
        return f"{label}: {numeric:.2f}%"
    if suffix:
        return f"{label}: {numeric:.2f}{suffix}"
    return f"{label}: {numeric:.2f}"


def _normalize_credibility_score(value: int | float | None) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    if numeric <= 1:
        return max(0.0, min(1.0, numeric))
    return max(0.0, min(1.0, numeric / 100))
