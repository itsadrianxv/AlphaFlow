"""Unified gateway for external provider-backed capabilities."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from importlib.util import find_spec
import json
import os
from typing import Any, Generic, TypeVar

from app.data_providers import get_default_data_provider
from app.services.firecrawl_capability_client import FirecrawlCapabilityClient
from app.services.screening_periods import resolve_periods
from app.services.screening_query_service import ScreeningQueryService
from app.services.tavily_capability_client import TavilyCapabilityClient
from app.services.zhipu_search_client import ZhipuSearchClient

_T = TypeVar("_T")


@dataclass(frozen=True)
class CapabilityResult(Generic[_T]):
    provider: str
    capability: str
    operation: str
    data: _T
    diagnostics: dict[str, Any] = field(default_factory=dict)
    retryable: bool = False
    failure_phase: str | None = None


class CapabilityError(Exception):
    def __init__(
        self,
        *,
        provider: str,
        capability: str,
        operation: str,
        code: str,
        message: str,
        failure_phase: str,
        diagnostics: dict[str, Any] | None = None,
        retryable: bool = False,
        status_code: int = 500,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.capability = capability
        self.operation = operation
        self.code = code
        self.message = message
        self.failure_phase = failure_phase
        self.diagnostics = diagnostics or {}
        self.retryable = retryable
        self.status_code = status_code


class ExternalCapabilityGateway:
    def __init__(
        self,
        *,
        tavily_client: TavilyCapabilityClient | None = None,
        firecrawl_client: FirecrawlCapabilityClient | None = None,
        zhipu_client: ZhipuSearchClient | None = None,
    ) -> None:
        self._tavily_client = tavily_client or TavilyCapabilityClient()
        self._firecrawl_client = firecrawl_client or FirecrawlCapabilityClient()
        self._zhipu_client = zhipu_client or ZhipuSearchClient()

    def query_screening_dataset(
        self,
        request_id: str,
        payload: dict[str, Any],
    ) -> CapabilityResult[dict[str, Any]]:
        provider_name = "tushare"
        diagnostics = {
            "provider": provider_name,
            "hasToken": bool(os.getenv("TUSHARE_TOKEN", "").strip()),
            "sdkAvailable": find_spec("tushare") is not None,
            "requestFingerprint": _fingerprint(payload),
        }
        try:
            provider = get_default_data_provider()
            provider_name = provider.provider_name
            diagnostics["provider"] = provider_name
            service = ScreeningQueryService(provider=provider)
            data = service.query_dataset(
                stock_codes=list(payload.get("stockCodes", [])),
                indicators=list(payload.get("indicators", [])),
                formulas=list(payload.get("formulas", [])),
                periods=resolve_periods(dict(payload.get("timeConfig", {}))),
            )
            return CapabilityResult(
                provider=provider.provider_name,
                capability="screening",
                operation="query_dataset",
                data=data,
                diagnostics=diagnostics,
            )
        except Exception as exc:  # noqa: BLE001
            raise CapabilityError(
                provider=provider_name,
                capability="screening",
                operation="query_dataset",
                code="tushare_query_failed",
                message=str(exc),
                failure_phase=_classify_screening_failure(str(exc)),
                diagnostics=diagnostics,
                retryable=False,
                status_code=503,
            ) from exc

    def search_web(
        self,
        request_id: str,
        payload: dict[str, Any],
    ) -> CapabilityResult[list[dict[str, Any]]]:
        provider_name, client = self._resolve_web_client()
        diagnostics = {
            **client.diagnostics(),
            "requestFingerprint": _fingerprint(payload),
        }
        try:
            queries = [str(item).strip() for item in payload.get("queries", []) if str(item).strip()]
            limit = int(payload.get("limit", 5))
            results: list[dict[str, Any]] = []
            for query in queries:
                results.extend(client.search(query=query, limit=limit))
            return CapabilityResult(
                provider=provider_name,
                capability="web",
                operation="search",
                data=results,
                diagnostics=diagnostics,
                retryable=True,
            )
        except Exception as exc:  # noqa: BLE001
            raise CapabilityError(
                provider=provider_name,
                capability="web",
                operation="search",
                code=f"{provider_name}_search_failed",
                message=str(exc),
                failure_phase="request",
                diagnostics=diagnostics,
                retryable=True,
                status_code=503,
            ) from exc

    def fetch_web_page(
        self,
        request_id: str,
        payload: dict[str, Any],
    ) -> CapabilityResult[dict[str, Any] | None]:
        provider_name, client = self._resolve_web_client()
        diagnostics = {
            **client.diagnostics(),
            "requestFingerprint": _fingerprint(payload),
        }
        try:
            document = client.fetch(url=str(payload.get("url", "")).strip())
            return CapabilityResult(
                provider=provider_name,
                capability="web",
                operation="fetch",
                data=document,
                diagnostics=diagnostics,
                retryable=True,
            )
        except Exception as exc:  # noqa: BLE001
            raise CapabilityError(
                provider=provider_name,
                capability="web",
                operation="fetch",
                code=f"{provider_name}_fetch_failed",
                message=str(exc),
                failure_phase="request",
                diagnostics=diagnostics,
                retryable=True,
                status_code=503,
            ) from exc

    def match_concepts(
        self,
        request_id: str,
        payload: dict[str, Any],
    ) -> CapabilityResult[list[dict[str, Any]]]:
        diagnostics = {
            "configured": bool(self._zhipu_client.api_key),
            "endpoint": self._zhipu_client.endpoint,
            "model": self._zhipu_client.model,
            "timeoutSeconds": self._zhipu_client.timeout_seconds,
            "requestFingerprint": _fingerprint(payload),
        }
        try:
            matches = self._zhipu_client.search_theme_concepts_strict(
                theme=str(payload.get("theme", "")).strip(),
                limit=int(payload.get("limit", 5)),
            )
            return CapabilityResult(
                provider="zhipu",
                capability="concepts",
                operation="match",
                data=matches,
                diagnostics=diagnostics,
                retryable=True,
            )
        except Exception as exc:  # noqa: BLE001
            raise CapabilityError(
                provider="zhipu",
                capability="concepts",
                operation="match",
                code="zhipu_match_failed",
                message=str(exc),
                failure_phase="request",
                diagnostics=diagnostics,
                retryable=True,
                status_code=503,
            ) from exc

    def _resolve_web_client(self) -> tuple[str, Any]:
        if self._tavily_client.is_configured():
            return ("tavily", self._tavily_client)
        if self._firecrawl_client.is_configured():
            return ("firecrawl", self._firecrawl_client)
        return ("tavily", self._tavily_client)


external_capability_gateway = ExternalCapabilityGateway()


def _fingerprint(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:12]


def _classify_screening_failure(message: str) -> str:
    normalized = message.lower()
    if "tushare_token" in normalized or "token" in normalized:
        return "configuration"
    if "sdk" in normalized or "tushare" in normalized:
        return "runtime_environment"
    return "request"
