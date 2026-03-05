"""
AkShare 数据适配器
封装 AkShare 库调用，提供清晰的接口供 FastAPI 路由使用
"""

from typing import Any
from datetime import datetime
import akshare as ak
import pandas as pd


class AkShareAdapter:
    """AkShare 数据适配器，处理数据转换和错误处理"""

    @staticmethod
    def get_all_stock_codes() -> list[str]:
        """
        获取全市场 A 股股票代码列表
        
        Returns:
            list[str]: 股票代码列表（如 ['000001', '600519']）
        
        Raises:
            Exception: AkShare 调用失败时抛出
        """
        try:
            # 获取沪深 A 股实时行情数据
            df = ak.stock_zh_a_spot_em()
            
            # 提取股票代码列，AkShare 返回的代码格式可能包含市场前缀
            # 需要清理为纯 6 位数字代码
            codes = df["代码"].tolist()
            
            # 过滤并标准化代码格式（确保 6 位数字）
            cleaned_codes = []
            for code in codes:
                # 移除可能的市场前缀（如 'SH', 'SZ'）
                clean_code = str(code).replace("SH", "").replace("SZ", "").strip()
                # 确保是 6 位数字
                if clean_code.isdigit() and len(clean_code) == 6:
                    cleaned_codes.append(clean_code)
            
            return cleaned_codes
        except Exception as e:
            raise Exception(f"获取股票代码列表失败: {str(e)}") from e

    @staticmethod
    def get_stocks_by_codes(codes: list[str]) -> list[dict[str, Any]]:
        """
        批量查询股票基础数据
        
        Args:
            codes: 股票代码列表
        
        Returns:
            list[dict]: 股票数据列表，每个字典包含：
                - code: 股票代码
                - name: 股票名称
                - industry: 所属行业
                - sector: 所属板块
                - roe: 净资产收益率
                - pe: 市盈率
                - pb: 市净率
                - eps: 每股收益
                - revenue: 营业收入（亿元）
                - netProfit: 净利润（亿元）
                - debtRatio: 资产负债率
                - marketCap: 总市值（亿元）
                - floatMarketCap: 流通市值（亿元）
                - dataDate: 数据日期
        
        Raises:
            Exception: AkShare 调用失败时抛出
        """
        try:
            # 获取实时行情数据
            spot_df = ak.stock_zh_a_spot_em()
            
            # 获取个股信息（包含行业等信息）
            # 注意：AkShare 的个股信息接口可能需要逐个查询，这里先用实时行情数据
            
            results = []
            for code in codes:
                # 在实时行情中查找该股票
                stock_data = spot_df[spot_df["代码"] == code]
                
                if stock_data.empty:
                    continue
                
                row = stock_data.iloc[0]
                
                # 构建返回数据（部分字段可能需要额外接口获取）
                stock_info = {
                    "code": code,
                    "name": row.get("名称", ""),
                    "industry": row.get("行业", "未知"),  # 实时行情可能不包含行业
                    "sector": row.get("板块", "主板"),
                    "roe": _safe_float(row.get("ROE", None)),
                    "pe": _safe_float(row.get("市盈率-动态", None)),
                    "pb": _safe_float(row.get("市净率", None)),
                    "eps": None,  # 需要从财务数据获取
                    "revenue": None,  # 需要从财务数据获取
                    "netProfit": None,  # 需要从财务数据获取
                    "debtRatio": None,  # 需要从财务数据获取
                    "marketCap": _safe_float(row.get("总市值", None)),
                    "floatMarketCap": _safe_float(row.get("流通市值", None)),
                    "dataDate": datetime.now().strftime("%Y-%m-%d"),
                }
                
                results.append(stock_info)
            
            return results
        except Exception as e:
            raise Exception(f"批量查询股票数据失败: {str(e)}") from e

    @staticmethod
    def get_indicator_history(
        code: str, indicator: str, years: int
    ) -> list[dict[str, Any]]:
        """
        查询股票历史财务指标数据
        
        Args:
            code: 股票代码
            indicator: 指标名称（如 'ROE', 'PE', 'REVENUE'）
            years: 查询年数
        
        Returns:
            list[dict]: 历史数据点列表，每个字典包含：
                - date: 数据日期（YYYY-MM-DD）
                - value: 指标值
                - isEstimated: 是否为预估值
        
        Raises:
            Exception: AkShare 调用失败时抛出
        """
        try:
            # 根据指标类型选择合适的 AkShare 接口
            # 这里使用财务指标接口
            
            # 获取财务指标数据（以 ROE 为例）
            # 注意：不同指标可能需要不同的接口
            indicator_map = {
                "ROE": "净资产收益率",
                "PE": "市盈率",
                "PB": "市净率",
                "EPS": "每股收益",
                "REVENUE": "营业收入",
                "NET_PROFIT": "净利润",
                "DEBT_RATIO": "资产负债率",
            }
            
            # 获取财务数据
            # 使用个股财务指标接口
            df = ak.stock_financial_analysis_indicator(symbol=code)
            
            if df.empty:
                return []
            
            # 限制年数
            df = df.head(years * 4)  # 假设季度数据，4 个季度 = 1 年
            
            results = []
            for _, row in df.iterrows():
                # 根据指标名称提取对应值
                akshare_indicator = indicator_map.get(indicator, indicator)
                value = row.get(akshare_indicator, None)
                
                data_point = {
                    "date": str(row.get("日期", "")),
                    "value": _safe_float(value),
                    "isEstimated": False,  # AkShare 通常提供实际数据
                }
                
                results.append(data_point)
            
            return results
        except Exception as e:
            raise Exception(
                f"查询股票 {code} 的 {indicator} 历史数据失败: {str(e)}"
            ) from e

    @staticmethod
    def get_available_industries() -> list[str]:
        """
        获取可用的行业列表
        
        Returns:
            list[str]: 行业名称列表
        
        Raises:
            Exception: AkShare 调用失败时抛出
        """
        try:
            # 获取行业板块数据
            df = ak.stock_board_industry_name_em()
            
            # 提取行业名称
            industries = df["板块名称"].tolist()
            
            return industries
        except Exception as e:
            raise Exception(f"获取行业列表失败: {str(e)}") from e


def _safe_float(value: Any) -> float | None:
    """
    安全地将值转换为 float，失败时返回 None
    
    Args:
        value: 待转换的值
    
    Returns:
        float | None: 转换后的浮点数或 None
    """
    if value is None or pd.isna(value):
        return None
    
    try:
        # 处理百分比字符串（如 "15.5%"）
        if isinstance(value, str):
            value = value.replace("%", "").strip()
        
        return float(value)
    except (ValueError, TypeError):
        return None
