"""Unit tests for the iFinD screening provider."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import pytest

import app.providers.screening.ifind_provider as ifind_module
from app.providers.screening.ifind_provider import IFindScreeningProvider


@dataclass
class FakeResult:
    data: object
    errorcode: int = 0
    errmsg: str = ""


def test_ifind_provider_requires_dependency(monkeypatch):
    monkeypatch.setattr(ifind_module, "IFIND_AVAILABLE", False)
    monkeypatch.setattr(ifind_module, "THS_iFinDLogin", None)

    provider = IFindScreeningProvider(username="user", password="secret")

    with pytest.raises(RuntimeError, match="iFinDPy"):
        provider.get_all_stock_codes()


def test_ifind_provider_raises_on_login_failure(monkeypatch):
    monkeypatch.setattr(ifind_module, "IFIND_AVAILABLE", True)
    monkeypatch.setattr(ifind_module, "THS_iFinDLogin", lambda _u, _p: -100)

    provider = IFindScreeningProvider(username="user", password="secret")

    with pytest.raises(RuntimeError, match="登录失败"):
        provider.get_all_stock_codes()


def test_ifind_provider_reads_universe_from_hs_a_block(monkeypatch):
    monkeypatch.setattr(ifind_module, "IFIND_AVAILABLE", True)
    monkeypatch.setattr(ifind_module, "THS_iFinDLogin", lambda _u, _p: 0)
    monkeypatch.setattr(
        ifind_module,
        "THS_DR",
        lambda *_args: FakeResult(
            pd.DataFrame(
                {
                    "p03291_f002": ["600519.SH", "000001.SZ", "688001.SH", "600519.SH"],
                    "p03291_f003": ["贵州茅台", "平安银行", "华兴源创", "贵州茅台"],
                }
            )
        ),
    )

    provider = IFindScreeningProvider(username="user", password="secret")

    assert provider.get_all_stock_codes() == ["600519", "000001", "688001"]


def test_ifind_provider_maps_batch_snapshot_fields(monkeypatch):
    monkeypatch.setattr(ifind_module, "IFIND_AVAILABLE", True)
    monkeypatch.setattr(ifind_module, "THS_iFinDLogin", lambda _u, _p: 0)

    def fake_ths_bd(_codes: str, indicator: str, _params: str):
        payloads = {
            "ths_stock_short_name_stock": pd.DataFrame(
                {
                    "thscode": ["600519.SH", "000001.SZ"],
                    "ths_stock_short_name_stock": ["贵州茅台", "平安银行"],
                }
            ),
            "ths_roe_ttm_stock": pd.DataFrame(
                {"thscode": ["600519.SH", "000001.SZ"], "ths_roe_ttm_stock": [28.0, 12.0]}
            ),
            "ths_pe_ttm_stock": pd.DataFrame(
                {"thscode": ["600519.SH", "000001.SZ"], "ths_pe_ttm_stock": [35.5, 6.5]}
            ),
            "ths_pb_latest_stock": pd.DataFrame(
                {"thscode": ["600519.SH", "000001.SZ"], "ths_pb_latest_stock": [10.2, 0.8]}
            ),
            "ths_eps_ttm_stock": pd.DataFrame(
                {"thscode": ["600519.SH", "000001.SZ"], "ths_eps_ttm_stock": [50.3, 1.5]}
            ),
            "ths_revenue_stock": pd.DataFrame(
                {
                    "thscode": ["600519.SH", "000001.SZ"],
                    "ths_revenue_stock": [127_550_000_000, 180_000_000_000],
                }
            ),
            "ths_np_atoopc_stock": pd.DataFrame(
                {
                    "thscode": ["600519.SH", "000001.SZ"],
                    "ths_np_atoopc_stock": [62_080_000_000, 40_000_000_000],
                }
            ),
            "ths_asset_liab_ratio_stock": pd.DataFrame(
                {
                    "thscode": ["600519.SH", "000001.SZ"],
                    "ths_asset_liab_ratio_stock": [25.0, 92.0],
                }
            ),
            "ths_total_shares_stock": pd.DataFrame(
                {
                    "thscode": ["600519.SH", "000001.SZ"],
                    "ths_total_shares_stock": [1_256_000_000, 19_405_918_198],
                }
            ),
            "ths_float_ashare_stock": pd.DataFrame(
                {
                    "thscode": ["600519.SH", "000001.SZ"],
                    "ths_float_ashare_stock": [1_225_000_000, 19_400_000_000],
                }
            ),
        }
        return FakeResult(payloads[indicator])

    monkeypatch.setattr(ifind_module, "THS_BD", fake_ths_bd)
    monkeypatch.setattr(
        ifind_module,
        "THS_RQ",
        lambda *_args: FakeResult(
            pd.DataFrame({"thscode": ["600519.SH", "000001.SZ"], "latest": [1675.0, 11.5]})
        ),
    )

    provider = IFindScreeningProvider(username="user", password="secret")
    result = provider.get_stock_batch(["600519", "000001"])

    assert result[0]["code"] == "600519"
    assert result[0]["name"] == "贵州茅台"
    assert result[0]["roe"] == pytest.approx(0.28)
    assert result[0]["revenue"] == pytest.approx(1275.5)
    assert result[0]["netProfit"] == pytest.approx(620.8)
    assert result[0]["debtRatio"] == pytest.approx(0.25)
    assert result[0]["marketCap"] == pytest.approx(21038.0)
    assert result[1]["floatMarketCap"] == pytest.approx(2231.0, rel=1e-3)


def test_ifind_provider_sorts_history_points_and_normalizes_amounts(monkeypatch):
    monkeypatch.setattr(ifind_module, "IFIND_AVAILABLE", True)
    monkeypatch.setattr(ifind_module, "THS_iFinDLogin", lambda _u, _p: 0)
    monkeypatch.setattr(
        ifind_module,
        "THS_DS",
        lambda *_args: FakeResult(
            pd.DataFrame(
                {
                    "time": ["2024-12-31", "2022-12-31", "2023-12-31"],
                    "ths_revenue_stock": [133_100_000_000, 100_000_000_000, 121_000_000_000],
                }
            )
        ),
    )

    provider = IFindScreeningProvider(username="user", password="secret")
    history = provider.get_indicator_history("600519", "REVENUE", 3)

    assert history == [
        {"date": "2022-12-31", "value": 1000.0, "isEstimated": False},
        {"date": "2023-12-31", "value": 1210.0, "isEstimated": False},
        {"date": "2024-12-31", "value": 1331.0, "isEstimated": False},
    ]
