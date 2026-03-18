"""AkShareAdapter unit tests."""

from unittest.mock import patch

import pandas as pd
import pytest
import requests

from app.services.akshare_adapter import AkShareAdapter, _safe_float


@pytest.fixture(autouse=True)
def clear_adapter_caches():
    AkShareAdapter.clear_caches()
    yield
    AkShareAdapter.clear_caches()


class TestAkShareAdapter:
    def test_safe_float_with_valid_number(self):
        assert _safe_float(15.5) == 15.5
        assert _safe_float("15.5") == 15.5
        assert _safe_float("15.5%") == 15.5

    def test_safe_float_with_invalid_value(self):
        assert _safe_float(None) is None
        assert _safe_float(pd.NA) is None
        assert _safe_float("invalid") is None

    @patch("app.services.akshare_adapter.ak.stock_yjbb_em")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_shared_spot_cache_reused_across_universe_codes_and_batch(
        self,
        mock_spot,
        mock_yjbb,
    ):
        mock_spot.return_value = pd.DataFrame(
            {
                "代码": ["000001", "600519"],
                "名称": ["平安银行", "贵州茅台"],
                "市盈率-动态": [5.5, 35.5],
                "市净率": [0.8, 10.2],
                "总市值": [2000.0, 21000.0],
                "流通市值": [1900.0, 20500.0],
                "换手率": [1.2, 0.9],
                "涨跌幅": [0.5, 1.5],
            }
        )
        mock_yjbb.return_value = pd.DataFrame()

        codes = AkShareAdapter.get_all_stock_codes()
        stocks = AkShareAdapter.get_stocks_by_codes(["000001"])
        universe = AkShareAdapter.get_stock_universe()

        assert codes == ["000001", "600519"]
        assert len(stocks) == 1
        assert len(universe) == 2
        mock_spot.assert_called_once()

    @patch("app.services.akshare_adapter.ak.stock_yjbb_em")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_stocks_by_codes_prefers_financial_snapshot_fields(
        self,
        mock_spot,
        mock_yjbb,
    ):
        mock_spot.return_value = pd.DataFrame(
            {
                "代码": ["000001"],
                "名称": ["平安银行"],
                "行业": ["错误行业"],
                "市盈率-动态": [5.5],
                "市净率": [0.8],
                "总市值": [2000.0],
                "流通市值": [1900.0],
                "换手率": [1.2],
                "涨跌幅": [0.5],
            }
        )
        mock_yjbb.return_value = pd.DataFrame(
            {
                "股票代码": ["000001"],
                "所处行业": ["银行"],
                "净资产收益率": [12.3],
                "每股收益": [1.5],
                "营业总收入-营业总收入": [1800.0],
                "净利润-净利润": [400.0],
            }
        )

        stocks = AkShareAdapter.get_stocks_by_codes(["000001"])

        assert len(stocks) == 1
        assert stocks[0]["industry"] == "银行"
        assert stocks[0]["roe"] == 12.3
        assert stocks[0]["eps"] == 1.5
        assert stocks[0]["revenue"] == 1800.0
        assert stocks[0]["netProfit"] == 400.0
        assert stocks[0]["pe"] == 5.5
        assert stocks[0]["pb"] == 0.8
        assert stocks[0]["dataQuality"] == "complete"
        assert stocks[0]["warnings"] == []

    @patch("app.services.akshare_adapter.ak.stock_individual_info_em")
    @patch("app.services.akshare_adapter.ak.stock_yjbb_em")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_stocks_by_codes_uses_individual_info_for_missing_industry(
        self,
        mock_spot,
        mock_yjbb,
        mock_individual_info,
    ):
        mock_spot.return_value = pd.DataFrame(
            {
                "代码": ["600519"],
                "名称": ["贵州茅台"],
                "市盈率-动态": [35.5],
                "市净率": [10.2],
                "总市值": [21000.0],
                "流通市值": [20500.0],
                "换手率": [0.9],
                "涨跌幅": [1.5],
            }
        )
        mock_yjbb.return_value = pd.DataFrame(
            {
                "股票代码": ["600519"],
                "所处行业": [""],
                "净资产收益率": [28.0],
            }
        )
        mock_individual_info.return_value = pd.DataFrame(
            {
                "item": ["行业"],
                "value": ["白酒"],
            }
        )

        stocks = AkShareAdapter.get_stocks_by_codes(["600519"])

        assert len(stocks) == 1
        assert stocks[0]["industry"] == "白酒"
        mock_individual_info.assert_called_once_with(symbol="600519")

    @patch("app.services.akshare_adapter.ak.stock_financial_analysis_indicator_em")
    def test_get_indicator_history_uses_em_source_for_roe(self, mock_em_indicator):
        mock_em_indicator.return_value = pd.DataFrame(
            {
                "REPORT_DATE": ["2024-12-31", "2023-12-31", "2022-12-31"],
                "净资产收益率": [0.25, 0.23, 0.22],
            }
        )

        history = AkShareAdapter.get_indicator_history("600519", "ROE", 2)

        assert history == [
            {"date": "2023-12-31", "value": 0.23, "isEstimated": False},
            {"date": "2024-12-31", "value": 0.25, "isEstimated": False},
        ]

    @patch("app.services.akshare_adapter._load_ths_frame")
    def test_get_indicator_history_uses_ths_profit_table_for_revenue(
        self,
        mock_load_ths_frame,
    ):
        mock_load_ths_frame.return_value = pd.DataFrame(
            {
                "report_date": ["2022-12-31", "2023-12-31", "2024-12-31"],
                "metric_name": ["营业总收入", "营业总收入", "营业总收入"],
                "value": [1000.0, 1200.0, 1500.0],
            }
        )

        history = AkShareAdapter.get_indicator_history("600519", "REVENUE", 2)

        assert history == [
            {"date": "2023-12-31", "value": 1200.0, "isEstimated": False},
            {"date": "2024-12-31", "value": 1500.0, "isEstimated": False},
        ]

    @patch("app.services.akshare_adapter._load_ths_frame")
    def test_get_indicator_history_computes_debt_ratio_from_ths_balance_sheet(
        self,
        mock_load_ths_frame,
    ):
        mock_load_ths_frame.return_value = pd.DataFrame(
            {
                "report_date": [
                    "2023-12-31",
                    "2023-12-31",
                    "2024-12-31",
                    "2024-12-31",
                ],
                "metric_name": ["总资产", "总负债", "总资产", "总负债"],
                "value": [1000.0, 450.0, 1200.0, 480.0],
            }
        )

        history = AkShareAdapter.get_indicator_history("600519", "DEBT_RATIO", 2)

        assert history == [
            {"date": "2023-12-31", "value": 45.0, "isEstimated": False},
            {"date": "2024-12-31", "value": 40.0, "isEstimated": False},
        ]

    @patch("app.services.akshare_adapter.ak.stock_board_industry_name_em")
    @patch("app.services.akshare_adapter.ak.stock_yjbb_em")
    def test_get_available_industries_prefers_financial_snapshot(
        self,
        mock_yjbb,
        mock_board,
    ):
        mock_yjbb.return_value = pd.DataFrame(
            {
                "股票代码": ["000001", "600519"],
                "所处行业": ["银行", "白酒"],
            }
        )
        mock_board.return_value = pd.DataFrame({"板块名称": ["不会命中"]})

        industries = AkShareAdapter.get_available_industries()

        assert industries == ["白酒", "银行"]
        mock_board.assert_not_called()

    @patch("app.services.akshare_adapter.ak.stock_board_industry_name_em")
    @patch("app.services.akshare_adapter.ak.stock_yjbb_em")
    def test_get_available_industries_falls_back_to_board_list(
        self,
        mock_yjbb,
        mock_board,
    ):
        mock_yjbb.return_value = pd.DataFrame()
        mock_board.return_value = pd.DataFrame({"板块名称": ["银行", "白酒", "医药"]})

        industries = AkShareAdapter.get_available_industries()

        assert industries == ["医药", "白酒", "银行"]
        mock_board.assert_called_once()

    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot")
    @patch("app.services.akshare_adapter.ak.stock_yjbb_em")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_all_stock_codes_error_handling(self, mock_spot, mock_yjbb, mock_sina_spot):
        mock_spot.side_effect = Exception("network error")
        mock_yjbb.return_value = pd.DataFrame()
        mock_sina_spot.side_effect = Exception("sina down")

        with pytest.raises(Exception) as exc_info:
            AkShareAdapter.get_all_stock_codes()

        assert "获取股票代码列表失败" in str(exc_info.value)

    def test_concept_constituents_loader_fetches_all_pages_and_dedupes(self):
        page_one_html = """
        <html>
          <span class="page_info">1 / 2</span>
          <table>
            <thead>
              <tr><th>序号</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌幅(%)</th><th>换手(%)</th></tr>
            </thead>
            <tbody>
              <tr><td>1</td><td>2015</td><td>协鑫能科</td><td>22.28</td><td>4.31</td><td>22.36</td></tr>
              <tr><td>2</td><td>300324</td><td>旋极信息</td><td>5.60</td><td>5.66</td><td>7.36</td></tr>
            </tbody>
          </table>
        </html>
        """
        page_two_html = """
        <html>
          <span class="page_info">2 / 2</span>
          <table>
            <thead>
              <tr><th>序号</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌幅(%)</th><th>换手(%)</th></tr>
            </thead>
            <tbody>
              <tr><td>1</td><td>603019</td><td>中科曙光</td><td>41.20</td><td>2.15</td><td>1.80</td></tr>
              <tr><td>2</td><td>300324</td><td>旋极信息</td><td>5.60</td><td>5.66</td><td>7.36</td></tr>
            </tbody>
          </table>
        </html>
        """

        with patch(
            "app.services.akshare_adapter._fetch_ths_concept_detail_html",
            side_effect=[page_one_html, page_two_html],
        ) as mock_fetch:
            df = AkShareAdapter.get_concept_constituents_frame(
                "算力租赁",
                concept_code="309068",
            )

        assert mock_fetch.call_count == 2
        assert df["代码"].tolist() == ["002015", "300324", "603019"]
        assert df["最新价"].tolist() == [22.28, 5.6, 41.2]
        assert "换手率" in df.columns

    def test_concept_constituents_loader_keeps_partial_rows_when_followup_page_fails(self):
        page_one_html = """
        <html>
          <span class="page_info">1 / 3</span>
          <table>
            <thead>
              <tr><th>序号</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌幅(%)</th><th>换手(%)</th></tr>
            </thead>
            <tbody>
              <tr><td>1</td><td>2015</td><td>协鑫能科</td><td>22.28</td><td>4.31</td><td>22.36</td></tr>
              <tr><td>2</td><td>300324</td><td>旋极信息</td><td>5.60</td><td>5.66</td><td>7.36</td></tr>
            </tbody>
          </table>
        </html>
        """

        with patch(
            "app.services.akshare_adapter._fetch_ths_concept_detail_html",
            side_effect=[
                page_one_html,
                requests.exceptions.SSLError("EOF occurred in violation of protocol"),
            ],
        ) as mock_fetch:
            df = AkShareAdapter.get_concept_constituents_frame(
                "算力租赁",
                concept_code="309068",
            )

        assert mock_fetch.call_count == 2
        assert df["代码"].tolist() == ["002015", "300324"]

    def test_concept_constituents_loader_fails_when_first_page_has_no_tables(self):
        page_one_html = "<html><span class=\"page_info\">1 / 1</span><div>empty</div></html>"

        with patch(
            "app.services.akshare_adapter._fetch_ths_concept_detail_html",
            return_value=page_one_html,
        ):
            with pytest.raises(Exception, match="No tables found"):
                AkShareAdapter.get_concept_constituents_frame(
                    "算力租赁",
                    concept_code="309068",
                )

    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_a_share_spot_frame_falls_back_to_sina_with_partial_metadata(
        self,
        mock_em_spot,
        mock_sina_spot,
    ):
        mock_em_spot.side_effect = Exception("em down")
        mock_sina_spot.return_value = pd.DataFrame(
            {
                "代码": ["sh600519"],
                "名称": ["贵州茅台"],
                "最新价": [1678.0],
                "涨跌额": [10.0],
                "涨跌幅": [0.6],
                "买入": [1677.0],
                "卖出": [1678.0],
                "昨收": [1668.0],
                "今开": [1670.0],
                "最高": [1680.0],
                "最低": [1665.0],
                "成交量": [1000.0],
                "成交额": [500000.0],
                "时间戳": ["15:00:00"],
            }
        )

        frame = AkShareAdapter.get_a_share_spot_frame()

        assert frame.iloc[0]["代码"] == "600519"
        assert frame.attrs["data_quality"] == "partial"
        assert "spot_snapshot_sina_fallback" in frame.attrs["warnings"]

    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_a_share_spot_frame_suppresses_sina_stdout_noise(
        self,
        mock_em_spot,
        mock_sina_spot,
        capsys,
    ):
        mock_em_spot.side_effect = Exception("em down")

        def noisy_sina() -> pd.DataFrame:
            print("Please wait for a moment")
            return pd.DataFrame(
                {
                    "代码": ["sh600519"],
                    "名称": ["贵州茅台"],
                    "现价": [1678.0],
                }
            )

        mock_sina_spot.side_effect = noisy_sina

        frame = AkShareAdapter.get_a_share_spot_frame()
        captured = capsys.readouterr()

        assert frame.iloc[0]["代码"] == "600519"
        assert captured.out == ""
        assert captured.err == ""

    @patch.object(AkShareAdapter, "get_latest_financial_snapshot_frame")
    @patch.object(AkShareAdapter, "get_stock_code_name_frame")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_stocks_by_codes_builds_partial_snapshot_when_full_sources_fail(
        self,
        mock_em_spot,
        mock_sina_spot,
        mock_code_frame,
        mock_financial_snapshot,
    ):
        mock_em_spot.side_effect = Exception("em down")
        mock_sina_spot.side_effect = Exception("sina down")
        mock_code_frame.return_value = pd.DataFrame(
            {
                "code": ["600519"],
                "name": ["贵州茅台"],
            }
        )
        mock_financial_snapshot.return_value = pd.DataFrame(
            {
                "股票代码": ["600519"],
                "所处行业": ["白酒"],
                "净资产收益率": [28.0],
                "每股收益": [52.1],
                "营业总收入-营业总收入": [1500.0],
                "净利润-净利润": [700.0],
            }
        )

        stocks = AkShareAdapter.get_stocks_by_codes(["600519"])

        assert len(stocks) == 1
        assert stocks[0]["code"] == "600519"
        assert stocks[0]["name"] == "贵州茅台"
        assert stocks[0]["industry"] == "白酒"
        assert stocks[0]["pe"] is None
        assert stocks[0]["pb"] is None
        assert stocks[0]["roe"] == 28.0
        assert stocks[0]["dataQuality"] == "partial"
        assert stocks[0]["warnings"] == ["spot_snapshot_partial"]

    @patch("app.services.akshare_adapter.ak.stock_yjbb_em")
    @patch("app.services.akshare_adapter.ak.stock_zh_a_spot_em")
    def test_get_stocks_by_codes_marks_partial_when_financial_snapshot_unavailable(
        self,
        mock_spot,
        mock_yjbb,
    ):
        mock_spot.return_value = pd.DataFrame(
            {
                "代码": ["600519"],
                "名称": ["贵州茅台"],
                "市盈率-动态": [35.5],
                "市净率": [10.2],
                "总市值": [21000.0],
                "流通市值": [20500.0],
                "换手率": [0.9],
                "涨跌幅": [1.5],
            }
        )
        mock_yjbb.side_effect = Exception("financial down")

        stocks = AkShareAdapter.get_stocks_by_codes(["600519"])

        assert len(stocks) == 1
        assert stocks[0]["dataQuality"] == "partial"
        assert "financial_snapshot_unavailable" in stocks[0]["warnings"]
