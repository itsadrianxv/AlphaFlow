"""
FastAPI application entry point
Provides financial data interfaces using AkShare
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Stock Screening Data Service",
    description="Financial data API powered by AkShare",
    version="0.1.0",
)

# Configure CORS for T3 Stack frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Next.js dev server
        "http://localhost:3001",  # Alternative port
    ],
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


# TODO: Register routers here
# from app.routers import stock_data
# app.include_router(stock_data.router, prefix="/api", tags=["stocks"])
