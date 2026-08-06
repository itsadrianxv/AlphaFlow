"""TuShare、Minishare 与测试替身的统一首页 Provider adapter。

适配器负责外部调用、分页、字段规范化和来源权威选择；结算、数据库写入与
Worker 生命周期不属于本模块。所有路径最终都通过同一个 ``fetch`` 实现，
因此成功、空结果、降级、错误、幂等和重放语义不会因来源不同而漂移。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
import inspect
from typing import Any, Iterable, Mapping, Protocol, Sequence

from .contracts import (
    AuthoritySelection,
    CANONICALIZATION_VERSION,
    CONTRACT_VERSION,
    DataCutoff,
    HomepageDataItemRequest,
    HomepageDataItemResult,
    NormalizedObservation,
    NORMALIZATION_RULES_VERSION,
    ProviderError,
    QualityStatus,
    ReplayContext,
    ReplayMode,
    ResultStatus,
    Retryability,
    ScopeCoverage,
    SourceAssertion,
    normalize_decimal,
    sha256_hash,
)
from .radar_history import build_radar_history
from app.providers.minishare.news import MinishareNewsProvider


class ProviderAdapterException(RuntimeError):
    """供 adapter 将外部异常映射为稳定错误语义。"""

    def __init__(
        self,
        message: str,
        *,
        error_class: str = "upstream_unavailable",
        retryability: Retryability = Retryability.RETRYABLE,
        code: str | None = None,
        provider_code: str | None = None,
        retry_after_seconds: int | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_class = error_class
        self.retryability = retryability
        self.code = code
        self.provider_code = provider_code
        self.retry_after_seconds = retry_after_seconds
        self.details = dict(details or {})

    def to_error(self) -> ProviderError:
        return ProviderError(
            error_class=self.error_class,
            retryability=self.retryability,
            message=str(self),
            code=self.code,
            provider_code=self.provider_code,
            occurred_at=datetime.now(UTC),
            retry_after_seconds=self.retry_after_seconds,
            details=self.details,
        )


@dataclass(frozen=True, slots=True)
class DatasetCapability:
    dataset_key: str
    dataset_payload_version: str = "1.0"
    description: str = ""
    supports_pagination: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "datasetKey": self.dataset_key,
            "datasetPayloadVersion": self.dataset_payload_version,
            "description": self.description,
            "supportsPagination": self.supports_pagination,
        }


@dataclass(frozen=True, slots=True)
class AdapterPage:
    """一个 Provider 页面；``items`` 可以是供应商行或已规范化观测。"""

    items: tuple[Any, ...] = ()
    next_cursor: str | None = None
    covered_scope: Mapping[str, Any] | None = None
    missing_scope: Mapping[str, Any] | None = None
    actual_data_cutoff: DataCutoff | None = None
    upstream_as_of: datetime | None = None
    source_published_at: datetime | None = None
    terminal_error: ProviderError | None = None
    prebuilt_result: HomepageDataItemResult | None = None

    @classmethod
    def from_value(cls, value: Any) -> "AdapterPage":
        if isinstance(value, cls):
            return value
        if value is None:
            raise ProviderAdapterException("Provider 未返回页面结果", error_class="invalid_response", retryability=Retryability.NON_RETRYABLE)
        if isinstance(value, HomepageDataItemResult):
            return cls(
                prebuilt_result=value,
                items=(),
                covered_scope=value.covered_scope,
                missing_scope=value.missing_scope,
                actual_data_cutoff=value.actual_data_cutoff,
                upstream_as_of=value.upstream_as_of,
                source_published_at=value.source_published_at,
                terminal_error=value.errors[0] if value.errors else None,
            )
        if isinstance(value, Mapping):
            page_keys = {"items", "records", "nextCursor", "next_cursor", "coveredScope", "covered_scope", "missingScope", "missing_scope", "actualDataCutoff", "actual_data_cutoff", "terminalError", "error"}
            if not page_keys.intersection(value):
                return cls(items=(value,))
            raw_items = value.get("items") or value.get("records") or value.get("data") or ()
            if isinstance(raw_items, Mapping):
                raw_items = [raw_items]
            return cls(
                items=tuple(raw_items or ()),
                next_cursor=value.get("nextCursor") or value.get("next_cursor") or value.get("cursor"),
                covered_scope=value.get("coveredScope") or value.get("covered_scope"),
                missing_scope=value.get("missingScope") or value.get("missing_scope"),
                actual_data_cutoff=DataCutoff.from_value(value.get("actualDataCutoff") or value.get("actual_data_cutoff")),
                upstream_as_of=_parse_datetime(value.get("upstreamAsOf") or value.get("upstream_as_of")),
                source_published_at=_parse_datetime(value.get("sourcePublishedAt") or value.get("source_published_at")),
                terminal_error=_coerce_error(value.get("error") or value.get("terminalError")),
            )
        if isinstance(value, (str, bytes)):
            raise ProviderAdapterException("Provider 页面不是记录集合", error_class="invalid_response", retryability=Retryability.NON_RETRYABLE)
        try:
            return cls(items=tuple(value or ()))
        except TypeError as exc:
            raise ProviderAdapterException("Provider 页面无法解析", error_class="invalid_response", retryability=Retryability.NON_RETRYABLE) from exc


class PageLoader(Protocol):
    def __call__(self, request: HomepageDataItemRequest, cursor: str | None) -> Any:
        ...


def _parse_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError as exc:
            raise ProviderAdapterException("Provider 返回非法时间", error_class="invalid_response", retryability=Retryability.NON_RETRYABLE) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _coerce_error(value: Any) -> ProviderError | None:
    if value is None:
        return None
    if isinstance(value, ProviderError):
        return value
    if isinstance(value, ProviderAdapterException):
        return value.to_error()
    if isinstance(value, Mapping):
        retryability = value.get("retryability") or Retryability.NON_RETRYABLE
        return ProviderError(
            error_class=str(value.get("errorClass") or value.get("error_class") or "upstream_unavailable"),
            retryability=retryability,
            message=str(value.get("message") or value.get("error") or "Provider 页面错误"),
            code=value.get("code"),
            provider_code=value.get("providerCode") or value.get("provider_code"),
            occurred_at=_parse_datetime(value.get("occurredAt") or value.get("occurred_at")),
            retry_after_seconds=value.get("retryAfterSeconds") or value.get("retry_after_seconds"),
            details=value.get("details") or {},
        )
    return ProviderError(
        error_class="upstream_unavailable",
        retryability=Retryability.RETRYABLE,
        message=str(value),
    )


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return {str(key): nested for key, nested in value.items()}
    if hasattr(value, "to_dict") and callable(value.to_dict):
        result = value.to_dict()
        if isinstance(result, Mapping):
            return {str(key): nested for key, nested in result.items()}
    if is_dataclass(value):
        return {str(key): nested for key, nested in asdict(value).items()}  # type: ignore[arg-type]
    if hasattr(value, "__dict__"):
        return {str(key): nested for key, nested in vars(value).items() if not key.startswith("_")}
    raise ProviderAdapterException("Provider 记录不是对象", error_class="invalid_response", retryability=Retryability.NON_RETRYABLE)


def _first(record: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in record and record[key] is not None and record[key] != "":
            return record[key]
    return None


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _source_record_key(record: Mapping[str, Any], *, index: int) -> str:
    value = _first(record, "sourceRecordKey", "source_record_key", "sourceItemId", "source_item_id", "id", "ts_code", "tsCode", "code")
    if value is not None:
        return _text(value)
    return sha256_hash({"record": record, "index": index})


def _identity_key(record: Mapping[str, Any], *, dataset_key: str, source_record_key: str) -> str:
    explicit = _first(record, "identityKey", "identity_key")
    if explicit:
        return _text(explicit)
    subject_type = _text(_first(record, "subjectType", "subject_type", "entityType", "entity_type") or "dataset")
    subject_key = _text(_first(record, "subjectKey", "subject_key", "stockCode", "stock_code", "ts_code", "code", "id") or source_record_key)
    metric = _text(_first(record, "metricCatalogId", "metric_catalog_id", "metricId", "metric_id") or dataset_key)
    dimensions = _first(record, "dimensions", "dimensionsJson", "dimensions_json") or {}
    period = _first(record, "observationPeriod", "observation_period", "tradeDate", "trade_date", "date", "period")
    return f"{CANONICALIZATION_VERSION}:{sha256_hash({'datasetKey': dataset_key, 'subjectType': subject_type, 'subjectKey': subject_key, 'metricCatalogId': metric, 'dimensions': dimensions, 'period': period})[7:]}"


def _observation_from_record(record: Mapping[str, Any], *, dataset_key: str, source_record_key: str, quality_status: QualityStatus) -> NormalizedObservation:
    explicit = _first(record, "observation", "normalizedObservation", "normalized_observation")
    if isinstance(explicit, NormalizedObservation):
        return explicit
    if isinstance(explicit, Mapping):
        return NormalizedObservation.from_dict(explicit)

    subject_type = _text(_first(record, "subjectType", "subject_type", "entityType", "entity_type") or "dataset")
    subject_key = _text(_first(record, "subjectKey", "subject_key", "stockCode", "stock_code", "ts_code", "code", "id") or source_record_key)
    metric = _text(_first(record, "metricCatalogId", "metric_catalog_id", "metricId", "metric_id") or dataset_key)
    identity = _identity_key(record, dataset_key=dataset_key, source_record_key=source_record_key)
    dimensions = _first(record, "dimensions", "dimensionsJson", "dimensions_json") or {}
    period = _first(record, "observationPeriod", "observation_period")
    if period is None:
        period = {
            key: record[key]
            for key in ("tradeDate", "trade_date", "date", "period", "periodStart", "periodEnd")
            if key in record and record[key] not in (None, "")
        }
    value = _first(record, "valueText", "value_text")
    value_json = _first(record, "valueJson", "value_json")
    if value is None and value_json is None:
        value = _first(record, "value", "amount", "close", "current", "content", "title")
    value_type = _text(_first(record, "valueType", "value_type") or ("decimal" if isinstance(value, (int, float, Decimal)) else "json"))
    missing_reason = _first(record, "missingReason", "missing_reason")
    if value is None and value_json is None and not missing_reason:
        # 目录/主体类数据没有单一数值，整个规范化字段集作为 JSON payload 保留。
        value_json = dict(record)
        value_type = "json"
    if value is not None and value_type in {"decimal", "number", "numeric"}:
        value = normalize_decimal(value)
        value_type = "decimal"
    elif value is None and value_json is not None and value_type in {"decimal", "number", "numeric"}:
        value = normalize_decimal(value_json)
        value_json = None
        value_type = "decimal"
    elif value is not None and not isinstance(value, str) and value_json is None:
        value_json = value
        value = None
    return NormalizedObservation(
        identity_key=identity,
        canonicalization_version=_text(_first(record, "canonicalizationVersion", "canonicalization_version") or CANONICALIZATION_VERSION),
        subject_type=subject_type,
        subject_key=subject_key,
        metric_catalog_id=metric,
        dimensions=dimensions if isinstance(dimensions, Mapping) else {"value": dimensions},
        observation_kind=_text(_first(record, "observationKind", "observation_kind") or "point"),
        observation_period=period if isinstance(period, Mapping) else {"value": period},
        value_type=value_type,
        value_text=_text(value) if value is not None and isinstance(value, str) else value,
        value_json=value_json,
        unit=_first(record, "unit", "normalizedUnit"),
        precision=_first(record, "precision"),
        missing_reason=_text(missing_reason) or None,
        quality_status=quality_status,
    )


class HomepageProviderAdapter:
    """所有首页 Provider adapter 共享的分页、幂等和结果构造实现。"""

    provider_key = "provider"
    provider_version = "1.0"
    contract_version = CONTRACT_VERSION
    normalization_rules_version = NORMALIZATION_RULES_VERSION

    def __init__(
        self,
        *,
        capabilities: Mapping[str, DatasetCapability | Mapping[str, Any] | str],
        page_loaders: Mapping[str, PageLoader] | None = None,
        authority_config: Mapping[str, Mapping[str, Any]] | None = None,
    ) -> None:
        self._capabilities = {key: _capability(key, value) for key, value in capabilities.items()}
        self._page_loaders = dict(page_loaders or {})
        self._authority_config = {key: dict(value) for key, value in (authority_config or {}).items()}
        self._result_cache: dict[str, tuple[str, HomepageDataItemResult]] = {}

    def supported_datasets(self) -> tuple[str, ...]:
        return tuple(sorted(self._capabilities))

    def dataset_capabilities(self) -> tuple[DatasetCapability, ...]:
        return tuple(self._capabilities[key] for key in sorted(self._capabilities))

    def get_dataset_capabilities(self) -> tuple[DatasetCapability, ...]:
        return self.dataset_capabilities()

    def supports_dataset(self, dataset_key: str) -> bool:
        return dataset_key in self._capabilities

    def fetch_page(self, request: HomepageDataItemRequest, cursor: str | None = None) -> AdapterPage:
        loader = self._page_loaders.get(request.dataset_key)
        if loader is None:
            raise ProviderAdapterException(
                f"Provider 未注册数据集: {request.dataset_key}",
                error_class="unsupported_dataset",
                retryability=Retryability.NON_RETRYABLE,
            )
        try:
            value = loader(request, cursor)
            if inspect.isawaitable(value):
                raise ProviderAdapterException("异步 Provider loader 必须在 adapter 外完成", error_class="invalid_response", retryability=Retryability.NON_RETRYABLE)
            return AdapterPage.from_value(value)
        except ProviderAdapterException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise _map_external_exception(exc) from exc

    def fetch(self, request: HomepageDataItemRequest | str, **kwargs: Any) -> HomepageDataItemResult:
        if isinstance(request, str):
            request = HomepageDataItemRequest(dataset_key=request, **kwargs)
        cached = self._result_cache.get(request.idempotency_key or "")
        if cached is not None:
            previous_fingerprint, previous_result = cached
            if previous_fingerprint == request.request_fingerprint:
                return previous_result
            result = HomepageDataItemResult.error_result(
                request=request,
                provider_key=self.provider_key,
                error=ProviderError(
                    error_class="duplicate_response",
                    retryability=Retryability.NON_RETRYABLE,
                    message="同一 idempotencyKey 对应了不同 requestFingerprint",
                    code="IDEMPOTENCY_KEY_REUSED",
                    details={"existingRequestFingerprint": previous_fingerprint, "requestFingerprint": request.request_fingerprint},
                ),
                provider_version=self.provider_version,
                normalization_rules_version=self.normalization_rules_version,
            )
            return result

        if request.replay_mode == ReplayMode.REPLAY:
            result = HomepageDataItemResult.error_result(
                request=request,
                provider_key=self.provider_key,
                error=ProviderError(
                    error_class="replay_unavailable",
                    retryability=Retryability.NON_RETRYABLE,
                    message="没有可重放的同一 idempotencyKey 结果",
                    code="REPLAY_NOT_FOUND",
                ),
                provider_version=self.provider_version,
                normalization_rules_version=self.normalization_rules_version,
            )
            return result

        if not self.supports_dataset(request.dataset_key):
            result = HomepageDataItemResult.error_result(
                request=request,
                provider_key=self.provider_key,
                error=ProviderError(
                    error_class="unsupported_dataset",
                    retryability=Retryability.NON_RETRYABLE,
                    message=f"Provider 不支持数据集 {request.dataset_key}",
                    code="UNSUPPORTED_DATASET",
                    details={"supportedDatasets": list(self.supported_datasets())},
                ),
                provider_version=self.provider_version,
                normalization_rules_version=self.normalization_rules_version,
            )
            self._result_cache[request.idempotency_key or ""] = (request.request_fingerprint or "", result)
            return result

        if request.expected_contract_version and not _compatible_major(request.expected_contract_version, self.contract_version):
            result = HomepageDataItemResult.error_result(
                request=request,
                provider_key=self.provider_key,
                error=ProviderError(
                    error_class="contract_incompatible",
                    retryability=Retryability.NON_RETRYABLE,
                    message=f"不支持 Provider contract 主版本 {request.expected_contract_version}",
                    code="CONTRACT_INCOMPATIBLE",
                    details={"supportedContractVersion": self.contract_version, "requestedContractVersion": request.expected_contract_version},
                ),
                provider_version=self.provider_version,
                normalization_rules_version=self.normalization_rules_version,
            )
            self._result_cache[request.idempotency_key or ""] = (request.request_fingerprint or "", result)
            return result

        pages: list[AdapterPage] = []
        errors: list[ProviderError] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        pagination_exhausted = False
        for _page_no in range(request.max_pages):
            try:
                page = self.fetch_page(request, cursor)
            except ProviderAdapterException as exc:
                errors.append(exc.to_error())
                break
            pages.append(page)
            if page.prebuilt_result is not None:
                result = page.prebuilt_result
                if result.dataset_key != request.dataset_key or result.provider_key != self.provider_key:
                    result = HomepageDataItemResult.error_result(
                        request=request,
                        provider_key=self.provider_key,
                        error=ProviderError(
                            error_class="contract_incompatible",
                            retryability=Retryability.NON_RETRYABLE,
                            message="脚本结果的 datasetKey/providerKey 与请求不一致",
                            code="PREBUILT_RESULT_IDENTITY_MISMATCH",
                        ),
                        provider_version=self.provider_version,
                        normalization_rules_version=self.normalization_rules_version,
                    )
                self._result_cache[request.idempotency_key or ""] = (request.request_fingerprint or "", result)
                return result
            if page.terminal_error:
                errors.append(page.terminal_error)
                break
            if page.next_cursor is None:
                pagination_exhausted = True
                break
            if page.next_cursor in seen_cursors or page.next_cursor == cursor:
                errors.append(ProviderError(
                    error_class="pagination_terminated",
                    retryability=Retryability.RETRYABLE,
                    message="Provider 返回重复分页游标，分页被安全终止",
                    code="PAGINATION_CURSOR_REPEATED",
                    details={"cursor": page.next_cursor},
                ))
                break
            seen_cursors.add(page.next_cursor)
            cursor = page.next_cursor
        else:
            errors.append(ProviderError(
                error_class="pagination_terminated",
                retryability=Retryability.RETRYABLE,
                message=f"分页超过 max_pages={request.max_pages}，已终止继续读取",
                code="PAGINATION_MAX_PAGES",
                details={"maxPages": request.max_pages, "nextCursor": cursor},
            ))

        raw_items = [item for page in pages for item in page.items]
        observations: list[NormalizedObservation] = []
        assertions: list[SourceAssertion] = []
        seen_assertions: dict[str, str] = {}
        seen_observations: set[str] = set()
        quality = QualityStatus.NORMAL
        for index, item in enumerate(raw_items):
            if isinstance(item, NormalizedObservation):
                observation = item
                record = {"identityKey": observation.identity_key, "valueJson": observation.value_json, "valueText": observation.value_text}
            else:
                try:
                    record = _mapping(item)
                    source_record_key = _source_record_key(record, index=index)
                    content_hash = sha256_hash(record)
                    previous_content = seen_assertions.get(source_record_key)
                    if previous_content is not None:
                        if previous_content != content_hash:
                            errors.append(ProviderError(
                                error_class="duplicate_response",
                                retryability=Retryability.NON_RETRYABLE,
                                message=f"同一来源记录 {source_record_key} 返回了不同内容",
                                code="DUPLICATE_RECORD_CONFLICT",
                                details={"sourceRecordKey": source_record_key},
                            ))
                        continue
                    seen_assertions[source_record_key] = content_hash
                    observation = _observation_from_record(record, dataset_key=request.dataset_key, source_record_key=source_record_key, quality_status=quality)
                except ProviderAdapterException as exc:
                    errors.append(exc.to_error())
                    continue
                except ValueError as exc:
                    errors.append(ProviderError(error_class="normalization_failed", retryability=Retryability.NON_RETRYABLE, message=str(exc), code="NORMALIZATION_FAILED"))
                    continue
            if observation.identity_key not in seen_observations:
                observations.append(observation)
                seen_observations.add(observation.identity_key)
            if not isinstance(item, NormalizedObservation):
                source_record_key = _source_record_key(record, index=index)
                assertion = SourceAssertion(
                    assertion_key=f"{self.provider_key}:{request.dataset_key}:{source_record_key}:{seen_assertions[source_record_key] if source_record_key in seen_assertions else sha256_hash(record)}",
                    canonicalization_version=CANONICALIZATION_VERSION,
                    source_key=self.provider_key,
                    dataset_key=request.dataset_key,
                    source_record_key=source_record_key,
                    observation_identity_key=observation.identity_key,
                    raw_record=record,
                    content_hash=seen_assertions.get(source_record_key) or sha256_hash(record),
                    request_params_hash=sha256_hash(request.request_params),
                    provider_version=self.provider_version,
                    upstream_as_of=_first_page_value(pages, "upstream_as_of") or _record_time(record, "upstreamAsOf", "upstream_as_of", "asOf", "as_of"),
                    source_published_at=_first_page_value(pages, "source_published_at") or _record_time(record, "sourcePublishedAt", "source_published_at", "publishedAt", "published_at", "pub_time"),
                    fetched_at=datetime.now(UTC),
                )
                if assertion.assertion_key not in {current.assertion_key for current in assertions}:
                    assertions.append(assertion)

        covered_scope = _merge_scope([page.covered_scope for page in pages], fallback=request.requested_scope if pagination_exhausted and not errors else {})
        missing_scope = _merge_scope([page.missing_scope for page in pages])
        actual_cutoff = _latest_cutoff([page.actual_data_cutoff for page in pages]) or _infer_cutoff(raw_items, request)
        target_reached = _cutoff_reached(actual_cutoff, request.target_data_cutoff)
        if not target_reached and request.target_data_cutoff is not None:
            missing_scope = {**missing_scope, "dataCutoff": request.target_data_cutoff.to_dict()}
        if not covered_scope and observations and not errors:
            covered_scope = dict(request.requested_scope)
        coverage = ScopeCoverage(
            requested_scope=request.requested_scope,
            covered_scope=covered_scope,
            missing_scope=missing_scope,
        )
        if not observations and not errors and actual_cutoff is None:
            errors.append(ProviderError(
                error_class="invalid_response",
                retryability=Retryability.NON_RETRYABLE,
                message="合法 empty 结果必须保留请求范围已覆盖证明和实际数据截止点",
                code="EMPTY_RESULT_MISSING_CUTOFF",
            ))
        if not observations and not errors and not target_reached and request.target_data_cutoff is not None:
            errors.append(ProviderError(
                error_class="coverage_incomplete",
                retryability=Retryability.RETRYABLE,
                message="Provider 未返回达到目标数据截止点的可用观测",
                code="TARGET_CUTOFF_NOT_REACHED",
                details={"targetDataCutoff": request.target_data_cutoff.to_dict()},
            ))
        if errors and not observations:
            result_status = ResultStatus.ERROR
            quality = QualityStatus.ISOLATED if all(item.error_class in {"unsupported_dataset", "contract_incompatible", "normalization_failed", "invalid_response", "replay_unavailable"} for item in errors) else QualityStatus.DEGRADED
        elif not observations:
            result_status = ResultStatus.EMPTY if not errors and target_reached else ResultStatus.DEGRADED
            quality = QualityStatus.NORMAL if result_status == ResultStatus.EMPTY else QualityStatus.DEGRADED
        elif errors or missing_scope or not target_reached:
            result_status = ResultStatus.DEGRADED
            quality = QualityStatus.DEGRADED
        else:
            result_status = ResultStatus.SUCCESS
            quality = QualityStatus.NORMAL

        source_hashes = tuple(sorted({assertion.content_hash for assertion in assertions}))
        replay = ReplayContext(
            acquisition_attempt_id=request.acquisition_attempt_id or "attempt",
            idempotency_key=request.idempotency_key or "idempotency",
            request_fingerprint=request.request_fingerprint or "fingerprint",
            provider_version=self.provider_version,
            normalization_rules_version=self.normalization_rules_version,
            source_content_hashes=source_hashes,
            mode=request.replay_mode,
        )
        authority = self._select_authority(request.dataset_key, assertions)
        result = HomepageDataItemResult(
            dataset_key=request.dataset_key,
            provider_key=self.provider_key,
            provider_version=self.provider_version,
            result_status=result_status,
            quality_status=quality,
            coverage=coverage,
            observations=tuple(observations),
            source_assertions=tuple(assertions),
            actual_data_cutoff=actual_cutoff,
            contract_version=self.contract_version,
            dataset_payload_version=self._capabilities[request.dataset_key].dataset_payload_version,
            normalization_rules_version=self.normalization_rules_version,
            errors=tuple(errors),
            authority=authority,
            observation_period=_collect_observation_period(observations),
            upstream_as_of=_first_page_value(pages, "upstream_as_of") or _latest_assertion_time(assertions, "upstream_as_of"),
            source_published_at=_first_page_value(pages, "source_published_at") or _latest_assertion_time(assertions, "source_published_at"),
            replay=replay,
        )
        self._result_cache[request.idempotency_key or ""] = (request.request_fingerprint or "", result)
        return result

    def _select_authority(self, dataset_key: str, assertions: Sequence[SourceAssertion]) -> AuthoritySelection | None:
        if not assertions:
            return None
        config = self._authority_config.get(dataset_key, {})
        preferred = _text(config.get("selectedSourceKey") or config.get("selected_source_key") or self.provider_key)
        available = {assertion.source_key for assertion in assertions}
        selected = preferred if preferred in available else assertions[0].source_key
        fallback_reason = None if selected == preferred else _text(config.get("fallbackReason") or "配置的主来源未提供结果，使用已声明回退来源")
        return AuthoritySelection(
            strategy_version=_text(config.get("strategyVersion") or config.get("strategy_version") or "authority-1"),
            selected_source_key=selected,
            corroborating_source_keys=tuple(sorted(available - {selected})),
            selection_reason=_text(config.get("selectionReason") or "按来源×数据集权威配置选择"),
            fallback_reason=fallback_reason or None,
        )


class TushareHomepageProviderAdapter(HomepageProviderAdapter):
    """把既有 TuShare client 映射为首页 Provider contract。"""

    provider_key = "tushare"

    def __init__(self, client: Any | None = None, *, datasets: Mapping[str, PageLoader] | None = None, authority_config: Mapping[str, Mapping[str, Any]] | None = None) -> None:
        if client is None:
            from app.providers.tushare.client import TushareProviderClient

            client = TushareProviderClient()
        client = client  # type: Any
        loaders: dict[str, PageLoader] = {
            "market_snapshot": lambda request, _cursor: client.get_market_snapshot(_scope_date(request)),
            "stock_universe": lambda _request, _cursor: client.get_stock_universe(),
            "stock_snapshot": lambda request, _cursor: client.get_stock_snapshot(str(request.requested_scope.get("stockCode") or request.requested_scope.get("stock_code") or "")),
            "stock_batch": lambda request, _cursor: client.get_stock_batch([str(item) for item in request.requested_scope.get("stockCodes", request.requested_scope.get("stock_codes", ())) ]),
            "daily_bars": lambda request, _cursor: _bars_as_records(client.get_stock_bars(stock_code=str(request.requested_scope.get("stockCode") or request.requested_scope.get("stock_code") or ""), start_date=request.requested_scope.get("startDate") or request.requested_scope.get("start_date"), end_date=request.requested_scope.get("endDate") or request.requested_scope.get("end_date"), adjust=str(request.requested_scope.get("adjust") or "qfq"))),
            "concept_catalog": lambda _request, _cursor: client.get_concept_catalog(),
            "concept_constituents": lambda request, _cursor: client.get_concept_constituents(str(request.requested_scope.get("conceptName") or request.requested_scope.get("concept_name") or ""), request.requested_scope.get("conceptCode") or request.requested_scope.get("concept_code")),
            "hot_concept_boards": lambda request, _cursor: client.get_hot_concept_boards(limit=request.page_size),
            "market_heatmap": lambda request, _cursor: _dated_page(request, client.get_market_heatmap_snapshot(limit=request.page_size, prefer_intraday=bool(request.requested_scope.get("preferIntraday", request.requested_scope.get("prefer_intraday", False))))),
            "market_money_flow": lambda request, _cursor: _dated_page(request, client.get_market_money_flow(_scope_date(request))),
            "company_actions": lambda request, _cursor: _dated_page(request, client.get_company_actions(_scope_date(request))),
            "expectation_changes": lambda request, _cursor: _dated_page(request, client.get_expectation_changes(_scope_date(request))),
            "event_calendar": lambda request, _cursor: _dated_page(request, client.get_event_calendar(_scope_date(request))),
        }
        loaders.update(datasets or {})
        capabilities = {key: DatasetCapability(key, description=f"TuShare {key} 规范化数据集") for key in loaders}
        super().__init__(capabilities=capabilities, page_loaders=loaders, authority_config=authority_config)


class MinishareHomepageProviderAdapter(HomepageProviderAdapter):
    """把 Minishare 三类新闻接口映射为同一首页 Provider contract。"""

    provider_key = "minishare"

    def __init__(self, client: Any | None = None, *, datasets: Mapping[str, PageLoader] | None = None, authority_config: Mapping[str, Mapping[str, Any]] | None = None, radar_provider: Any | None = None) -> None:
        if client is None:
            from app.providers.minishare.client import MinishareNewsClient

            client = MinishareNewsClient()
        radar_provider = radar_provider or MinishareNewsProvider(client=client)
        history_cache: dict[str, dict[str, Any]] = {}

        def window(request: HomepageDataItemRequest) -> tuple[datetime, datetime]:
            start = _parse_datetime(request.requested_scope.get("startAt") or request.requested_scope.get("start_at"))
            end = _parse_datetime(request.requested_scope.get("endAt") or request.requested_scope.get("end_at"))
            if end is None:
                end = datetime.now(UTC)
            if start is None:
                start = end.replace(hour=0, minute=0, second=0, microsecond=0)
            return start, end

        def fast_loader(request: HomepageDataItemRequest, cursor: str | None) -> AdapterPage:
            offset = int(cursor or request.requested_scope.get("offset") or 0)
            records = client.fetch_fast_news(*window(request), limit=request.page_size, offset=offset)
            # Minishare 没有单独的 total 字段；返回满页时继续请求下一页，
            # 下一次空页即表示已正常终止，而不是静默截断。
            return _news_page(request, records, next_cursor=str(offset + len(records)) if len(records) >= request.page_size else None)

        def history_loader(request: HomepageDataItemRequest, _cursor: str | None) -> AdapterPage:
            end_at = _parse_datetime(
                request.requested_scope.get("endAt")
                or request.requested_scope.get("end_at")
            ) or datetime.now(UTC)
            scope = request.requested_scope
            current_days = int(scope.get("currentDays") or 7)
            trace_days = int(scope.get("traceDays") or 365)
            max_events = int(scope.get("maxEvents") or 30)
            featured_events = int(scope.get("featuredEvents") or 3)
            cache_key = ":".join(
                [
                    str(scope.get("targetTradeDate") or end_at.date()),
                    end_at.isoformat(),
                    str(current_days),
                    str(trace_days),
                    str(max_events),
                    str(featured_events),
                ]
            )
            history = history_cache.get(cache_key)
            if history is None:
                history = build_radar_history(
                    radar_provider,
                    end_at=end_at,
                    current_days=current_days,
                    trace_days=trace_days,
                    max_events=max_events,
                    featured_events=featured_events,
                )
                history_cache[cache_key] = history
                if len(history_cache) > 8:
                    del history_cache[next(iter(history_cache))]
            record = {
                "sourceRecordKey": request.request_fingerprint,
                "subjectType": "news_radar",
                "subjectKey": "homepage",
                "metricCatalogId": request.dataset_key,
                "valueType": "json",
                "valueJson": history,
                "observationPeriod": {
                    "targetTradeDate": scope.get("targetTradeDate"),
                    "phase": scope.get("phase"),
                },
                "publishedAt": end_at.isoformat(),
            }
            return AdapterPage(
                items=(record,),
                covered_scope=request.requested_scope,
                actual_data_cutoff=request.target_data_cutoff
                or DataCutoff("published_at", end_at.isoformat()),
                source_published_at=end_at,
            )

        loaders: dict[str, PageLoader] = {
            "news.fast": fast_loader,
            "news.major": lambda request, _cursor: _news_page(request, client.fetch_major_news(*window(request))),
            "news.cctv": lambda request, _cursor: _news_page(request, client.fetch_cctv_news(request.requested_scope.get("date") or request.requested_scope.get("targetDate") or date.today())),
            "news.radar_history": history_loader,
            "news_fast": fast_loader,
            "news_major": lambda request, _cursor: _news_page(request, client.fetch_major_news(*window(request))),
            "news_cctv": lambda request, _cursor: _news_page(request, client.fetch_cctv_news(request.requested_scope.get("date") or request.requested_scope.get("targetDate") or date.today())),
        }
        loaders.update(datasets or {})
        capabilities = {key: DatasetCapability(key, description=f"Minishare {key} 规范化数据集") for key in loaders}
        super().__init__(capabilities=capabilities, page_loaders=loaders, authority_config=authority_config)


class ScriptedHomepageProviderAdapter(HomepageProviderAdapter):
    """脚本化测试替身，复用生产 adapter 的所有结果语义。"""

    provider_key = "test"

    def __init__(self, scripts: Mapping[str, Iterable[Any] | Any] | None = None, *, provider_key: str = "test", provider_version: str = "1.0", contract_version: str = CONTRACT_VERSION, normalization_rules_version: str = NORMALIZATION_RULES_VERSION, authority_config: Mapping[str, Mapping[str, Any]] | None = None) -> None:
        self.provider_key = provider_key
        self.provider_version = provider_version
        self.contract_version = contract_version
        self.normalization_rules_version = normalization_rules_version
        values = dict(scripts or {})
        self._scripts: dict[str, list[Any]] = {}
        loaders: dict[str, PageLoader] = {}
        for key, script in values.items():
            if isinstance(script, (str, bytes, Mapping, AdapterPage, HomepageDataItemResult, ProviderError, ProviderAdapterException)):
                queue: list[Any] = [script]
            else:
                try:
                    entries = list(script)
                    queue = entries if entries and all(_looks_like_page(item) for item in entries) else [AdapterPage(items=tuple(entries))]
                except TypeError:
                    queue = [script]
            self._scripts[key] = queue
            loaders[key] = self._script_loader(key)
        super().__init__(capabilities={key: DatasetCapability(key, description="脚本化 Provider 数据集") for key in values}, page_loaders=loaders, authority_config=authority_config)

    def _script_loader(self, dataset_key: str) -> PageLoader:
        def load(_request: HomepageDataItemRequest, _cursor: str | None) -> Any:
            queue = self._scripts.get(dataset_key, [])
            if not queue:
                return AdapterPage()
            value = queue.pop(0)
            if isinstance(value, ProviderAdapterException):
                raise value
            if isinstance(value, Exception):
                raise _map_external_exception(value)
            if isinstance(value, ProviderError):
                return AdapterPage(terminal_error=value)
            return value

        return load  # type: ignore[return-value]


TestHomepageProviderAdapter = ScriptedHomepageProviderAdapter
TushareProviderAdapter = TushareHomepageProviderAdapter
TuShareProviderAdapter = TushareHomepageProviderAdapter
MinishareProviderAdapter = MinishareHomepageProviderAdapter


def _capability(dataset_key: str, value: DatasetCapability | Mapping[str, Any] | str) -> DatasetCapability:
    if isinstance(value, DatasetCapability):
        return value
    if isinstance(value, Mapping):
        return DatasetCapability(
            dataset_key=dataset_key,
            dataset_payload_version=str(value.get("datasetPayloadVersion") or value.get("dataset_payload_version") or "1.0"),
            description=str(value.get("description") or ""),
            supports_pagination=bool(value.get("supportsPagination", value.get("supports_pagination", True))),
        )
    return DatasetCapability(dataset_key=dataset_key, dataset_payload_version=str(value or "1.0"))


def _looks_like_page(value: Any) -> bool:
    if isinstance(value, (AdapterPage, HomepageDataItemResult, ProviderError, ProviderAdapterException)):
        return True
    if isinstance(value, Mapping):
        return any(key in value for key in ("items", "records", "data", "nextCursor", "next_cursor", "terminalError", "error"))
    return False


def _compatible_major(requested: str, supported: str) -> bool:
    try:
        return int(str(requested).split(".", 1)[0]) == int(str(supported).split(".", 1)[0])
    except (TypeError, ValueError):
        return False


def _map_external_exception(exc: Exception) -> ProviderAdapterException:
    text = str(exc)
    lowered = text.lower()
    if "contract" in lowered or "schema" in lowered:
        error_class = "contract_incompatible"
        retryability = Retryability.NON_RETRYABLE
    elif "429" in lowered or "rate" in lowered or "限流" in text:
        error_class = "rate_limited"
        retryability = Retryability.RETRYABLE
    elif "timeout" in lowered or "超时" in text:
        error_class = "timeout"
        retryability = Retryability.RETRYABLE
    elif "auth" in lowered or "token" in lowered or "授权" in text:
        error_class = "authorization"
        retryability = Retryability.NON_RETRYABLE
    else:
        error_class = "upstream_unavailable"
        retryability = Retryability.RETRYABLE
    return ProviderAdapterException(text or exc.__class__.__name__, error_class=error_class, retryability=retryability)


def _scope_date(request: HomepageDataItemRequest) -> str | None:
    value = request.requested_scope.get("asOfDate") or request.requested_scope.get("as_of_date") or request.requested_scope.get("tradeDate") or request.requested_scope.get("trade_date")
    return str(value) if value is not None else None


def _bars_as_records(value: Any) -> Any:
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return value.to_dict(orient="records")
    return value


def _dated_page(request: HomepageDataItemRequest, value: Any) -> AdapterPage:
    target_date = _scope_date(request)
    page = AdapterPage.from_value(value)
    if page.prebuilt_result is not None:
        return page
    if page.actual_data_cutoff is not None:
        return page
    if page.covered_scope is not None or page.missing_scope is not None or page.terminal_error is not None:
        return AdapterPage(
            items=page.items,
            next_cursor=page.next_cursor,
            covered_scope=page.covered_scope or request.requested_scope,
            missing_scope=page.missing_scope,
            actual_data_cutoff=DataCutoff("trade_date", target_date) if target_date else None,
            upstream_as_of=page.upstream_as_of,
            source_published_at=page.source_published_at,
            terminal_error=page.terminal_error,
        )
    return AdapterPage(
        items=page.items,
        covered_scope=request.requested_scope,
        actual_data_cutoff=DataCutoff("trade_date", target_date) if target_date else None,
    )


def _news_page(request: HomepageDataItemRequest, value: Any, *, next_cursor: str | None = None) -> AdapterPage:
    page = AdapterPage.from_value(value)
    if page.prebuilt_result is not None:
        return page
    end_at = request.requested_scope.get("endAt") or request.requested_scope.get("end_at")
    actual_cutoff = page.actual_data_cutoff
    if actual_cutoff is None and page.terminal_error is None:
        actual_cutoff = DataCutoff("published_at", str(end_at)) if end_at else None
    return AdapterPage(
        items=page.items,
        next_cursor=next_cursor or page.next_cursor,
        covered_scope=page.covered_scope or request.requested_scope,
        missing_scope=page.missing_scope,
        actual_data_cutoff=actual_cutoff,
        upstream_as_of=page.upstream_as_of,
        source_published_at=page.source_published_at,
        terminal_error=page.terminal_error,
    )


def _first_page_value(pages: Sequence[AdapterPage], field_name: str) -> datetime | None:
    for page in pages:
        value = getattr(page, field_name)
        if value is not None:
            return value
    return None


def _merge_scope(values: Iterable[Mapping[str, Any] | None], *, fallback: Mapping[str, Any] | None = None) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for value in values:
        if value:
            merged.update(value)
    if not merged and fallback:
        merged.update(fallback)
    return merged


def _latest_cutoff(values: Iterable[DataCutoff | None]) -> DataCutoff | None:
    selected: DataCutoff | None = None
    for value in values:
        if value is None:
            continue
        if selected is None or (value.key == selected.key and value.value > selected.value):
            selected = value
    return selected


def _infer_cutoff(items: Sequence[Any], request: HomepageDataItemRequest) -> DataCutoff | None:
    """从记录的业务日期推导截止点，不把抓取时间冒充数据截止点。"""

    candidates: list[tuple[str, str]] = []
    preferred_key = request.target_data_cutoff.key if request.target_data_cutoff else None
    for item in items:
        try:
            record = _mapping(item)
        except ProviderAdapterException:
            continue
        period = record.get("observationPeriod") or record.get("observation_period")
        if isinstance(period, Mapping):
            record = {**period, **record}
        for key in ("tradeDate", "trade_date", "date", "periodEnd", "period_end", "publishedAt", "published_at", "pub_time"):
            value = record.get(key)
            if value in (None, ""):
                continue
            text = str(value)
            if preferred_key and _normalized_key(key) == _normalized_key(preferred_key):
                candidates.append((preferred_key, text))
                break
            if preferred_key is None:
                candidates.append(("published_at" if "published" in key or key == "pub_time" else "trade_date", text))
                break
    if not candidates:
        return None
    key = preferred_key or candidates[0][0]
    values = [value for candidate_key, value in candidates if candidate_key == key]
    return DataCutoff(key, max(values)) if values else None


def _record_time(record: Mapping[str, Any], *keys: str) -> datetime | None:
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return _parse_datetime(value)
    return None


def _normalized_key(value: str) -> str:
    return value.replace("_", "").lower()


def _latest_assertion_time(assertions: Sequence[SourceAssertion], field_name: str) -> datetime | None:
    values = [getattr(item, field_name) for item in assertions if getattr(item, field_name) is not None]
    return max(values) if values else None


def _collect_observation_period(observations: Sequence[NormalizedObservation]) -> Mapping[str, Any]:
    periods = {
        item.identity_key: item.observation_period
        for item in observations
        if item.observation_period
    }
    return {"byObservation": periods} if periods else {}


def _cutoff_reached(actual: DataCutoff | None, target: DataCutoff | None) -> bool:
    if target is None:
        return True
    return actual is not None and actual.key == target.key and actual.value >= target.value
