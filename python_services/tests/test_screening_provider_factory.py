from __future__ import annotations


def test_strict_screening_provider_returns_tushare(monkeypatch):
    import app.providers.screening.factory as factory

    class FakeTushareProvider:
        provider_name = "tushare"

    factory.get_strict_screening_provider.cache_clear()
    monkeypatch.delenv("SCREENING_ENABLE_AKSHARE_FALLBACK", raising=False)
    monkeypatch.setattr(factory, "TushareScreeningProvider", FakeTushareProvider)

    provider = factory.get_strict_screening_provider()

    assert provider.provider_name == "tushare"
