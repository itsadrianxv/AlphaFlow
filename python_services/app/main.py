"""
FastAPI application entry point
Provides financial data interfaces using AkShare
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Stock Screening Data Service",
    description="Financial data API powered by AkShare",
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
from app.routers import intelligence_data, stock_data

app.include_router(stock_data.router, prefix="/api", tags=["stocks"])
app.include_router(
    intelligence_data.router, prefix="/api", tags=["intelligence"]
)
