from __future__ import annotations

from app.data_providers import get_default_data_provider
from app.data_providers.tushare_provider import TushareProvider


def test_default_data_provider_returns_cached_tushare_provider():
    get_default_data_provider.cache_clear()

    first = get_default_data_provider()
    second = get_default_data_provider()

    assert isinstance(first, TushareProvider)
    assert first is second
