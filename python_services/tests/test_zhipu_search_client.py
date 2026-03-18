"""Zhipu Web Search client tests."""

import logging
from unittest.mock import MagicMock, patch

import httpx

from app.services.zhipu_search_client import ZhipuSearchClient


def test_search_theme_concepts_logs_only_final_warning(caplog):
    client_mock = MagicMock()
    client_mock.post.side_effect = httpx.ReadTimeout("timed out")

    with (
        patch("app.services.zhipu_search_client.httpx.Client") as mock_client,
        patch("app.services.zhipu_search_client.time.sleep"),
    ):
        mock_client.return_value.__enter__.return_value = client_mock
        search_client = ZhipuSearchClient(
            api_key="test-key",
            retries=2,
            timeout_seconds=1,
        )

        with caplog.at_level(logging.DEBUG):
            payload = search_client.search_theme_concepts("算力", 3)

    warning_records = [
        record
        for record in caplog.records
        if record.levelno == logging.WARNING and "Zhipu web search failed" in record.message
    ]
    debug_records = [
        record
        for record in caplog.records
        if record.levelno == logging.DEBUG and "Zhipu web search failed" in record.message
    ]

    assert payload == []
    assert len(debug_records) == 2
    assert len(warning_records) == 1
