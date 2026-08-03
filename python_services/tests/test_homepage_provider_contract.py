"""V01：TuShare、Minishare 和测试替身共享首页 Provider contract。"""

from __future__ import annotations

import math

import pytest

from app.providers.homepage import (
    AdapterPage,
    DataCutoff,
    HomepageDataItemRequest,
    MinishareHomepageProviderAdapter,
    ProviderAdapterException,
    ProviderError,
    QualityStatus,
    ReplayMode,
    ResultStatus,
    Retryability,
    ScriptedHomepageProviderAdapter,
    TushareHomepageProviderAdapter,
)


def _request(dataset_key: str = "fixture", **kwargs) -> HomepageDataItemRequest:
    return HomepageDataItemRequest(
        dataset_key=dataset_key,
        requested_scope={"tradeDate": "2026-08-01"},
        target_data_cutoff=DataCutoff("trade_date", "2026-08-01"),
        request_params={"fields": ["close", "volume"]},
        **kwargs,
    )


def _record(index: int = 1, *, close: str = "10.50") -> dict:
    return {
        "sourceRecordKey": f"row-{index}",
        "subjectType": "stock",
        "subjectKey": f"60000{index}",
        "metricCatalogId": "close",
        "value": close,
        "valueType": "decimal",
        "unit": "CNY",
        "tradeDate": "2026-08-01",
    }


def _adapters(script):
    return [
        ScriptedHomepageProviderAdapter({"fixture": script}),
        TushareHomepageProviderAdapter(datasets={"fixture": lambda _request, _cursor: script[0] if isinstance(script, list) else script}),
        MinishareHomepageProviderAdapter(datasets={"fixture": lambda _request, _cursor: script[0] if isinstance(script, list) else script}),
    ]


@pytest.mark.parametrize("adapter", _adapters([AdapterPage(items=(_record(),), covered_scope={"tradeDate": "2026-08-01"}, actual_data_cutoff=DataCutoff("trade_date", "2026-08-01"))]))
def test_three_adapters_return_the_same_success_contract_shape(adapter) -> None:
    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.SUCCESS
    assert result.quality_status == QualityStatus.NORMAL
    assert result.dataset_key == "fixture"
    assert result.contract_version == "1.0"
    assert result.normalization_rules_version == "1.0"
    assert result.coverage.requested_scope == {"tradeDate": "2026-08-01"}
    assert result.coverage.covered_scope == {"tradeDate": "2026-08-01"}
    assert result.coverage.missing_scope == {}
    assert len(result.observations) == 1
    assert result.observations[0].value_text == "10.50"
    assert result.observation_period["byObservation"]
    assert result.source_assertions[0].source_key == adapter.provider_key
    assert result.replay is not None
    assert result.replay.idempotency_key
    assert result.to_dict()["replay"]["normalizedResultHash"] == result.result_hash


def test_empty_is_a_non_retryable_terminal_result_without_fake_observation() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(), covered_scope={"tradeDate": "2026-08-01"}, actual_data_cutoff=DataCutoff("trade_date", "2026-08-01"))]})

    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.EMPTY
    assert result.quality_status == QualityStatus.NORMAL
    assert result.observations == ()
    assert result.errors == ()


def test_empty_without_cutoff_proof_is_invalid_instead_of_being_silently_accepted() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(), covered_scope={"tradeDate": "2026-08-01"})]})

    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.ERROR
    assert result.errors[0].code == "EMPTY_RESULT_MISSING_CUTOFF"


def test_partial_cutoff_is_degraded_and_exposes_missing_scope() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(_record(),), actual_data_cutoff=DataCutoff("trade_date", "2026-07-31"))]})

    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.DEGRADED
    assert result.quality_status == QualityStatus.DEGRADED
    assert result.missing_scope["dataCutoff"] == {"key": "trade_date", "value": "2026-08-01"}


def test_business_date_is_used_as_cutoff_when_page_does_not_supply_one() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(_record(),))]})

    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.SUCCESS
    assert result.actual_data_cutoff == DataCutoff("trade_date", "2026-08-01")


def test_catalog_rows_without_a_single_value_are_retained_as_json_observations() -> None:
    adapter = ScriptedHomepageProviderAdapter(
        {
            "fixture": [
                AdapterPage(
                    items=(
                        {
                            "sourceRecordKey": "stock-1",
                            "subjectType": "stock",
                            "subjectKey": "600001",
                            "metricCatalogId": "stock_profile",
                            "stockName": "测试公司",
                            "industry": "软件",
                            "tradeDate": "2026-08-01",
                        },
                    )
                )
            ]
        }
    )

    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.SUCCESS
    assert result.observations[0].value_type == "json"
    assert result.observations[0].value_json["stockName"] == "测试公司"


def test_scripted_adapter_accepts_a_plain_record_list_as_one_page() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [_record(1), _record(2)]})

    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.SUCCESS
    assert len(result.observations) == 2


@pytest.mark.parametrize(
    ("error_class", "expected_status", "expected_retryability"),
    [
        ("timeout", ResultStatus.ERROR, Retryability.RETRYABLE),
        ("contract_incompatible", ResultStatus.ERROR, Retryability.NON_RETRYABLE),
    ],
)
def test_structured_errors_are_shared_across_scripted_results(error_class, expected_status, expected_retryability) -> None:
    adapter = ScriptedHomepageProviderAdapter(
        {"fixture": [ProviderError(error_class=error_class, retryability=expected_retryability, message="测试错误")]}
    )

    result = adapter.fetch(_request())

    assert result.result_status == expected_status
    assert result.errors[0].error_class == error_class
    assert result.errors[0].retryability == expected_retryability


def test_unsupported_dataset_and_contract_incompatibility_are_terminal() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": []})

    unsupported = adapter.fetch(_request("missing"))
    incompatible = adapter.fetch(_request(expected_contract_version="2.0"))

    assert unsupported.errors[0].error_class == "unsupported_dataset"
    assert unsupported.errors[0].retryability == Retryability.NON_RETRYABLE
    assert incompatible.errors[0].error_class == "contract_incompatible"
    assert incompatible.errors[0].retryability == Retryability.NON_RETRYABLE


def test_pagination_continues_until_terminal_page_and_deduplicates_repeated_records() -> None:
    duplicate = _record(1)
    adapter = ScriptedHomepageProviderAdapter(
        {
            "fixture": [
                AdapterPage(items=(duplicate,), next_cursor="next", actual_data_cutoff=DataCutoff("trade_date", "2026-07-31")),
                AdapterPage(items=(duplicate, _record(2)), actual_data_cutoff=DataCutoff("trade_date", "2026-08-01")),
            ]
        }
    )

    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.SUCCESS
    assert len(result.observations) == 2
    assert len(result.source_assertions) == 2
    assert result.errors == ()


def test_pagination_limit_is_a_retryable_degraded_result_when_partial_data_exists() -> None:
    adapter = ScriptedHomepageProviderAdapter(
        {"fixture": [AdapterPage(items=(_record(),), next_cursor="still-next", actual_data_cutoff=DataCutoff("trade_date", "2026-07-31"))]}
    )

    result = adapter.fetch(_request(max_pages=1))

    assert result.result_status == ResultStatus.DEGRADED
    assert result.errors[0].error_class == "pagination_terminated"
    assert result.errors[0].retryability == Retryability.RETRYABLE


def test_idempotent_retry_returns_the_exact_same_result_and_conflicting_reuse_is_rejected() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(_record(),))]})
    first_request = _request(idempotency_key="fixed-key", request_fingerprint="fixed-fingerprint")
    first = adapter.fetch(first_request)
    replay = adapter.fetch(first_request)
    conflicting = adapter.fetch(_request(idempotency_key="fixed-key", request_fingerprint="other-fingerprint"))

    assert replay is first
    assert replay.result_hash == first.result_hash
    assert conflicting.result_status == ResultStatus.ERROR
    assert conflicting.errors[0].error_class == "duplicate_response"
    assert adapter.fetch(first_request) is first


def test_replay_without_an_existing_result_is_explicitly_unavailable() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(_record(),))]})

    result = adapter.fetch(_request(replay_mode=ReplayMode.REPLAY))

    assert result.result_status == ResultStatus.ERROR
    assert result.errors[0].error_class == "replay_unavailable"


def test_decimal_encoding_rejects_non_finite_values() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(_record(close=str(math.nan)),))]})

    result = adapter.fetch(_request())

    assert result.result_status == ResultStatus.ERROR
    assert result.errors[0].error_class == "normalization_failed"


def test_provider_exception_maps_rate_limit_to_retryable_structured_error() -> None:
    adapter = ScriptedHomepageProviderAdapter(
        {"fixture": [ProviderAdapterException("429 rate limited", error_class="rate_limited", retryability=Retryability.RETRYABLE, retry_after_seconds=5)]}
    )

    result = adapter.fetch(_request())

    assert result.errors[0].retryability == Retryability.RETRYABLE
    assert result.errors[0].retry_after_seconds == 5


def test_result_json_round_trip_preserves_sources_authority_and_replay_hash() -> None:
    adapter = ScriptedHomepageProviderAdapter(
        {"fixture": [AdapterPage(items=(_record(),), actual_data_cutoff=DataCutoff("trade_date", "2026-08-01"))]},
        authority_config={"fixture": {"strategyVersion": "authority-2", "selectedSourceKey": "test"}},
    )
    result = adapter.fetch(_request())

    restored = type(result).from_dict(result.to_dict())

    assert restored.result_hash == result.result_hash
    assert restored.source_assertions[0].assertion_key == result.source_assertions[0].assertion_key
    assert restored.authority is not None
    assert restored.authority.strategy_version == "authority-2"
    assert restored.replay is not None
    assert restored.replay.normalized_result_hash == result.result_hash


def test_scripted_adapter_can_replay_a_prebuilt_versioned_result_without_reinterpreting_it() -> None:
    source_adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(_record(),))]})
    original = source_adapter.fetch(_request())
    replay_adapter = ScriptedHomepageProviderAdapter({"fixture": [original]})

    replayed = replay_adapter.fetch(_request())

    assert replayed is original
    assert replayed.source_assertions == original.source_assertions
    assert replayed.result_hash == original.result_hash


def test_result_and_quality_statuses_are_independent_contract_dimensions() -> None:
    adapter = ScriptedHomepageProviderAdapter({"fixture": [AdapterPage(items=(_record(),))]})
    result = adapter.fetch(_request())

    # 通过序列化改写后仍应接受 success/degraded 组合。
    payload = result.to_dict()
    payload["qualityStatus"] = QualityStatus.DEGRADED.value
    restored = type(result).from_dict(payload)

    assert restored.result_status == ResultStatus.SUCCESS
    assert restored.quality_status == QualityStatus.DEGRADED


def test_normalized_result_hash_excludes_ingestion_clock_fields() -> None:
    first = ScriptedHomepageProviderAdapter({"fixture": [_record()] }).fetch(_request(idempotency_key="one"))
    second = ScriptedHomepageProviderAdapter({"fixture": [_record()] }).fetch(_request(idempotency_key="two"))

    assert first.result_hash == second.result_hash
