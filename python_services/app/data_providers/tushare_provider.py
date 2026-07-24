"""统一 TuShare 数据 provider。
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from importlib.util import find_spec
import math
import os
from typing import Any

import pandas as pd

from app.data_providers.contracts import (
    DailyBar,
    FinancialMetricPoint,
    HsgtFlowSnapshot,
    MacroSnapshot,
    MarketSnapshotRow,
    StockProfile,
)
from app.data_providers.errors import (
    DataProviderConfigurationError,
    DataUnavailableError,
    InvalidSymbolError,
    UnsupportedDatasetError,
)

_UNIVERSE_CACHE_TTL_SECONDS = 86_400
_FRAME_CACHE_TTL_SECONDS = 3_600
_DAILY_BASIC_CACHE_TTL_SECONDS = 21_600
_MARKET_SNAPSHOT_CACHE_TTL_SECONDS = 3_600
_MARKET_SNAPSHOT_LOOKBACK_DAYS = 10
_DEFAULT_TUSHARE_API_URL = "https://api.tushare.pro"

INDEX_BENCHMARK_TS_CODES = {
    "510300": "000300.SH",
    "510500": "000905.SH",
    "159915": "399006.SZ",
    "588000": "000688.SH",
}

INDEX_PROXY_NAMES = {
    "510300": "沪深300",
    "510500": "中证500",
    "159915": "创业板指",
    "588000": "科创50",
}

RAW_DATASET_FIELDS: dict[str, str] = {
    "stock_basic": "ts_code,symbol,name,area,industry,cnspell,market,exchange,list_status,list_date,delist_date,is_hs,act_name,act_ent_type",
    "stock_company": "ts_code,exchange,chairman,manager,secretary,reg_capital,setup_date,province,city,website,email,employees,main_business,business_scope",
    "daily": "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount",
    "weekly": "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount",
    "monthly": "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount",
    "daily_basic": "ts_code,trade_date,close,turnover_rate,turnover_rate_f,volume_ratio,pe,pe_ttm,pb,ps,ps_ttm,dv_ratio,dv_ttm,total_share,float_share,free_share,total_mv,circ_mv,limit_status",
    "index_basic": "ts_code,name,market,publisher,index_type,category,base_date,base_point,list_date",
    "index_daily": "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount",
    "index_dailybasic": "ts_code,trade_date,total_mv,float_mv,total_share,float_share,free_share,turnover_rate,turnover_rate_f,pe,pe_ttm,pb",
    "index_weight": "index_code,con_code,trade_date,weight",
    "index_classify": "index_code,industry_name,level,industry_code,is_pub,parent_code,src",
    "index_member_all": "l1_code,l1_name,l2_code,l2_name,l3_code,l3_name,ts_code,name,in_date,out_date,is_new",
    "ths_index": "ts_code,name,count,exchange,list_date,type",
    "ths_member": "ts_code,code,name,weight,in_date,out_date,is_new",
    "ths_daily": "ts_code,trade_date,close,open,high,low,pre_close,avg_price,change,pct_change,vol,turnover_rate,total_mv,float_mv",
    "ths_hot": "trade_date,ts_code,ts_name,rank,pct_change,current_price,concept,rank_reason,hot,rank_time,market,type",
    "moneyflow": "ts_code,trade_date,buy_sm_vol,buy_sm_amount,sell_sm_vol,sell_sm_amount,buy_md_vol,buy_md_amount,sell_md_vol,sell_md_amount,buy_lg_vol,buy_lg_amount,sell_lg_vol,sell_lg_amount,buy_elg_vol,buy_elg_amount,sell_elg_vol,sell_elg_amount,net_mf_vol,net_mf_amount",
    "margin": "trade_date,exchange_id,rzye,rzmre,rzche,rqye,rqmcl,rqyl,rqchl,rzrqye",
    "margin_detail": "trade_date,ts_code,rzye,rqye,rzmre,rqyl,rzche,rqmcl,rqchl,rzrqye",
    "hk_hold": "trade_date,ts_code,name,vol,ratio,exchange",
    "top_list": "trade_date,ts_code,name,close,pct_change,turnover_rate,amount,l_sell,l_buy,l_amount,net_amount,net_rate,amount_rate,float_values,reason",
    "top_inst": "trade_date,ts_code,exalter,buy,buy_rate,sell,sell_rate,net_buy,reason",
    "block_trade": "ts_code,trade_date,price,vol,amount,buyer,seller",
    "stk_limit": "trade_date,ts_code,up_limit,down_limit",
    "stk_holdernumber": "ts_code,ann_date,end_date,holder_num",
    "stk_holdertrade": "ts_code,ann_date,holder_name,holder_type,in_de,change_vol,change_ratio,after_share,after_ratio,avg_price,total_share,begin_date,close_date",
    "pledge_detail": "ts_code,ann_date,holder_name,pledge_amount,start_date,end_date,is_release,release_date,pledgor,holding_amount,pledged_amount,p_total_ratio,h_total_ratio,is_buyback",
    "pledge_stat": "ts_code,end_date,pledge_count,unrest_pledge,rest_pledge,total_share,pledge_ratio",
    "share_float": "ts_code,ann_date,float_date,float_share,float_ratio,holder_name,share_type",
    "repurchase": "ts_code,ann_date,end_date,proc,exp_date,vol,amount,high_limit,low_limit",
    "income": "ts_code,ann_date,f_ann_date,end_date,report_type,comp_type,basic_eps,total_revenue,revenue,operate_profit,total_profit,n_income,n_income_attr_p,ebit,ebitda,rd_exp",
    "balancesheet": "ts_code,ann_date,f_ann_date,end_date,report_type,comp_type,total_assets,total_liab,total_hldr_eqy_exc_min_int,total_share,cap_rese,undistr_porfit,surplus_rese,money_cap,accounts_receiv,inventories",
    "cashflow": "ts_code,ann_date,f_ann_date,end_date,comp_type,report_type,n_cashflow_act,n_cashflow_inv_act,n_cash_flows_fnc_act,c_cash_equ_end_period,free_cashflow",
    "fina_indicator": "ts_code,ann_date,end_date,eps,dt_eps,gross_margin,current_ratio,quick_ratio,roe,roe_waa,roa,roic,netprofit_margin,grossprofit_margin,debt_to_assets,ocf_to_or,tr_yoy,or_yoy,netprofit_yoy,rd_exp",
    "fina_mainbz": "ts_code,end_date,bz_item,bz_sales,bz_profit,bz_cost,curr_type,update_flag",
    "fina_audit": "ts_code,ann_date,end_date,audit_result,audit_fees,audit_agency,audit_sign",
    "forecast": "ts_code,ann_date,end_date,type,p_change_min,p_change_max,net_profit_min,net_profit_max,last_parent_net,first_ann_date,summary,change_reason",
    "express": "ts_code,ann_date,end_date,revenue,operate_profit,total_profit,n_income,total_assets,total_hldr_eqy_exc_min_int,diluted_eps,diluted_roe,yoy_net_profit,bps,yoy_sales,yoy_op,yoy_tp,yoy_dedu_np",
    "disclosure_date": "ts_code,ann_date,end_date,pre_date,actual_date,modify_date",
    "dividend": "ts_code,end_date,ann_date,div_proc,stk_div,stk_bo_rate,stk_co_rate,cash_div,cash_div_tax,record_date,ex_date,pay_date",
    "fund_basic": "ts_code,name,management,custodian,fund_type,found_date,due_date,list_date,issue_date,delist_date,issue_amount,m_fee,c_fee,duration_year,p_value,min_amount,exp_return,benchmark,status,invest_type,type,trustee,purc_startdate,redm_startdate,market",
    "fund_nav": "ts_code,ann_date,end_date,nav_date,unit_nav,accum_nav,accum_div,net_asset,total_netasset,adj_nav",
    "fund_daily": "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount",
    "fund_portfolio": "ts_code,ann_date,end_date,symbol,mkv,amount,stk_mkv_ratio,stk_float_ratio",
    "cb_basic": "ts_code,bond_full_name,bond_short_name,stk_code,stk_short_name,maturity,par,issue_price,issue_size,remain_size,value_date,maturity_date,rate_type,coupon_rate,add_rate,pay_per_year,list_date,delist_date,exchange,conv_start_date,conv_end_date,conv_price",
    "cb_issue": "ts_code,ann_date,res_ann_date,plan_issue_size,issue_size,issue_price,issue_type,issue_cost,onl_code,onl_name,onl_date,onl_size,onl_pch_vol,onl_pch_num,onl_pch_excess,onl_winning_rate,shd_ration_code,shd_ration_name,shd_ration_date,shd_ration_record_date,shd_ration_pay_date,shd_ration_price,shd_ration_ratio,shd_ration_size,offl_size,offl_deposit,offl_pch_vol,offl_pch_num,offl_pch_excess,offl_winning_rate,lead_underwriter,lead_underwriter_vol",
    "cb_daily": "ts_code,trade_date,pre_close,open,high,low,close,change,pct_chg,vol,amount",
    "shibor": "date,on,1w,2w,1m,3m,6m,9m,1y",
    "shibor_lpr": "date,1y,5y",
    "libor": "date,curr,on,1w,1m,2m,3m,6m,12m",
    "hibor": "date,on,1w,2w,1m,2m,3m,6m,12m",
}

MARKET_TOOL_SPECS: dict[str, list[tuple[str, str]]] = {
    "stock_search": [("stock_basic", "rows")],
    "stock_profile": [("stock_basic", "security"), ("stock_company", "company")],
    "stock_bars": [("daily", "rows")],
    "stock_daily_basic": [("daily_basic", "rows")],
    "index_market": [("index_basic", "basic"), ("index_daily", "bars"), ("index_dailybasic", "valuation")],
    "index_constituents": [("index_weight", "rows")],
    "moneyflow": [("moneyflow", "moneyflow"), ("margin", "margin"), ("margin_detail", "marginDetail"), ("hk_hold", "hkHold")],
    "market_events": [("top_list", "topList"), ("top_inst", "topInst"), ("block_trade", "blockTrade"), ("stk_limit", "limit")],
    "shareholder_events": [("stk_holdernumber", "holderNumber"), ("stk_holdertrade", "holderTrade"), ("pledge_detail", "pledgeDetails"), ("pledge_stat", "pledgeStats"), ("share_float", "shareFloat"), ("repurchase", "repurchase")],
    "financial_statements": [("income", "income"), ("balancesheet", "balanceSheet"), ("cashflow", "cashFlow")],
    "financial_indicators": [("fina_indicator", "indicator"), ("fina_mainbz", "mainBusiness"), ("fina_audit", "audit")],
    "earnings_events": [("forecast", "forecast"), ("express", "express"), ("disclosure_date", "disclosureDate"), ("dividend", "dividend")],
    "fund_market": [("fund_basic", "basic"), ("fund_nav", "nav"), ("fund_daily", "daily"), ("fund_portfolio", "portfolio")],
    "convertible_bond_market": [("cb_basic", "basic"), ("cb_issue", "issue"), ("cb_daily", "daily")],
    "macro_rates": [("shibor", "shibor"), ("shibor_lpr", "lpr"), ("libor", "libor"), ("hibor", "hibor")],
}

LATEST_METRIC_FIELDS: dict[str, str] = {
    "pe_ttm": "pe_ttm",
    "pb": "pb",
    "ps_ttm": "ps_ttm",
    "dv_ttm": "dv_ttm",
    "market_cap": "total_mv",
    "float_market_cap": "circ_mv",
    "total_shares": "total_share",
    "float_a_shares": "float_share",
    "free_share": "free_share",
}

SERIES_METRIC_FIELDS: dict[str, tuple[str, str]] = {
    "roe_report": ("fina_indicator", "roe"),
    "eps_report": ("fina_indicator", "eps"),
    "grossprofit_margin": ("fina_indicator", "grossprofit_margin"),
    "netprofit_margin": ("fina_indicator", "netprofit_margin"),
    "roa": ("fina_indicator", "roa"),
    "roic": ("fina_indicator", "roic"),
    "bps": ("fina_indicator", "bps"),
    "q_sales_yoy": ("fina_indicator", "q_sales_yoy"),
    "q_netprofit_yoy": ("fina_indicator", "q_netprofit_yoy"),
    "dt_netprofit_yoy": ("fina_indicator", "dt_netprofit_yoy"),
    "current_ratio": ("fina_indicator", "current_ratio"),
    "quick_ratio": ("fina_indicator", "quick_ratio"),
    "cash_ratio": ("fina_indicator", "cash_ratio"),
    "ocfps": ("fina_indicator", "ocfps"),
    "cfps": ("fina_indicator", "cfps"),
    "assets_turn": ("fina_indicator", "assets_turn"),
    "ar_turn": ("fina_indicator", "ar_turn"),
    "inv_turn": ("fina_indicator", "inv_turn"),
    "revenue": ("income", "total_revenue"),
    "net_profit_parent": ("income", "n_income_attr_p"),
    "n_cashflow_act": ("cashflow", "n_cashflow_act"),
    "free_cashflow": ("cashflow", "free_cashflow"),
}

RATIO_METRIC_IDS = {
    "roe_report",
    "grossprofit_margin",
    "netprofit_margin",
    "roa",
    "roic",
    "q_sales_yoy",
    "q_netprofit_yoy",
    "dt_netprofit_yoy",
    "asset_liability_ratio",
}

AMOUNT_METRIC_IDS = {
    "revenue",
    "net_profit_parent",
    "n_cashflow_act",
    "free_cashflow",
}


def _create_tushare_client(token: str):
    if find_spec("tushare") is None:
        raise DataProviderConfigurationError(
            "tushare SDK is not installed",
            provider="tushare",
        )

    import tushare as ts  # pragma: no cover - runtime dependency

    client = ts.pro_api(token)
    api_url = os.getenv("TUSHARE_API_URL", _DEFAULT_TUSHARE_API_URL).strip()
    if not api_url:
        api_url = _DEFAULT_TUSHARE_API_URL

    client._DataApi__http_url = api_url.rstrip("/")
    return client


def _now_timestamp() -> float:
    return pd.Timestamp.utcnow().timestamp()


class TushareProvider:
    provider_name = "tushare"

    def __init__(self, *, token: str | None = None) -> None:
        self._token = token
        self._client = None
        self._universe_cache: tuple[float, dict[str, StockProfile]] | None = None
        self._daily_basic_cache: tuple[float, str, dict[str, dict[str, Any]]] | None = None
        self._frame_cache: dict[tuple[str, tuple[tuple[str, str], ...]], tuple[float, pd.DataFrame]] = {}
        self._market_snapshot_cache: dict[str | None, tuple[float, list[MarketSnapshotRow]]] = {}

    def get_stock_universe(self) -> list[StockProfile]:
        return list(self._load_universe_map().values())

    def get_stock_profile(self, stock_code: str) -> StockProfile:
        normalized_code = self._normalize_stock_code_or_raise(stock_code)
        if normalized_code in INDEX_PROXY_NAMES:
            return StockProfile(
                stockCode=normalized_code,
                tsCode=INDEX_BENCHMARK_TS_CODES.get(normalized_code, normalized_code),
                stockName=INDEX_PROXY_NAMES[normalized_code],
                market="INDEX",
                sector="指数代理",
                industry="指数代理",
            )

        profile = self._load_universe_map().get(normalized_code)
        if profile is None:
            raise InvalidSymbolError(
                f"Unknown stock code: {stock_code}",
                provider=self.provider_name,
            )
        return profile

    def search_stocks(self, keyword: str, limit: int = 20) -> list[StockProfile]:
        normalized_keyword = keyword.strip().lower()
        if not normalized_keyword:
            return []

        bounded_limit = max(1, min(limit, 100))
        matches: list[StockProfile] = []
        for profile in self.get_stock_universe():
            haystacks = (
                profile.stockCode.lower(),
                profile.tsCode.lower(),
                profile.stockName.lower(),
                profile.industry.lower(),
            )
            if any(normalized_keyword in item for item in haystacks):
                matches.append(profile)
                if len(matches) >= bounded_limit:
                    break
        return matches

    def get_daily_bars(
    def is_a_share_trading_day(self, trading_date: date) -> bool:
        date_text = trading_date.strftime("%Y%m%d")
        frame = self._ensure_frame(
            self._get_client().trade_cal(
                exchange="SSE",
                start_date=date_text,
                end_date=date_text,
            )
        )
        if frame.empty:
            return False
        return any(str(item).strip() == "1" for item in frame.get("is_open", []))

    def get_stock_search_universe(self) -> list[dict[str, str]]:
        frame = self._ensure_frame(
            self._get_client().stock_basic(
                exchange="",
                list_status="L",
                fields="ts_code,symbol,name,exchange,list_status",
            )
        )
        market_by_exchange = {"SSE": "SH", "SZSE": "SZ", "BSE": "BJ"}
        records: list[dict[str, str]] = []
        seen_codes: set[str] = set()
        for _, row in frame.iterrows():
            stock_code = self._normalize_stock_code(row.get("symbol"))
            stock_name = str(row.get("name") or "").strip()
            market = market_by_exchange.get(str(row.get("exchange") or "").strip().upper())
            if not stock_code or not stock_name or not market or stock_code in seen_codes:
                continue
            seen_codes.add(stock_code)
            records.append(
                {
                    "stockCode": stock_code,
                    "stockName": stock_name,
                    "market": market,
                }
            )
        return sorted(records, key=lambda item: item["stockCode"])

        self,
        stock_code: str,
        start_date: str | None = None,
        end_date: str | None = None,
        adjust: str = "qfq",
    ) -> list[DailyBar]:
        normalized_code = self._normalize_stock_code_or_raise(stock_code)
        normalized_adjust = adjust.strip().lower()
        if normalized_code in INDEX_BENCHMARK_TS_CODES:
            frame = self._load_index_daily_frame(
                INDEX_BENCHMARK_TS_CODES[normalized_code],
                start_date=start_date,
                end_date=end_date,
            )
            return self._frame_to_daily_bars(frame, normalized_code)

        if normalized_adjust not in {"", "qfq", "hfq"}:
            raise UnsupportedDatasetError(
                f"Unsupported adjust mode: {adjust}",
                provider=self.provider_name,
            )

        ts_code = self.get_stock_profile(normalized_code).tsCode
        daily_frame = self._load_daily_frame(ts_code, start_date=start_date, end_date=end_date)
        if daily_frame.empty:
            raise DataUnavailableError(
                f"Daily bars not found for {normalized_code}",
                provider=self.provider_name,
            )

        daily_basic_frame = self._load_daily_basic_frame(
            ts_code,
            start_date=start_date,
            end_date=end_date,
        )
        merged = daily_frame.merge(daily_basic_frame, on="trade_date", how="left")

        if normalized_adjust:
            factor_frame = self._load_adj_factor_frame(
                ts_code,
                start_date=start_date,
                end_date=end_date,
            )
            if factor_frame.empty:
                raise DataUnavailableError(
                    f"Adjustment factors not found for {normalized_code}",
                    provider=self.provider_name,
                )
            merged = self._apply_adjustment(
                merged.merge(factor_frame, on="trade_date", how="left"),
                normalized_adjust,
            )

        return self._frame_to_daily_bars(merged, normalized_code)

    def get_market_snapshot(self, as_of_date: str | None = None) -> list[MarketSnapshotRow]:
        cache_key = self._normalize_ymd(as_of_date) if as_of_date else None
        cached = self._market_snapshot_cache.get(cache_key)
        if cached is not None and _now_timestamp() - cached[0] <= _MARKET_SNAPSHOT_CACHE_TTL_SECONDS:
            return list(cached[1])

        snapshot = self._load_market_snapshot(as_of_date)
        self._market_snapshot_cache[cache_key] = (_now_timestamp(), snapshot)
        return snapshot

    def get_latest_metrics(
        self,
        stock_codes: list[str],
        metric_ids: list[str],
    ) -> dict[str, dict[str, float | None]]:
        snapshot_map = self._load_daily_basic_map()
        results = {stock_code: {} for stock_code in self._normalize_stock_codes(stock_codes)}
        for stock_code in results:
            row = snapshot_map.get(stock_code, {})
            for metric_id in metric_ids:
                field_name = LATEST_METRIC_FIELDS.get(metric_id)
                if field_name is None:
                    continue
                results[stock_code][metric_id] = self._normalize_latest_metric(
                    metric_id,
                    row.get(field_name),
                )
        return results

    def get_metric_series(
        self,
        stock_codes: list[str],
        metric_ids: list[str],
        periods: list[str],
    ) -> dict[str, dict[str, list[FinancialMetricPoint]]]:
        results: dict[str, dict[str, list[FinancialMetricPoint]]] = {}
        for stock_code in self._normalize_stock_codes(stock_codes):
            results[stock_code] = {}
            for metric_id in metric_ids:
                points: list[FinancialMetricPoint] = []
                for period in periods:
                    end_date = self._period_to_end_date(period)
                    points.append(
                        FinancialMetricPoint(
                            stockCode=stock_code,
                            metricId=metric_id,
                            period=period,
                            endDate=self._format_ymd(end_date),
                            value=self._resolve_metric_value(stock_code, metric_id, end_date),
                        )
                    )
                results[stock_code][metric_id] = points
        return results

    def get_macro_snapshot(self) -> MacroSnapshot:
        client = self._get_client()
        gdp_row = self._latest_row(client.cn_gdp())
        m2_row = self._latest_row(client.cn_m())
        sf_row = self._latest_row(client.sf_month())
        pmi_row = self._latest_row(client.cn_pmi())

        as_of = max(
            filter(
                None,
                [
                    self._pick_first_text(gdp_row, ["quarter", "ann_date"]),
                    self._pick_first_text(m2_row, ["month"]),
                    self._pick_first_text(sf_row, ["month"]),
                    self._pick_first_text(pmi_row, ["month"]),
                ],
            ),
            default=date.today().strftime("%Y%m%d"),
        )

        return MacroSnapshot(
            asOf=self._format_ymd(as_of),
            gdpYoY=self._pick_first_float(gdp_row, ["gdp_yoy"]),
            m2YoY=self._pick_first_float(m2_row, ["m2_yoy"]),
            socialFinancingIncrement=self._pick_first_float(sf_row, ["inc_month"]),
            manufacturingPmi=self._pick_first_float(pmi_row, ["pmi010000", "pmi"]),
        )

    def get_hsgt_flow_snapshot(self) -> HsgtFlowSnapshot:
        end_date = date.today()
        start_date = end_date - timedelta(days=14)
        frame = self._get_client().moneyflow_hsgt(
            start_date=start_date.strftime("%Y%m%d"),
            end_date=end_date.strftime("%Y%m%d"),
        )
        row = self._latest_row(frame)
        return HsgtFlowSnapshot(
            asOf=self._format_ymd(self._pick_first_text(row, ["trade_date"]) or end_date.strftime("%Y%m%d")),
            northboundNetAmount=self._pick_first_float(row, ["north_money"]),
            southboundNetAmount=self._pick_first_float(row, ["south_money"]),
        )

    def get_raw_frame(self, dataset: str, **params: str) -> pd.DataFrame:
        supported_datasets = {
            *RAW_DATASET_FIELDS.keys(),
            "adj_factor",
            "cn_gdp",
            "cn_m",
            "sf_month",
            "cn_pmi",
            "moneyflow_hsgt",
        }
        if dataset not in supported_datasets:
            raise UnsupportedDatasetError(
                f"Unsupported TuShare dataset: {dataset}",
                provider=self.provider_name,
            )

        loader = getattr(self._get_client(), dataset)
        frame = loader(**params)
        return frame.copy() if isinstance(frame, pd.DataFrame) else pd.DataFrame()

    def get_stock_profile_dict(self, stock_code: str) -> dict[str, Any]:
        return asdict(self.get_stock_profile(stock_code))

    def query_market_tool(self, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        specs = MARKET_TOOL_SPECS.get(operation)
        if specs is None:
            raise UnsupportedDatasetError(
                f"Unsupported market operation: {operation}",
                provider=self.provider_name,
            )

        started_at = _now_timestamp()
        warnings: list[str] = []
        normalized_request = self._normalize_market_tool_request(operation, payload)
        selected_specs = self._filter_market_specs(operation, specs, payload)
        selected_specs, skipped_apis = self._skip_apis_unavailable_for_2000_credits(
            operation,
            selected_specs,
        )
        warnings.extend(
            f"{dataset} skipped: TuShare 2000-credit mode uses lower-permission substitutes"
            for dataset in skipped_apis
        )
        result: dict[str, Any] = {
            "provider": self.provider_name,
            "api": [dataset for dataset, _key in selected_specs],
            "request": normalized_request,
            "rows": [],
            "warnings": warnings,
            "diagnostics": {
                "cacheHit": False,
                "rowCount": 0,
                "elapsedMs": 0,
                "skippedApis": skipped_apis,
                "failedApis": [],
            },
        }

        keyed_rows: dict[str, list[dict[str, Any]]] = {}
        for dataset, result_key in selected_specs:
            params = self._build_market_dataset_params(dataset, normalized_request)
            if dataset in {"stock_basic", "index_basic", "fund_basic"}:
                params = {key: value for key, value in params.items() if key in {"ts_code", "name", "market", "list_status", "exchange", "is_hs"}}
            fields = RAW_DATASET_FIELDS.get(dataset)
            if fields:
                params["fields"] = fields
            try:
                frame = self.get_raw_frame(dataset, **{key: str(value) for key, value in params.items() if value not in {None, ""}})
            except DataProviderError:
                result["diagnostics"]["failedApis"].append(dataset)
                raise
            rows = self._frame_to_records(frame)
            if not rows:
                warnings.append(f"{dataset} returned empty result")
            keyed_rows[result_key] = rows

        if len(keyed_rows) == 1 and "rows" in keyed_rows:
            result["rows"] = keyed_rows["rows"]
        else:
            result["rows"] = keyed_rows
        result["diagnostics"]["rowCount"] = self._count_market_rows(result["rows"])
        result["diagnostics"]["elapsedMs"] = int((_now_timestamp() - started_at) * 1000)
        return result

    def _get_client(self):
        if self._client is not None:
            return self._client

        token = self._token or os.getenv("TUSHARE_TOKEN", "").strip()
        if not token:
            raise DataProviderConfigurationError(
                "Missing TUSHARE_TOKEN",
                provider=self.provider_name,
            )

        self._client = _create_tushare_client(token)
        return self._client

    def _normalize_market_tool_request(self, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(payload)
        for date_key in ("tradeDate", "startDate", "endDate", "annDate", "period"):
            value = normalized.get(date_key)
            if isinstance(value, str) and value.strip():
                normalized[date_key] = self._normalize_ymd(value.strip())

        stock_code = normalized.get("stockCode")
        if isinstance(stock_code, str) and stock_code.strip():
            normalized["stockCode"] = stock_code.strip().upper()
            normalized["tsCode"] = self._resolve_ts_code(stock_code)

        index_code = normalized.get("indexCode")
        if isinstance(index_code, str) and index_code.strip():
            normalized["indexCode"] = index_code.strip().upper()

        fund_code = normalized.get("fundCode")
        if isinstance(fund_code, str) and fund_code.strip():
            normalized["fundCode"] = fund_code.strip().upper()

        bond_code = normalized.get("bondCode")
        if isinstance(bond_code, str) and bond_code.strip():
            normalized["bondCode"] = bond_code.strip().upper()

        if operation == "stock_bars":
            freq = str(normalized.get("freq") or "daily").strip().lower()
            if freq not in {"daily", "weekly", "monthly"}:
                raise UnsupportedDatasetError(f"Unsupported bar frequency: {freq}", provider=self.provider_name)
            normalized["freq"] = freq
            adjust = str(normalized.get("adjust") or "qfq").strip().lower()
            if adjust not in {"none", "", "qfq", "hfq"}:
                raise UnsupportedDatasetError(f"Unsupported adjust mode: {adjust}", provider=self.provider_name)
            normalized["adjust"] = adjust or "none"

        return normalized

    def _filter_market_specs(
        self,
        operation: str,
        specs: list[tuple[str, str]],
        payload: dict[str, Any],
    ) -> list[tuple[str, str]]:
        if operation == "stock_profile" and not payload.get("includeCompany", True):
            return [(dataset, key) for dataset, key in specs if dataset == "stock_basic"]
        if operation == "index_market":
            filtered = [(dataset, key) for dataset, key in specs if dataset != "index_dailybasic" or payload.get("includeValuation", True)]
            return [(dataset, key) for dataset, key in filtered if dataset != "index_basic" or payload.get("includeBasic", True)]
        if operation == "stock_bars":
            freq = str(payload.get("freq") or "daily").strip().lower()
            dataset = {"daily": "daily", "weekly": "weekly", "monthly": "monthly"}.get(freq, "daily")
            return [(dataset, "rows")]
        if operation == "financial_statements":
            statement = str(payload.get("statement") or "all").strip()
            if statement == "all":
                return specs
            statement_map = {
                "income": "income",
                "balanceSheet": "balancesheet",
                "balancesheet": "balancesheet",
                "cashFlow": "cashflow",
                "cashflow": "cashflow",
            }
            dataset = statement_map.get(statement)
            if dataset is None:
                raise UnsupportedDatasetError(
                    f"Unsupported financial statement: {statement}",
                    provider=self.provider_name,
                )
            return [(item_dataset, key) for item_dataset, key in specs if item_dataset == dataset]

        include = payload.get("include")
        if not isinstance(include, list) or not include:
            return specs
        include_set = {str(item).strip() for item in include if str(item).strip()}
        aliases = self._market_include_aliases(operation)
        return [
            (dataset, key)
            for dataset, key in specs
            if key in include_set or dataset in include_set or aliases.get(key) in include_set
        ] or specs

    def _skip_apis_unavailable_for_2000_credits(
        self,
        operation: str,
        specs: list[tuple[str, str]],
    ) -> tuple[list[tuple[str, str]], list[str]]:
        if operation != "fund_market":
            return specs, []
        skipped_datasets = {"fund_daily", "fund_portfolio"}
        filtered_specs = [
            (dataset, key)
            for dataset, key in specs
            if dataset not in skipped_datasets
        ]
        skipped = [dataset for dataset, _key in specs if dataset in skipped_datasets]
        return filtered_specs, skipped

    def _market_include_aliases(self, operation: str) -> dict[str, str]:
        if operation == "moneyflow":
            return {"marginDetail": "margin", "hkHold": "hkHold"}
        if operation == "market_events":
            return {"topList": "topList", "topInst": "topInst", "blockTrade": "blockTrade", "limit": "limit"}
        if operation == "shareholder_events":
            return {"holderNumber": "holderNumber", "holderTrade": "holderTrade", "pledgeDetails": "pledge", "pledgeStats": "pledge", "shareFloat": "shareFloat", "repurchase": "repurchase"}
        if operation == "financial_indicators":
            return {"indicator": "indicator", "mainBusiness": "mainBusiness", "audit": "audit"}
        if operation == "earnings_events":
            return {"forecast": "forecast", "express": "express", "disclosureDate": "disclosureDate", "dividend": "dividend"}
        return {}

    def _build_market_dataset_params(self, dataset: str, request: dict[str, Any]) -> dict[str, Any]:
        params: dict[str, Any] = {}
        ts_code = request.get("tsCode")
        trade_date = request.get("tradeDate")
        start_date = request.get("startDate")
        end_date = request.get("endDate")
        period = request.get("period")

        if dataset == "stock_basic":
            if request.get("stockCode"):
                params["ts_code"] = ts_code
            if request.get("keyword"):
                keyword = str(request.get("keyword")).strip()
                if keyword.isdigit():
                    params["ts_code"] = self._resolve_ts_code(keyword)
                else:
                    params["name"] = keyword
            params["list_status"] = request.get("listStatus", "L")
            params["exchange"] = request.get("exchange") or ""
            return params

        if dataset == "stock_company":
            if ts_code:
                params["ts_code"] = ts_code
            return params

        if dataset in {"daily", "weekly", "monthly", "daily_basic", "moneyflow", "margin", "margin_detail", "hk_hold", "top_list", "top_inst", "block_trade", "stk_limit", "stk_holdernumber", "stk_holdertrade", "pledge_detail", "pledge_stat", "share_float", "repurchase", "income", "balancesheet", "cashflow", "fina_indicator", "fina_mainbz", "fina_audit", "forecast", "express", "disclosure_date", "dividend"}:
            if ts_code and dataset not in {"margin", "stk_limit"}:
                params["ts_code"] = ts_code
            if trade_date and dataset not in {"stk_holdernumber", "income", "balancesheet", "cashflow", "fina_indicator", "fina_mainbz", "fina_audit", "forecast", "express", "disclosure_date", "dividend"}:
                params["trade_date"] = trade_date
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
            if period and dataset in {"income", "balancesheet", "cashflow", "fina_indicator", "fina_mainbz", "fina_audit", "forecast", "express", "disclosure_date", "dividend"}:
                params["period"] = period
            if request.get("reportType") and dataset in {"income", "balancesheet", "cashflow"}:
                params["report_type"] = request.get("reportType")
            return params

        if dataset in {"index_basic", "index_daily", "index_dailybasic", "index_weight", "ths_daily"}:
            index_code = request.get("indexCode")
            params["ts_code" if dataset != "index_weight" else "index_code"] = index_code
            if trade_date:
                params["trade_date"] = trade_date
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
            return params

        if dataset == "ths_index":
            if request.get("indexCode"):
                params["ts_code"] = request.get("indexCode")
            if request.get("exchange"):
                params["exchange"] = request.get("exchange")
            if request.get("marketType"):
                params["type"] = request.get("marketType")
            return params

        if dataset == "ths_member":
            if request.get("indexCode"):
                params["ts_code"] = request.get("indexCode")
            if request.get("stockCode"):
                params["code"] = request.get("stockCode")
            return params

        if dataset == "ths_hot":
            if trade_date:
                params["trade_date"] = trade_date
            if request.get("market"):
                params["market"] = request.get("market")
            if request.get("marketType"):
                params["type"] = request.get("marketType")
            return params

        if dataset in {"index_classify", "index_member_all"}:
            return params

        if dataset in {"fund_basic", "fund_nav", "fund_daily", "fund_portfolio"}:
            params["ts_code"] = request.get("fundCode")
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
            return params

        if dataset in {"cb_basic", "cb_issue", "cb_daily"}:
            params["ts_code"] = request.get("bondCode")
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
            return params

        if dataset in {"shibor", "shibor_lpr", "libor", "hibor"}:
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
            return params

        return params

    def _resolve_ts_code(self, raw_code: str) -> str:
        text = str(raw_code or "").strip().upper()
        if "." in text:
            return text
        stock_code = self._normalize_stock_code(text)
        if not stock_code:
            raise InvalidSymbolError(f"Invalid stock code: {raw_code}", provider=self.provider_name)
        try:
            return self.get_stock_profile(stock_code).tsCode
        except InvalidSymbolError:
            market = self._infer_market(stock_code)
            suffix = "SH" if market == "SH" else "BJ" if market == "BJ" else "SZ"
            return f"{stock_code}.{suffix}"

    def _frame_to_records(self, frame: pd.DataFrame) -> list[dict[str, Any]]:
        normalized = self._ensure_frame(frame)
        if normalized.empty:
            return []
        normalized = normalized.where(pd.notnull(normalized), None)
        return [dict(row) for row in normalized.to_dict(orient="records")]

    def _count_market_rows(self, rows: Any) -> int:
        if isinstance(rows, list):
            return len(rows)
        if isinstance(rows, dict):
            return sum(len(value) for value in rows.values() if isinstance(value, list))
        return 0

    def _load_universe_map(self) -> dict[str, StockProfile]:
        cached = self._universe_cache
        if cached is not None and _now_timestamp() - cached[0] <= _UNIVERSE_CACHE_TTL_SECONDS:
            return cached[1]

        frame = self._get_client().stock_basic(
            exchange="",
            list_status="L",
            fields="ts_code,symbol,name,industry",
        )
        universe_map: dict[str, StockProfile] = {}
        for _, row in self._ensure_frame(frame).iterrows():
            stock_code = self._normalize_stock_code(row.get("symbol"))
            ts_code = str(row.get("ts_code") or "").strip().upper()
            if not stock_code or not ts_code:
                continue
            universe_map[stock_code] = StockProfile(
                stockCode=stock_code,
                tsCode=ts_code,
                stockName=str(row.get("name") or stock_code).strip(),
                market=self._infer_market(stock_code),
                sector=self._infer_sector(stock_code),
                industry=str(row.get("industry") or "").strip(),
            )

        self._universe_cache = (_now_timestamp(), universe_map)
        return universe_map

    def _load_daily_basic_map(self) -> dict[str, dict[str, Any]]:
        cached = self._daily_basic_cache
        if cached is not None and _now_timestamp() - cached[0] <= _DAILY_BASIC_CACHE_TTL_SECONDS:
            return cached[2]

        snapshot_map: dict[str, dict[str, Any]] = {}
        chosen_trade_date = ""
        for trade_date in self._candidate_trade_dates(None, lookback_days=7):
            frame = self._get_client().daily_basic(
                trade_date=trade_date,
                fields="ts_code,pe_ttm,pb,ps_ttm,dv_ttm,total_mv,circ_mv,total_share,float_share,free_share",
            )
            frame = self._ensure_frame(frame)
            if frame.empty:
                continue
            chosen_trade_date = trade_date
            for _, row in frame.iterrows():
                stock_code = self._normalize_stock_code(row.get("ts_code"))
                if stock_code:
                    snapshot_map[stock_code] = dict(row)
            if snapshot_map:
                break

        self._daily_basic_cache = (_now_timestamp(), chosen_trade_date, snapshot_map)
        return snapshot_map

    def _load_market_snapshot(self, as_of_date: str | None) -> list[MarketSnapshotRow]:
        universe_map = self._load_universe_map()
        for trade_date in self._candidate_trade_dates(
            as_of_date,
            lookback_days=_MARKET_SNAPSHOT_LOOKBACK_DAYS,
        ):
            daily_frame = self._get_client().daily(
                trade_date=trade_date,
                fields="ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount",
            )
            daily_frame = self._ensure_frame(daily_frame)
            if daily_frame.empty:
                continue

            daily_basic_frame = self._ensure_frame(
                self._get_client().daily_basic(
                    trade_date=trade_date,
                    fields="ts_code,trade_date,close,turnover_rate,turnover_rate_f,volume_ratio,total_mv,circ_mv,limit_status",
                )
            )
            merged = daily_frame.copy()
            if not daily_basic_frame.empty:
                merged = merged.merge(
                    daily_basic_frame.drop(columns=["trade_date"], errors="ignore"),
                    on="ts_code",
                    how="left",
                    suffixes=("", "_basic"),
                )

            limit_frame = pd.DataFrame()
            limit_loader = getattr(self._get_client(), "stk_limit", None)
            if limit_loader is not None:
                try:
                    limit_frame = self._ensure_frame(
                        limit_loader(
                            trade_date=trade_date,
                            fields="trade_date,ts_code,up_limit,down_limit",
                        )
                    )
                except Exception:  # noqa: BLE001
                    limit_frame = pd.DataFrame()
            if not limit_frame.empty:
                merged = merged.merge(
                    limit_frame.drop(columns=["trade_date"], errors="ignore"),
                    on="ts_code",
                    how="left",
                )

            rows: list[MarketSnapshotRow] = []
            for _, row in merged.iterrows():
                stock_code = self._normalize_stock_code(row.get("ts_code"))
                if not stock_code:
                    continue
                profile = universe_map.get(stock_code)
                rows.append(
                    MarketSnapshotRow(
                        stockCode=stock_code,
                        stockName=profile.stockName if profile else stock_code,
                        industry=profile.industry if profile else "",
                        tradeDate=self._format_ymd(row.get("trade_date") or trade_date),
                        open=self._safe_float(row.get("open")),
                        high=self._safe_float(row.get("high")),
                        low=self._safe_float(row.get("low")),
                        close=self._safe_float(row.get("close")),
                        preClose=self._safe_float(row.get("pre_close")),
                        changeAmount=self._safe_float(row.get("change")),
                        changePercent=self._safe_float(row.get("pct_chg")),
                        volume=self._safe_float(row.get("vol")),
                        amount=self._safe_float(row.get("amount")),
                        turnoverRate=self._safe_float(row.get("turnover_rate")),
                        turnoverRateFree=self._safe_float(row.get("turnover_rate_f")),
                        volumeRatio=self._safe_float(row.get("volume_ratio")),
                        marketCap=self._safe_float(row.get("total_mv")),
                        floatMarketCap=self._safe_float(row.get("circ_mv")),
                        limitStatus=self._pick_first_text(row, ["limit_status"]),
                        upLimit=self._safe_float(row.get("up_limit")),
                        downLimit=self._safe_float(row.get("down_limit")),
                    )
                )
            if rows:
                return rows

        requested = as_of_date or datetime.now(UTC).strftime("%Y-%m-%d")
        raise DataUnavailableError(
            f"TuShare market snapshot unavailable near {requested}",
            provider=self.provider_name,
        )

    def _load_daily_frame(
        self,
        ts_code: str,
        *,
        start_date: str | None,
        end_date: str | None,
    ) -> pd.DataFrame:
        return self._load_cached_frame(
            "daily",
            ts_code=ts_code,
            start_date=start_date,
            end_date=end_date,
            fields="trade_date,open,high,low,close,vol,amount",
        )

    def _load_daily_basic_frame(
        self,
        ts_code: str,
        *,
        start_date: str | None,
        end_date: str | None,
    ) -> pd.DataFrame:
        return self._load_cached_frame(
            "daily_basic",
            ts_code=ts_code,
            start_date=start_date,
            end_date=end_date,
            fields="trade_date,turnover_rate",
        )

    def _load_adj_factor_frame(
        self,
        ts_code: str,
        *,
        start_date: str | None,
        end_date: str | None,
    ) -> pd.DataFrame:
        return self._load_cached_frame(
            "adj_factor",
            ts_code=ts_code,
            start_date=start_date,
            end_date=end_date,
            fields="trade_date,adj_factor",
        )

    def _load_index_daily_frame(
        self,
        ts_code: str,
        *,
        start_date: str | None,
        end_date: str | None,
    ) -> pd.DataFrame:
        return self._load_cached_frame(
            "index_daily",
            ts_code=ts_code,
            start_date=start_date,
            end_date=end_date,
            fields="trade_date,open,high,low,close,vol,amount",
        )

    def _load_series_frame(self, dataset: str, stock_code: str) -> pd.DataFrame:
        ts_code = self.get_stock_profile(stock_code).tsCode
        return self._load_cached_frame(dataset, ts_code=ts_code)

    def _load_cached_frame(self, dataset: str, **params: str | None) -> pd.DataFrame:
        normalized_params = {
            key: self._normalize_ymd(value) if key.endswith("date") and value else value
            for key, value in params.items()
            if value is not None
        }
        cache_key = (
            dataset,
            tuple(sorted((key, str(value)) for key, value in normalized_params.items())),
        )
        cached = self._frame_cache.get(cache_key)
        if cached is not None and _now_timestamp() - cached[0] <= _FRAME_CACHE_TTL_SECONDS:
            return cached[1].copy()

        loader = getattr(self._get_client(), dataset)
        frame = self._normalize_market_frame(self._ensure_frame(loader(**normalized_params)))
        self._frame_cache[cache_key] = (_now_timestamp(), frame.copy())
        return frame

    def _resolve_metric_value(self, stock_code: str, metric_id: str, end_date: str) -> float | None:
        if metric_id == "asset_liability_ratio":
            return self._resolve_asset_liability_ratio(stock_code, end_date)

        dataset_field = SERIES_METRIC_FIELDS.get(metric_id)
        if dataset_field is None:
            return None

        dataset, field_name = dataset_field
        frame = self._load_series_frame(dataset, stock_code)
        if frame.empty or "end_date" not in frame.columns:
            return None

        matched = frame[frame["end_date"].astype(str) == end_date]
        if matched.empty:
            return None

        raw_value = matched.iloc[0].get(field_name)
        if metric_id in RATIO_METRIC_IDS:
            return self._normalize_ratio(raw_value)
        if metric_id in AMOUNT_METRIC_IDS:
            return self._normalize_amount(raw_value)
        return self._safe_float(raw_value)

    def _resolve_asset_liability_ratio(self, stock_code: str, end_date: str) -> float | None:
        fina_frame = self._load_series_frame("fina_indicator", stock_code)
        if not fina_frame.empty and "end_date" in fina_frame.columns:
            matched = fina_frame[fina_frame["end_date"].astype(str) == end_date]
            if not matched.empty:
                for field_name in ("debt_to_assets", "assets_to_eqt"):
                    if field_name not in matched.columns:
                        continue
                    value = self._normalize_ratio(matched.iloc[0].get(field_name))
                    if value is not None:
                        return value

        balance_frame = self._load_series_frame("balancesheet", stock_code)
        if balance_frame.empty or "end_date" not in balance_frame.columns:
            return None

        matched = balance_frame[balance_frame["end_date"].astype(str) == end_date]
        if matched.empty:
            return None

        total_assets = self._safe_float(matched.iloc[0].get("total_assets"))
        total_liab = self._safe_float(matched.iloc[0].get("total_liab"))
        if total_assets in {None, 0} or total_liab is None:
            return None
        return total_liab / total_assets

    def _frame_to_daily_bars(self, frame: pd.DataFrame, stock_code: str) -> list[DailyBar]:
        if frame.empty:
            return []

        bars: list[DailyBar] = []
        for _, row in frame.sort_values("trade_date").iterrows():
            bars.append(
                DailyBar(
                    stockCode=stock_code,
                    tradeDate=self._format_ymd(row.get("trade_date")),
                    open=self._safe_float(row.get("open")),
                    high=self._safe_float(row.get("high")),
                    low=self._safe_float(row.get("low")),
                    close=self._safe_float(row.get("close")),
                    volume=self._safe_float(row.get("vol")),
                    amount=self._safe_float(row.get("amount")),
                    turnoverRate=self._safe_float(row.get("turnover_rate")),
                )
            )
        return bars

    def _apply_adjustment(self, frame: pd.DataFrame, adjust: str) -> pd.DataFrame:
        adjusted = frame.copy()
        adjusted["adj_factor"] = pd.to_numeric(adjusted["adj_factor"], errors="coerce")
        valid_factors = adjusted["adj_factor"].dropna()
        if valid_factors.empty:
            raise DataUnavailableError(
                "Adjustment factors are unavailable",
                provider=self.provider_name,
            )

        base_factor = float(valid_factors.iloc[-1] if adjust == "qfq" else valid_factors.iloc[0])
        if base_factor == 0:
            raise DataUnavailableError(
                "Adjustment factor baseline is invalid",
                provider=self.provider_name,
            )

        ratio = adjusted["adj_factor"] / base_factor
        for column in ("open", "high", "low", "close"):
            adjusted[column] = pd.to_numeric(adjusted[column], errors="coerce") * ratio
        return adjusted

    def _normalize_market_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty:
            return frame.copy()

        normalized = frame.copy()
        if "trade_date" in normalized.columns:
            normalized["trade_date"] = normalized["trade_date"].astype(str)
            normalized = normalized.sort_values("trade_date")
        if "end_date" in normalized.columns:
            normalized["end_date"] = normalized["end_date"].astype(str)
            normalized = normalized.sort_values("end_date")
        return normalized.reset_index(drop=True)

    def _latest_row(self, frame: pd.DataFrame | None) -> pd.Series:
        normalized = self._ensure_frame(frame)
        if normalized.empty:
            raise DataUnavailableError(
                "TuShare dataset is empty",
                provider=self.provider_name,
            )

        sort_column = next(
            (
                column
                for column in ["trade_date", "month", "quarter", "ann_date", "end_date"]
                if column in normalized.columns
            ),
            None,
        )
        if sort_column:
            return normalized.sort_values(sort_column, ascending=False).iloc[0]
        return normalized.iloc[0]

    def _candidate_trade_dates(
        self,
        as_of_date: str | None,
        *,
        lookback_days: int,
    ) -> list[str]:
        if as_of_date:
            base = datetime.strptime(as_of_date, "%Y-%m-%d")
        else:
            base = datetime.now(UTC).replace(tzinfo=None)
        return [
            (base - timedelta(days=offset)).strftime("%Y%m%d")
            for offset in range(lookback_days + 1)
        ]

    def _normalize_stock_codes(self, stock_codes: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for stock_code in stock_codes:
            code = self._normalize_stock_code(stock_code)
            if code and code not in seen:
                normalized.append(code)
                seen.add(code)
        return normalized

    def _normalize_stock_code_or_raise(self, raw_code: Any) -> str:
        normalized = self._normalize_stock_code(raw_code)
        if not normalized:
            raise InvalidSymbolError(
                f"Invalid stock code: {raw_code}",
                provider=self.provider_name,
            )
        return normalized

    def _normalize_stock_code(self, raw_code: Any) -> str:
        text = str(raw_code or "").strip().upper()
        if "." in text:
            text = text.split(".", 1)[0]
        return text if len(text) == 6 and text.isdigit() else ""

    def _normalize_ymd(self, raw_date: str) -> str:
        return raw_date.replace("-", "")

    def _format_ymd(self, raw_date: Any) -> str:
        text = str(raw_date or "").replace("-", "").strip()
        if len(text) == 8 and text.isdigit():
            return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
        return text

    def _period_to_end_date(self, period: str) -> str:
        if len(period) == 4 and period.isdigit():
            return f"{period}1231"
        if len(period) == 6 and period[:4].isdigit() and period[4] == "Q":
            quarter_map = {"1": "0331", "2": "0630", "3": "0930", "4": "1231"}
            quarter = period[5]
            if quarter in quarter_map:
                return f"{period[:4]}{quarter_map[quarter]}"
        return period.replace("-", "")

    def _normalize_latest_metric(self, metric_id: str, value: Any) -> float | None:
        numeric_value = self._safe_float(value)
        if numeric_value is None:
            return None
        if metric_id == "dv_ttm":
            return self._normalize_ratio(numeric_value)
        if metric_id in {"market_cap", "float_market_cap"}:
            return numeric_value / 10_000
        if metric_id in {"total_shares", "float_a_shares", "free_share"}:
            return numeric_value * 10_000
        return numeric_value

    def _normalize_ratio(self, value: Any) -> float | None:
        numeric_value = self._safe_float(value)
        if numeric_value is None:
            return None
        return numeric_value / 100 if abs(numeric_value) > 1 else numeric_value

    def _normalize_amount(self, value: Any) -> float | None:
        numeric_value = self._safe_float(value)
        if numeric_value is None:
            return None
        return numeric_value / 100_000_000

    def _safe_float(self, value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, float) and math.isnan(value):
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

    def _pick_first_float(self, row: pd.Series, fields: list[str]) -> float | None:
        for field_name in fields:
            if field_name in row:
                value = self._safe_float(row.get(field_name))
                if value is not None:
                    return value
        return None

    def _pick_first_text(self, row: pd.Series, fields: list[str]) -> str | None:
        for field_name in fields:
            if field_name not in row:
                continue
            value = row.get(field_name)
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return None

    def _ensure_frame(self, frame: Any) -> pd.DataFrame:
        if isinstance(frame, pd.DataFrame):
            return frame.copy()
        return pd.DataFrame()

    def _infer_market(self, stock_code: str) -> str:
        if stock_code.startswith("6"):
            return "SH"
        if stock_code.startswith(("4", "8", "920")):
            return "BJ"
        return "SZ"

    def _infer_sector(self, stock_code: str) -> str:
        if stock_code.startswith(("688", "689")):
            return "科创板"
        if stock_code.startswith(("300", "301", "302")):
            return "创业板"
        if stock_code.startswith(("4", "8", "920")):
            return "北交所"
        return "主板"
