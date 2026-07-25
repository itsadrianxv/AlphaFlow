"""Company overview endpoint."""

from fastapi import APIRouter, Request

from app.gateway.common import GatewayError, is_valid_stock_code
from app.gateway.company_overview_gateway import company_overview_gateway

router = APIRouter(prefix="/api/v1/company-overview")


@router.get("/stocks/{stock_code}")
async def get_company_overview(request: Request, stock_code: str):
    if not is_valid_stock_code(stock_code):
        raise GatewayError("invalid_stock_code", f"无效股票代码: {stock_code}", 400, "gateway")
    return company_overview_gateway.get_overview(request_id=request.state.request_id, stock_code=stock_code)
