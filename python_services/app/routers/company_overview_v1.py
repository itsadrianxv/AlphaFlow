"""Company overview endpoint."""

from fastapi import APIRouter, Query, Request

from app.gateway.common import GatewayError, is_valid_stock_code
from app.gateway.company_overview_gateway import company_overview_gateway

router = APIRouter(prefix="/api/v1/company-overview")


@router.get("/stocks/{stock_code}")
async def get_company_overview(request: Request, stock_code: str, metric_ids: list[str] | None = Query(default=None)):
    if not is_valid_stock_code(stock_code):
        raise GatewayError("invalid_stock_code", f"无效股票代码: {stock_code}", 400, "gateway")
    selected = tuple(dict.fromkeys(metric_ids or ()))
    if len(selected) > 30:
        raise GatewayError("too_many_metrics", "公司概况最多选择 30 个财务指标", 400, "gateway")
    return company_overview_gateway.get_overview(
        request_id=request.state.request_id, stock_code=stock_code,
        metric_ids=selected or None,
    )
