"""
股票数据路由
提供股票基础数据、历史数据查询接口
"""

from typing import Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict
from app.services.akshare_adapter import AkShareAdapter

router = APIRouter()


# Pydantic 模型定义
class StockData(BaseModel):
    """股票基础数据模型"""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "code": "600519",
                "name": "贵州茅台",
                "industry": "白酒",
                "sector": "主板",
                "roe": 0.28,
                "pe": 35.5,
                "pb": 10.2,
                "eps": 50.3,
                "revenue": 1275.5,
                "netProfit": 620.8,
                "debtRatio": 0.25,
                "marketCap": 21000.0,
                "floatMarketCap": 20500.0,
                "dataDate": "2024-01-15",
            }
        }
    )

    code: str = Field(..., description="股票代码")
    name: str = Field(..., description="股票名称")
    industry: str = Field(..., description="所属行业")
    sector: str = Field(..., description="所属板块")
    roe: float | None = Field(None, description="净资产收益率")
    pe: float | None = Field(None, description="市盈率")
    pb: float | None = Field(None, description="市净率")
    eps: float | None = Field(None, description="每股收益")
    revenue: float | None = Field(None, description="营业收入（亿元）")
    netProfit: float | None = Field(None, description="净利润（亿元）")
    debtRatio: float | None = Field(None, description="资产负债率")
    marketCap: float | None = Field(None, description="总市值（亿元）")
    floatMarketCap: float | None = Field(None, description="流通市值（亿元）")
    dataDate: str = Field(..., description="数据日期")


class IndicatorDataPoint(BaseModel):
    """指标历史数据点模型"""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "date": "2023-12-31",
                "value": 0.25,
                "isEstimated": False,
            }
        }
    )

    date: str = Field(..., description="数据日期（YYYY-MM-DD）")
    value: float | None = Field(None, description="指标值")
    isEstimated: bool = Field(False, description="是否为预估值")


class BatchStockRequest(BaseModel):
    """批量查询股票请求模型"""

    model_config = ConfigDict(
        json_schema_extra={"example": {"codes": ["600519", "000001", "000002"]}}
    )

    codes: list[str] = Field(..., description="股票代码列表", min_length=1)


class StockCodesResponse(BaseModel):
    """股票代码列表响应模型"""

    codes: list[str] = Field(..., description="股票代码列表")
    total: int = Field(..., description="总数量")


class IndustriesResponse(BaseModel):
    """行业列表响应模型"""

    industries: list[str] = Field(..., description="行业名称列表")
    total: int = Field(..., description="总数量")


# 路由端点
@router.get(
    "/stocks/codes",
    response_model=StockCodesResponse,
    summary="获取全市场股票代码",
    description="获取全市场 A 股股票代码列表",
)
async def get_all_stock_codes():
    """
    获取全市场 A 股股票代码列表

    Returns:
        StockCodesResponse: 包含股票代码列表和总数
    """
    try:
        codes = AkShareAdapter.get_all_stock_codes()
        return StockCodesResponse(codes=codes, total=len(codes))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"获取股票代码列表失败: {str(e)}"
        ) from e


@router.post(
    "/stocks/batch",
    response_model=list[StockData],
    summary="批量查询股票数据",
    description="根据股票代码列表批量查询股票基础数据",
)
async def get_stocks_by_codes(request: BatchStockRequest):
    """
    批量查询股票基础数据

    Args:
        request: 包含股票代码列表的请求体

    Returns:
        list[StockData]: 股票数据列表
    """
    try:
        # 验证代码格式
        for code in request.codes:
            if not _is_valid_stock_code(code):
                raise HTTPException(
                    status_code=400, detail=f"无效的股票代码格式: {code}"
                )

        stocks_data = AkShareAdapter.get_stocks_by_codes(request.codes)

        # 转换为 Pydantic 模型
        return [StockData(**stock) for stock in stocks_data]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"批量查询股票数据失败: {str(e)}"
        ) from e


@router.get(
    "/stocks/{code}/history",
    response_model=list[IndicatorDataPoint],
    summary="查询股票历史指标数据",
    description="查询指定股票的历史财务指标数据",
)
async def get_indicator_history(
    code: str,
    indicator: str = Query(..., description="指标名称（如 ROE, PE, REVENUE）"),
    years: int = Query(3, ge=1, le=10, description="查询年数（1-10）"),
):
    """
    查询股票历史财务指标数据

    Args:
        code: 股票代码
        indicator: 指标名称
        years: 查询年数

    Returns:
        list[IndicatorDataPoint]: 历史数据点列表
    """
    try:
        # 验证股票代码格式
        if not _is_valid_stock_code(code):
            raise HTTPException(status_code=400, detail=f"无效的股票代码格式: {code}")

        # 验证指标名称
        valid_indicators = [
            "ROE",
            "PE",
            "PB",
            "EPS",
            "REVENUE",
            "NET_PROFIT",
            "DEBT_RATIO",
        ]
        if indicator not in valid_indicators:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的指标: {indicator}，支持的指标: {', '.join(valid_indicators)}",
            )

        history_data = AkShareAdapter.get_indicator_history(code, indicator, years)

        # 转换为 Pydantic 模型
        return [IndicatorDataPoint(**point) for point in history_data]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"查询股票 {code} 的 {indicator} 历史数据失败: {str(e)}",
        ) from e


@router.get(
    "/stocks/industries",
    response_model=IndustriesResponse,
    summary="获取行业列表",
    description="获取所有可用的行业分类列表",
)
async def get_available_industries():
    """
    获取可用的行业列表

    Returns:
        IndustriesResponse: 包含行业列表和总数
    """
    try:
        industries = AkShareAdapter.get_available_industries()
        return IndustriesResponse(industries=industries, total=len(industries))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"获取行业列表失败: {str(e)}"
        ) from e


# 辅助函数
def _is_valid_stock_code(code: str) -> bool:
    """
    验证股票代码格式（A 股规范：6 位数字，以 0/3/6 开头）

    Args:
        code: 股票代码

    Returns:
        bool: 是否有效
    """
    if not isinstance(code, str):
        return False

    # 6 位数字
    if not code.isdigit() or len(code) != 6:
        return False

    # 以 0/3/6 开头
    if code[0] not in ["0", "3", "6"]:
        return False

    return True
