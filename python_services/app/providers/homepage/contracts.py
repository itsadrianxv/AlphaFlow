"""首页数据清单 Provider 结果契约。

该模块只描述跨 Provider 的稳定语义。TuShare、Minishare 和测试替身都通过
``HomepageDataItemResult`` 交付结果，调用方不需要理解供应商字段、分页或错误码。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
import hashlib
import json
import math
import re
from typing import Any, Mapping, Self


CONTRACT_VERSION = "1.0"
NORMALIZATION_RULES_VERSION = "1.0"
CANONICALIZATION_VERSION = "jcs-1"


class ResultStatus(StrEnum):
    SUCCESS = "success"
    DEGRADED = "degraded"
    EMPTY = "empty"
    ERROR = "error"


class QualityStatus(StrEnum):
    NORMAL = "normal"
    DEGRADED = "degraded"
    ISOLATED = "isolated"


class Retryability(StrEnum):
    RETRYABLE = "retryable"
    NON_RETRYABLE = "non_retryable"
    NOT_APPLICABLE = "not_applicable"


class ReplayMode(StrEnum):
    FRESH = "fresh"
    RETRY = "retry"
    REACQUIRE = "reacquire"
    REPLAY = "replay"


_DECIMAL_RE = re.compile(r"^-?(?:0|[1-9]\d*)(?:\.\d+)?$")
_KNOWN_RESULT_STATUSES = {item.value for item in ResultStatus}
_KNOWN_QUALITY_STATUSES = {item.value for item in QualityStatus}
_KNOWN_RETRYABILITY = {item.value for item in Retryability}
_KNOWN_REPLAY_MODES = {item.value for item in ReplayMode}


def _canonical_value(value: Any) -> Any:
    """把信封中的值转换为稳定、可哈希且不含 NaN 的 JSON 结构。"""

    if isinstance(value, datetime):
        return _ensure_aware(value).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, Mapping):
        return {str(key): _canonical_value(value[key]) for key in sorted(value, key=str)}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_canonical_value(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Provider contract 不允许 NaN 或 Infinity")
        return value
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return _canonical_value(value.to_dict())
    return value


def canonical_json(value: Any) -> str:
    """返回用于请求/结果哈希的稳定 JSON 字节序列表示。"""

    return json.dumps(
        _canonical_value(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


def sha256_hash(value: Any) -> str:
    return f"sha256:{hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()}"


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _parse_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return _ensure_aware(value)
    try:
        text = str(value).replace("Z", "+00:00")
        return _ensure_aware(datetime.fromisoformat(text))
    except (TypeError, ValueError):
        raise ValueError(f"非法时间值: {value!r}") from None


def _validate_no_non_finite(value: Any, *, path: str = "value") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{path} 不允许 NaN 或 Infinity")
    if isinstance(value, Mapping):
        for key, nested in value.items():
            _validate_no_non_finite(nested, path=f"{path}.{key}")
    elif isinstance(value, (list, tuple, set, frozenset)):
        for index, nested in enumerate(value):
            _validate_no_non_finite(nested, path=f"{path}[{index}]")


def normalize_decimal(value: Any) -> str:
    """将精确数值编码为十进制字符串，拒绝隐式浮点特殊值。"""

    if isinstance(value, bool):
        raise ValueError("布尔值不能作为精确数值")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("精确数值不允许 NaN 或 Infinity")
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"非法精确数值: {value!r}") from None
    if not decimal.is_finite():
        raise ValueError("精确数值不允许 NaN 或 Infinity")
    text = format(decimal, "f")
    if not _DECIMAL_RE.fullmatch(text):
        raise ValueError(f"非法十进制编码: {text!r}")
    return text


@dataclass(frozen=True, slots=True)
class DataCutoff:
    key: str
    value: str

    def __post_init__(self) -> None:
        if not self.key.strip() or not self.value.strip():
            raise ValueError("数据截止点必须包含非空 key 和 value")

    def to_dict(self) -> dict[str, str]:
        return {"key": self.key, "value": self.value}

    @classmethod
    def from_value(cls, value: Any) -> Self | None:
        if value is None:
            return None
        if isinstance(value, cls):
            return value
        if isinstance(value, Mapping):
            return cls(key=str(value.get("key") or value.get("cutoffKey") or ""), value=str(value.get("value") or value.get("cutoffValue") or ""))
        raise ValueError(f"无法解析数据截止点: {value!r}")


@dataclass(frozen=True, slots=True)
class ScopeCoverage:
    requested_scope: Mapping[str, Any] = field(default_factory=dict)
    covered_scope: Mapping[str, Any] = field(default_factory=dict)
    missing_scope: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _validate_no_non_finite(self.requested_scope, path="requestedScope")
        _validate_no_non_finite(self.covered_scope, path="coveredScope")
        _validate_no_non_finite(self.missing_scope, path="missingScope")

    @property
    def requestedScope(self) -> Mapping[str, Any]:
        return self.requested_scope

    @property
    def coveredScope(self) -> Mapping[str, Any]:
        return self.covered_scope

    @property
    def missingScope(self) -> Mapping[str, Any]:
        return self.missing_scope

    def to_dict(self) -> dict[str, Any]:
        return {
            "requestedScope": _canonical_value(self.requested_scope),
            "coveredScope": _canonical_value(self.covered_scope),
            "missingScope": _canonical_value(self.missing_scope),
        }


@dataclass(frozen=True, slots=True)
class NormalizedObservation:
    identity_key: str
    canonicalization_version: str
    subject_type: str
    subject_key: str
    metric_catalog_id: str
    dimensions: Mapping[str, Any] = field(default_factory=dict)
    observation_kind: str = "point"
    observation_period: Mapping[str, Any] = field(default_factory=dict)
    value_type: str = "json"
    value_text: str | None = None
    value_json: Any = None
    unit: str | None = None
    precision: int | None = None
    missing_reason: str | None = None
    quality_status: QualityStatus = QualityStatus.NORMAL

    def __post_init__(self) -> None:
        for name in ("identity_key", "canonicalization_version", "subject_type", "subject_key", "metric_catalog_id", "observation_kind", "value_type"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"规范化观测的 {name} 不能为空")
        if self.value_text is not None and not isinstance(self.value_text, str):
            raise ValueError("value_text 必须是字符串")
        _validate_no_non_finite(self.value_json, path="valueJson")
        if self.value_text is None and self.value_json is None and not self.missing_reason:
            raise ValueError("规范化观测必须有 value、valueJson 或 missingReason")
        if self.precision is not None and self.precision < 0:
            raise ValueError("precision 不能为负数")
        quality = self.quality_status.value if isinstance(self.quality_status, QualityStatus) else str(self.quality_status)
        if quality not in _KNOWN_QUALITY_STATUSES:
            raise ValueError(f"未知数据质量状态: {quality}")

    @property
    def identityKey(self) -> str:
        return self.identity_key

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "identityKey": self.identity_key,
            "canonicalizationVersion": self.canonicalization_version,
            "subjectType": self.subject_type,
            "subjectKey": self.subject_key,
            "metricCatalogId": self.metric_catalog_id,
            "dimensions": _canonical_value(self.dimensions),
            "observationKind": self.observation_kind,
            "observationPeriod": _canonical_value(self.observation_period),
            "valueType": self.value_type,
            "unit": self.unit,
            "precision": self.precision,
            "missingReason": self.missing_reason,
            "qualityStatus": self.quality_status.value if isinstance(self.quality_status, QualityStatus) else self.quality_status,
        }
        if self.value_text is not None:
            result["valueText"] = self.value_text
        if self.value_json is not None:
            result["valueJson"] = _canonical_value(self.value_json)
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Self:
        return cls(
            identity_key=str(value.get("identityKey") or value.get("identity_key") or ""),
            canonicalization_version=str(value.get("canonicalizationVersion") or value.get("canonicalization_version") or CANONICALIZATION_VERSION),
            subject_type=str(value.get("subjectType") or value.get("subject_type") or ""),
            subject_key=str(value.get("subjectKey") or value.get("subject_key") or ""),
            metric_catalog_id=str(value.get("metricCatalogId") or value.get("metric_catalog_id") or ""),
            dimensions=value.get("dimensions") or value.get("dimensionsJson") or {},
            observation_kind=str(value.get("observationKind") or value.get("observation_kind") or "point"),
            observation_period=value.get("observationPeriod") or value.get("observation_period") or {},
            value_type=str(value.get("valueType") or value.get("value_type") or "json"),
            value_text=value.get("valueText") if "valueText" in value else value.get("value_text"),
            value_json=value.get("valueJson") if "valueJson" in value else value.get("value_json"),
            unit=value.get("unit"),
            precision=value.get("precision"),
            missing_reason=value.get("missingReason") if "missingReason" in value else value.get("missing_reason"),
            quality_status=value.get("qualityStatus") or value.get("quality_status") or QualityStatus.NORMAL,
        )


@dataclass(frozen=True, slots=True)
class SourceAssertion:
    assertion_key: str
    canonicalization_version: str
    source_key: str
    dataset_key: str
    source_record_key: str
    observation_identity_key: str
    raw_record: Mapping[str, Any]
    content_hash: str
    request_params_hash: str
    provider_version: str
    upstream_as_of: datetime | None = None
    source_published_at: datetime | None = None
    fetched_at: datetime | None = None

    def __post_init__(self) -> None:
        for name in ("assertion_key", "canonicalization_version", "source_key", "dataset_key", "source_record_key", "observation_identity_key", "content_hash", "request_params_hash", "provider_version"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"来源断言的 {name} 不能为空")
        _validate_no_non_finite(self.raw_record, path="rawRecord")
        if self.fetched_at is not None:
            object.__setattr__(self, "fetched_at", _ensure_aware(self.fetched_at))
        if self.upstream_as_of is not None:
            object.__setattr__(self, "upstream_as_of", _ensure_aware(self.upstream_as_of))
        if self.source_published_at is not None:
            object.__setattr__(self, "source_published_at", _ensure_aware(self.source_published_at))

    def to_dict(self) -> dict[str, Any]:
        return {
            "assertionKey": self.assertion_key,
            "canonicalizationVersion": self.canonicalization_version,
            "sourceKey": self.source_key,
            "datasetKey": self.dataset_key,
            "sourceRecordKey": self.source_record_key,
            "observationIdentityKey": self.observation_identity_key,
            "rawRecord": _canonical_value(self.raw_record),
            "contentHash": self.content_hash,
            "requestParamsHash": self.request_params_hash,
            "providerVersion": self.provider_version,
            "upstreamAsOf": _canonical_value(self.upstream_as_of),
            "sourcePublishedAt": _canonical_value(self.source_published_at),
            "fetchedAt": _canonical_value(self.fetched_at),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Self:
        return cls(
            assertion_key=str(value.get("assertionKey") or value.get("assertion_key") or ""),
            canonicalization_version=str(value.get("canonicalizationVersion") or value.get("canonicalization_version") or CANONICALIZATION_VERSION),
            source_key=str(value.get("sourceKey") or value.get("source_key") or ""),
            dataset_key=str(value.get("datasetKey") or value.get("dataset_key") or ""),
            source_record_key=str(value.get("sourceRecordKey") or value.get("source_record_key") or ""),
            observation_identity_key=str(value.get("observationIdentityKey") or value.get("observation_identity_key") or ""),
            raw_record=value.get("rawRecord") or value.get("raw_record") or {},
            content_hash=str(value.get("contentHash") or value.get("content_hash") or ""),
            request_params_hash=str(value.get("requestParamsHash") or value.get("request_params_hash") or ""),
            provider_version=str(value.get("providerVersion") or value.get("provider_version") or ""),
            upstream_as_of=_parse_datetime(value.get("upstreamAsOf") or value.get("upstream_as_of")),
            source_published_at=_parse_datetime(value.get("sourcePublishedAt") or value.get("source_published_at")),
            fetched_at=_parse_datetime(value.get("fetchedAt") or value.get("fetched_at")),
        )


@dataclass(frozen=True, slots=True)
class AuthoritySelection:
    strategy_version: str
    selected_source_key: str
    corroborating_source_keys: tuple[str, ...] = ()
    selection_reason: str = "配置的权威来源"
    fallback_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategyVersion": self.strategy_version,
            "selectedSourceKey": self.selected_source_key,
            "corroboratingSourceKeys": list(self.corroborating_source_keys),
            "selectionReason": self.selection_reason,
            "fallbackReason": self.fallback_reason,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Self:
        return cls(
            strategy_version=str(value.get("strategyVersion") or value.get("strategy_version") or "authority-1"),
            selected_source_key=str(value.get("selectedSourceKey") or value.get("selected_source_key") or ""),
            corroborating_source_keys=tuple(value.get("corroboratingSourceKeys") or value.get("corroborating_source_keys") or ()),
            selection_reason=str(value.get("selectionReason") or value.get("selection_reason") or "配置的权威来源"),
            fallback_reason=value.get("fallbackReason") or value.get("fallback_reason"),
        )


@dataclass(frozen=True, slots=True)
class ProviderError:
    error_class: str
    retryability: Retryability
    message: str
    code: str | None = None
    provider_code: str | None = None
    occurred_at: datetime | None = None
    retry_after_seconds: int | None = None
    details: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.error_class.strip() or not self.message.strip():
            raise ValueError("Provider 错误必须包含 error_class 和 message")
        retryability = self.retryability.value if isinstance(self.retryability, Retryability) else str(self.retryability)
        if retryability not in _KNOWN_RETRYABILITY:
            raise ValueError(f"未知 retryability: {retryability}")
        if self.retry_after_seconds is not None and self.retry_after_seconds < 0:
            raise ValueError("retry_after_seconds 不能为负数")
        _validate_no_non_finite(self.details, path="details")
        if self.occurred_at is not None:
            object.__setattr__(self, "occurred_at", _ensure_aware(self.occurred_at))

    def to_dict(self) -> dict[str, Any]:
        return {
            "errorClass": self.error_class,
            "retryability": self.retryability.value if isinstance(self.retryability, Retryability) else self.retryability,
            "message": self.message,
            "code": self.code,
            "providerCode": self.provider_code,
            "occurredAt": _canonical_value(self.occurred_at),
            "retryAfterSeconds": self.retry_after_seconds,
            "details": _canonical_value(self.details),
        }


@dataclass(frozen=True, slots=True)
class ReplayContext:
    acquisition_attempt_id: str
    idempotency_key: str
    request_fingerprint: str
    provider_version: str
    normalization_rules_version: str
    source_content_hashes: tuple[str, ...] = ()
    normalized_result_hash: str | None = None
    mode: ReplayMode = ReplayMode.FRESH

    def __post_init__(self) -> None:
        for name in ("acquisition_attempt_id", "idempotency_key", "request_fingerprint", "provider_version", "normalization_rules_version"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"重放上下文的 {name} 不能为空")
        mode = self.mode.value if isinstance(self.mode, ReplayMode) else str(self.mode)
        if mode not in _KNOWN_REPLAY_MODES:
            raise ValueError(f"未知重放模式: {mode}")

    def to_dict(self, *, normalized_result_hash: str | None = None) -> dict[str, Any]:
        return {
            "acquisitionAttemptId": self.acquisition_attempt_id,
            "idempotencyKey": self.idempotency_key,
            "requestFingerprint": self.request_fingerprint,
            "providerVersion": self.provider_version,
            "normalizationRulesVersion": self.normalization_rules_version,
            "sourceContentHashes": list(self.source_content_hashes),
            "normalizedResultHash": normalized_result_hash or self.normalized_result_hash,
            "mode": self.mode.value if isinstance(self.mode, ReplayMode) else self.mode,
        }


@dataclass(frozen=True, slots=True)
class HomepageDataItemRequest:
    dataset_key: str
    requested_scope: Mapping[str, Any] = field(default_factory=dict)
    target_data_cutoff: DataCutoff | None = None
    idempotency_key: str | None = None
    request_fingerprint: str | None = None
    acquisition_attempt_id: str | None = None
    expected_contract_version: str | None = None
    page_size: int = 500
    max_pages: int = 100
    replay_mode: ReplayMode = ReplayMode.FRESH
    request_params: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.dataset_key.strip():
            raise ValueError("dataset_key 不能为空")
        if self.page_size < 1 or self.max_pages < 1:
            raise ValueError("page_size 和 max_pages 必须为正数")
        cutoff = DataCutoff.from_value(self.target_data_cutoff)
        if cutoff is not self.target_data_cutoff:
            object.__setattr__(self, "target_data_cutoff", cutoff)
        fingerprint = self.request_fingerprint or sha256_hash({"datasetKey": self.dataset_key, "requestedScope": self.requested_scope, "targetDataCutoff": cutoff.to_dict() if cutoff else None, "requestParams": self.request_params})
        idem = self.idempotency_key or sha256_hash({"datasetKey": self.dataset_key, "requestFingerprint": fingerprint})
        attempt = self.acquisition_attempt_id or sha256_hash({"idempotencyKey": idem, "attempt": 1})
        object.__setattr__(self, "request_fingerprint", fingerprint)
        object.__setattr__(self, "idempotency_key", idem)
        object.__setattr__(self, "acquisition_attempt_id", attempt)

    def to_dict(self) -> dict[str, Any]:
        return {
            "datasetKey": self.dataset_key,
            "requestedScope": _canonical_value(self.requested_scope),
            "targetDataCutoff": self.target_data_cutoff.to_dict() if self.target_data_cutoff else None,
            "idempotencyKey": self.idempotency_key,
            "requestFingerprint": self.request_fingerprint,
            "acquisitionAttemptId": self.acquisition_attempt_id,
            "expectedContractVersion": self.expected_contract_version,
            "pageSize": self.page_size,
            "maxPages": self.max_pages,
            "replayMode": self.replay_mode.value if isinstance(self.replay_mode, ReplayMode) else self.replay_mode,
            "requestParams": _canonical_value(self.request_params),
        }


@dataclass(frozen=True, slots=True)
class HomepageDataItemResult:
    dataset_key: str
    provider_key: str
    result_status: ResultStatus
    quality_status: QualityStatus
    coverage: ScopeCoverage
    observations: tuple[NormalizedObservation, ...] = ()
    source_assertions: tuple[SourceAssertion, ...] = ()
    actual_data_cutoff: DataCutoff | None = None
    contract_version: str = CONTRACT_VERSION
    dataset_payload_version: str = "1.0"
    normalization_rules_version: str = NORMALIZATION_RULES_VERSION
    errors: tuple[ProviderError, ...] = ()
    authority: AuthoritySelection | None = None
    observation_period: Mapping[str, Any] = field(default_factory=dict)
    upstream_as_of: datetime | None = None
    source_published_at: datetime | None = None
    normalized_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    ingested_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    replay: ReplayContext | None = None

    def __post_init__(self) -> None:
        status = self.result_status.value if isinstance(self.result_status, ResultStatus) else str(self.result_status)
        quality = self.quality_status.value if isinstance(self.quality_status, QualityStatus) else str(self.quality_status)
        if status not in _KNOWN_RESULT_STATUSES:
            raise ValueError(f"未知 Provider 结果状态: {status}")
        if quality not in _KNOWN_QUALITY_STATUSES:
            raise ValueError(f"未知 Provider 质量状态: {quality}")
        if not self.dataset_key.strip() or not self.provider_key.strip():
            raise ValueError("结果必须包含 dataset_key 和 provider_key")
        if len({item.identity_key for item in self.observations}) != len(self.observations):
            raise ValueError("同一结果不能包含重复规范化观测")
        if len({item.assertion_key for item in self.source_assertions}) != len(self.source_assertions):
            raise ValueError("同一结果不能包含重复来源断言")
        if status == ResultStatus.ERROR.value and not self.errors:
            raise ValueError("error 结果必须包含结构化错误")
        if status == ResultStatus.EMPTY.value and self.observations:
            raise ValueError("empty 结果不能包含规范化观测")
        if status == ResultStatus.SUCCESS.value and quality != QualityStatus.NORMAL.value:
            raise ValueError("success 结果必须使用 normal 质量，限制结果应为 degraded")
        if status == ResultStatus.ERROR.value and quality == QualityStatus.NORMAL.value:
            raise ValueError("error 结果不能使用 normal 质量")
        _validate_no_non_finite(self.observation_period, path="observationPeriod")
        if self.upstream_as_of is not None:
            object.__setattr__(self, "upstream_as_of", _ensure_aware(self.upstream_as_of))
        if self.source_published_at is not None:
            object.__setattr__(self, "source_published_at", _ensure_aware(self.source_published_at))
        object.__setattr__(self, "normalized_at", _ensure_aware(self.normalized_at))
        object.__setattr__(self, "ingested_at", _ensure_aware(self.ingested_at))

    @property
    def result_hash(self) -> str:
        return sha256_hash(self._hash_payload())

    @property
    def resultHash(self) -> str:
        return self.result_hash

    @property
    def requested_scope(self) -> Mapping[str, Any]:
        return self.coverage.requested_scope

    @property
    def covered_scope(self) -> Mapping[str, Any]:
        return self.coverage.covered_scope

    @property
    def missing_scope(self) -> Mapping[str, Any]:
        return self.coverage.missing_scope

    def _hash_payload(self) -> dict[str, Any]:
        return {
            "contractVersion": self.contract_version,
            "datasetKey": self.dataset_key,
            "providerKey": self.provider_key,
            "datasetPayloadVersion": self.dataset_payload_version,
            "normalizationRulesVersion": self.normalization_rules_version,
            "resultStatus": self.result_status.value if isinstance(self.result_status, ResultStatus) else self.result_status,
            "qualityStatus": self.quality_status.value if isinstance(self.quality_status, QualityStatus) else self.quality_status,
            "coverage": self.coverage.to_dict(),
            "observations": [item.to_dict() for item in self.observations],
            "sourceAssertions": [item.to_dict() for item in self.source_assertions],
            "actualDataCutoff": self.actual_data_cutoff.to_dict() if self.actual_data_cutoff else None,
            "errors": [item.to_dict() for item in self.errors],
            "authority": self.authority.to_dict() if self.authority else None,
            "observationPeriod": _canonical_value(self.observation_period),
            "upstreamAsOf": _canonical_value(self.upstream_as_of),
            "sourcePublishedAt": _canonical_value(self.source_published_at),
        }

    def to_dict(self) -> dict[str, Any]:
        result = {
            **self._hash_payload(),
            "normalizedAt": _canonical_value(self.normalized_at),
            "ingestedAt": _canonical_value(self.ingested_at),
            "resultHash": self.result_hash,
            "replay": self.replay.to_dict(normalized_result_hash=self.result_hash) if self.replay else None,
        }
        return result

    def model_dump(self, *, mode: str = "python", **_: Any) -> dict[str, Any]:
        del mode
        return self.to_dict()

    def dict(self, **kwargs: Any) -> dict[str, Any]:
        return self.model_dump(**kwargs)

    def json(self, **_: Any) -> str:
        return canonical_json(self.to_dict())

    @classmethod
    def error_result(
        cls,
        *,
        request: HomepageDataItemRequest,
        provider_key: str,
        error: ProviderError,
        contract_version: str = CONTRACT_VERSION,
        provider_version: str = "1.0",
        normalization_rules_version: str = NORMALIZATION_RULES_VERSION,
        quality_status: QualityStatus = QualityStatus.ISOLATED,
    ) -> Self:
        replay = ReplayContext(
            acquisition_attempt_id=request.acquisition_attempt_id or "attempt",
            idempotency_key=request.idempotency_key or "idempotency",
            request_fingerprint=request.request_fingerprint or "fingerprint",
            provider_version=provider_version,
            normalization_rules_version=normalization_rules_version,
            mode=request.replay_mode,
        )
        return cls(
            dataset_key=request.dataset_key,
            provider_key=provider_key,
            result_status=ResultStatus.ERROR,
            quality_status=quality_status,
            coverage=ScopeCoverage(requested_scope=request.requested_scope),
            contract_version=contract_version,
            normalization_rules_version=normalization_rules_version,
            errors=(error,),
            replay=replay,
        )

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Self:
        coverage_value = value.get("coverage") or {}
        coverage = ScopeCoverage(
            requested_scope=coverage_value.get("requestedScope") or value.get("requestedScope") or {},
            covered_scope=coverage_value.get("coveredScope") or value.get("coveredScope") or {},
            missing_scope=coverage_value.get("missingScope") or value.get("missingScope") or {},
        )
        errors = tuple(
            ProviderError(
                error_class=str(item.get("errorClass") or item.get("error_class") or "unknown"),
                retryability=item.get("retryability") or Retryability.NON_RETRYABLE,
                message=str(item.get("message") or ""),
                code=item.get("code"),
                provider_code=item.get("providerCode") or item.get("provider_code"),
                occurred_at=_parse_datetime(item.get("occurredAt") or item.get("occurred_at")),
                retry_after_seconds=item.get("retryAfterSeconds") or item.get("retry_after_seconds"),
                details=item.get("details") or {},
            )
            for item in value.get("errors") or []
        )
        replay_value = value.get("replay")
        replay = None
        if replay_value:
            replay = ReplayContext(
                acquisition_attempt_id=str(replay_value.get("acquisitionAttemptId") or replay_value.get("acquisition_attempt_id") or ""),
                idempotency_key=str(replay_value.get("idempotencyKey") or replay_value.get("idempotency_key") or ""),
                request_fingerprint=str(replay_value.get("requestFingerprint") or replay_value.get("request_fingerprint") or ""),
                provider_version=str(replay_value.get("providerVersion") or replay_value.get("provider_version") or ""),
                normalization_rules_version=str(replay_value.get("normalizationRulesVersion") or replay_value.get("normalization_rules_version") or ""),
                source_content_hashes=tuple(replay_value.get("sourceContentHashes") or replay_value.get("source_content_hashes") or ()),
                normalized_result_hash=replay_value.get("normalizedResultHash") or replay_value.get("normalized_result_hash"),
                mode=replay_value.get("mode") or ReplayMode.FRESH,
            )
        return cls(
            dataset_key=str(value.get("datasetKey") or value.get("dataset_key") or ""),
            provider_key=str(value.get("providerKey") or value.get("provider_key") or ""),
            result_status=value.get("resultStatus") or value.get("result_status") or ResultStatus.ERROR,
            quality_status=value.get("qualityStatus") or value.get("quality_status") or QualityStatus.ISOLATED,
            coverage=coverage,
            observations=tuple(NormalizedObservation.from_dict(item) for item in value.get("observations") or ()),
            source_assertions=tuple(SourceAssertion.from_dict(item) for item in value.get("sourceAssertions") or value.get("source_assertions") or ()),
            actual_data_cutoff=DataCutoff.from_value(value.get("actualDataCutoff") or value.get("actual_data_cutoff")),
            contract_version=str(value.get("contractVersion") or value.get("contract_version") or CONTRACT_VERSION),
            dataset_payload_version=str(value.get("datasetPayloadVersion") or value.get("dataset_payload_version") or "1.0"),
            normalization_rules_version=str(value.get("normalizationRulesVersion") or value.get("normalization_rules_version") or NORMALIZATION_RULES_VERSION),
            errors=errors,
            authority=AuthoritySelection.from_dict(value["authority"]) if value.get("authority") else None,
            observation_period=value.get("observationPeriod") or value.get("observation_period") or {},
            upstream_as_of=_parse_datetime(value.get("upstreamAsOf") or value.get("upstream_as_of")),
            source_published_at=_parse_datetime(value.get("sourcePublishedAt") or value.get("source_published_at")),
            normalized_at=_parse_datetime(value.get("normalizedAt") or value.get("normalized_at")) or datetime.now(UTC),
            ingested_at=_parse_datetime(value.get("ingestedAt") or value.get("ingested_at")) or datetime.now(UTC),
            replay=replay,
        )
