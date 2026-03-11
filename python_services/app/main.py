"""FastAPI application entry point for the Python data gateway."""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.contracts.meta import GatewayErrorBody, GatewayErrorResponse
from app.gateway.common import GatewayError, build_meta
from app.infrastructure.logging.request_id import RequestIdMiddleware, create_request_id

app = FastAPI(
    title="Stock Screening Data Service",
    description="Financial data API powered by iFinD with AkShare fallback",
    version="0.1.0",
)

# Configure CORS for T3 Stack frontend
cors_allow_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOW_ORIGINS", "http://localhost:3000,http://localhost:3001"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestIdMiddleware)


@app.exception_handler(GatewayError)
async def handle_gateway_error(request: Request, exc: GatewayError):
    request_id = getattr(request.state, "request_id", create_request_id())
    payload = GatewayErrorResponse(
        meta=build_meta(
            request_id=request_id,
            provider=exc.provider,
            started_at=0,
            cache_hit=False,
            is_stale=False,
            warnings=exc.warnings,
        ),
        error=GatewayErrorBody(code=exc.code, message=exc.message),
    )
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump(mode="json"))


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "Stock Screening Data Service",
        "status": "running",
        "version": "0.1.0",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy"}


# Register routers
from app.routers import admin_jobs, intelligence_data, stock_data
from app.routers import intelligence_v1, market_data, timing_v1

app.include_router(stock_data.router, prefix="/api", tags=["stocks"])
app.include_router(
    intelligence_data.router, prefix="/api", tags=["intelligence"]
)
app.include_router(market_data.router, tags=["market-v1"])
app.include_router(intelligence_v1.router, tags=["intelligence-v1"])
app.include_router(timing_v1.router, tags=["timing-v1"])
app.include_router(admin_jobs.router)
