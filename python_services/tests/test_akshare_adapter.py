"""AkShareAdapter unit tests."""

from unittest.mock import patch

import pandas as pd
import pytest

from app.services.akshare_adapter import AkShareAdapter, _safe_float


class TestAkShareAdapter:
    def test_safe_float_with_valid_number(self):
        assert _safe_float(15.5) == 15.5
        assert _safe_float("15.5") == 15.5
        assert _safe_float("15.5%") == 15.5

    def test_safe_float_with_invalid_value(self):
        assert _safe_float(None) is None
        assert _safe_float(pd.NA) is None
        assert _safe_float("invalid") is None

    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_all_stock_codes_success(self, mock_spot):
        mock_spot.return_value = pd.DataFrame({"代码": ["000001", "600519", "SH600000"]})

        codes = AkShareAdapter.get_all_stock_codes()

        assert "000001" in codes
        assert "600519" in codes
        assert "600000" in codes
        assert len(codes) == 3

    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_all_stock_codes_filters_invalid(self, mock_spot):
        mock_spot.return_value = pd.DataFrame({"代码": ["000001", "INVALID", "12345", "600519"]})

        codes = AkShareAdapter.get_all_stock_codes()

        assert "000001" in codes
        assert "600519" in codes
        assert "INVALID" not in codes
        assert "12345" not in codes

    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_all_stock_codes_error_handling(self, mock_spot):
        mock_spot.side_effect = Exception("Network error")

        with pytest.raises(Exception) as exc_info:
            AkShareAdapter.get_all_stock_codes()

        assert "获取股票代码列表失败" in str(exc_info.value)

    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_stocks_by_codes_success(self, mock_spot):
        mock_spot.return_value = pd.DataFrame(
            {
                "代码": ["000001", "600519"],
                "名称": ["平安银行", "贵州茅台"],
                "市盈率-动态": [5.5, 35.5],
                "市净率": [0.8, 10.2],
                "总市值": [2000.0, 21000.0],
                "流通市值": [1900.0, 20500.0],
            }
        )

        stocks = AkShareAdapter.get_stocks_by_codes(["000001", "600519"])

        assert len(stocks) == 2
        assert stocks[0]["code"] == "000001"
        assert stocks[0]["name"] == "平安银行"
        assert stocks[0]["pe"] == 5.5
        assert stocks[1]["code"] == "600519"
        assert stocks[1]["name"] == "贵州茅台"

    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_stocks_by_codes_handles_missing_codes(self, mock_spot):
        mock_spot.return_value = pd.DataFrame(
            {
                "代码": ["000001"],
                "名称": ["平安银行"],
                "市盈率-动态": [5.5],
                "市净率": [0.8],
            }
        )

        stocks = AkShareAdapter.get_stocks_by_codes(["000001", "999999"])

        assert len(stocks) == 1
        assert stocks[0]["code"] == "000001"

    @patch("app.services.akshare_adapter.ak.stock_financial_analysis_indicator")
    def test_get_indicator_history_success(self, mock_indicator):
        mock_indicator.return_value = pd.DataFrame(
            {
                "日期": ["2023-12-31", "2023-09-30", "2023-06-30"],
                "净资产收益率": [0.25, 0.23, 0.22],
            }
        )

        history = AkShareAdapter.get_indicator_history("600519", "ROE", 1)

        assert len(history) > 0
        assert history[0]["date"] == "2023-12-31"
        assert history[0]["value"] == 0.25
        assert history[0]["isEstimated"] is False

    @patch("app.services.akshare_adapter.ak.stock_financial_analysis_indicator")
    def test_get_indicator_history_empty_data(self, mock_indicator):
        mock_indicator.return_value = pd.DataFrame()

        history = AkShareAdapter.get_indicator_history("999999", "ROE", 1)

        assert history == []

    @patch("app.services.akshare_adapter.ak.stock_board_industry_name_em")
    def test_get_available_industries_success(self, mock_board):
        mock_board.return_value = pd.DataFrame({"板块名称": ["银行", "白酒", "医药", "科技"]})

        industries = AkShareAdapter.get_available_industries()

        assert len(industries) == 4
        assert "银行" in industries
        assert "白酒" in industries
        assert "医药" in industries
        assert "科技" in industries

    @patch("app.services.akshare_adapter.ak.stock_board_industry_name_em")
    def test_get_available_industries_error_handling(self, mock_board):
        mock_board.side_effect = Exception("API error")

        with pytest.raises(Exception) as exc_info:
            AkShareAdapter.get_available_industries()

        assert "获取行业列表失败" in str(exc_info.value)
