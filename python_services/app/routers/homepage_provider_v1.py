"""首页数据清单 Provider 内部接口。

该接口只暴露版本化 Provider 请求/结果信封，结算与数据库写入由 C++ worker 完成。
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Header, HTTPException

from app.providers.homepage import (
    DataCutoff,
    HomepageDataItemRequest,
    MinishareHomepageProviderAdapter,
    TushareHomepageProviderAdapter,
)

router = APIRouter(prefix="/api/v1/homepage-provider", tags=["homepage-provider-v1"])


def _require_internal_secret(secret: str | None) -> None:
    expected = os.getenv("ALPHAFLOW_INTERNAL_API_SECRET")
    if expected and secret != expected:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "内部密钥无效"})


@lru_cache(maxsize=3)
def _adapter_for(provider_key: str):
    if provider_key == "minishare":
        return MinishareHomepageProviderAdapter()
    if provider_key == "tushare":
        return TushareHomepageProviderAdapter()
    return TushareHomepageProviderAdapter(datasets={})


@router.post("/fetch")
async def fetch_homepage_provider_item(
    payload: dict[str, Any],
    x_alphaflow_internal_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_internal_secret(x_alphaflow_internal_secret)
    if str(payload.get("contractVersion")) != "1.0":
        raise HTTPException(
            status_code=400,
            detail={"code": "CONTRACT_INCOMPATIBLE", "message": "内部 Provider 请求 contractVersion 仅支持 1.0"},
        )
    request_payload = payload.get("request") or {}
    if not isinstance(request_payload, dict):
        raise HTTPException(status_code=400, detail={"code": "INVALID_REQUEST", "message": "request 必须是对象"})

    request = HomepageDataItemRequest(
        dataset_key=str(request_payload.get("datasetKey") or ""),
        requested_scope=request_payload.get("requestedScope") or {},
        target_data_cutoff=DataCutoff.from_value(request_payload.get("targetDataCutoff")),
        idempotency_key=request_payload.get("idempotencyKey"),
        request_fingerprint=request_payload.get("requestFingerprint"),
        acquisition_attempt_id=request_payload.get("acquisitionAttemptId") or payload.get("attemptId"),
        expected_contract_version=request_payload.get("expectedContractVersion"),
        request_params=request_payload.get("requestParams") or {},
    )
    provider_key = str(request_payload.get("providerKey") or payload.get("providerKey") or "")
    return _adapter_for(provider_key).fetch(request).to_dict()
