"""
股票数据路由测试
测试 FastAPI 路由端点的请求/响应和错误处理
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from app.main import app

client = TestClient(app)


class TestStockDataRoutes:
    """股票数据路由测试类"""

    def test_get_all_stock_codes_success(self):
        """测试获取股票代码列表 - 成功场景"""
        mock_codes = ["600519", "000001", "000002"]

        with patch(
            "app.routers.stock_data.AkShareAdapter.get_all_stock_codes",
            return_value=mock_codes,
        ):
            response = client.get("/api/stocks/codes")

            assert response.status_code == 200
            data = response.json()
            assert "codes" in data
            assert "total" in data
            assert data["codes"] == mock_codes
            assert data["total"] == 3

    def test_get_all_stock_codes_error(self):
        """测试获取股票代码列表 - 错误场景"""
        with patch(
            "app.routers.stock_data.AkShareAdapter.get_all_stock_codes",
            side_effect=Exception("AkShare 连接失败"),
        ):
            response = client.get("/api/stocks/codes")

            assert response.status_code == 500
            assert "获取股票代码列表失败" in response.json()["detail"]

    def test_get_stocks_by_codes_success(self):
        """测试批量查询股票数据 - 成功场景"""
        mock_stocks = [
            {
                "code": "600519",
                "name": "贵州茅台",
                "industry": "白酒",
                "sector": "主板",
                "roe": 0.28,
                "pe": 35.5,
                "pb": 10.2,
                "eps": 50.3,
                "revenue": 1275.5,
                "netProfit": 620.8,
                "debtRatio": 0.25,
                "marketCap": 21000.0,
                "floatMarketCap": 20500.0,
                "dataDate": "2024-01-15",
            }
        ]

        with patch(
            "app.routers.stock_data.AkShareAdapter.get_stocks_by_codes",
            return_value=mock_stocks,
        ):
            response = client.post("/api/stocks/batch", json={"codes": ["600519"]})

            assert response.status_code == 200
            data = response.json()
            assert len(data) == 1
            assert data[0]["code"] == "600519"
            assert data[0]["name"] == "贵州茅台"

    def test_get_stocks_by_codes_invalid_code(self):
        """测试批量查询股票数据 - 无效代码格式"""
        response = client.post("/api/stocks/batch", json={"codes": ["INVALID"]})

        assert response.status_code == 400
        assert "无效的股票代码格式" in response.json()["detail"]

    def test_get_stocks_by_codes_empty_list(self):
        """测试批量查询股票数据 - 空列表"""
        response = client.post("/api/stocks/batch", json={"codes": []})

        assert response.status_code == 422  # Validation error

    def test_get_indicator_history_success(self):
        """测试查询历史指标数据 - 成功场景"""
        mock_history = [
            {"date": "2023-12-31", "value": 0.25, "isEstimated": False},
            {"date": "2023-09-30", "value": 0.24, "isEstimated": False},
        ]

        with patch(
            "app.routers.stock_data.AkShareAdapter.get_indicator_history",
            return_value=mock_history,
        ):
            response = client.get(
                "/api/stocks/600519/history", params={"indicator": "ROE", "years": 3}
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data) == 2
            assert data[0]["date"] == "2023-12-31"
            assert data[0]["value"] == 0.25

    def test_get_indicator_history_invalid_code(self):
        """测试查询历史指标数据 - 无效股票代码"""
        response = client.get(
            "/api/stocks/INVALID/history", params={"indicator": "ROE", "years": 3}
        )

        assert response.status_code == 400
        assert "无效的股票代码格式" in response.json()["detail"]

    def test_get_indicator_history_invalid_indicator(self):
        """测试查询历史指标数据 - 不支持的指标"""
        response = client.get(
            "/api/stocks/600519/history",
            params={"indicator": "INVALID_INDICATOR", "years": 3},
        )

        assert response.status_code == 400
        assert "不支持的指标" in response.json()["detail"]

    def test_get_indicator_history_invalid_years(self):
        """测试查询历史指标数据 - 无效年数"""
        response = client.get(
            "/api/stocks/600519/history", params={"indicator": "ROE", "years": 20}
        )

        assert response.status_code == 422  # Validation error

    def test_get_available_industries_success(self):
        """测试获取行业列表 - 成功场景"""
        mock_industries = ["白酒", "银行", "医药"]

        with patch(
            "app.routers.stock_data.AkShareAdapter.get_available_industries",
            return_value=mock_industries,
        ):
            response = client.get("/api/stocks/industries")

            assert response.status_code == 200
            data = response.json()
            assert "industries" in data
            assert "total" in data
            assert data["industries"] == mock_industries
            assert data["total"] == 3

    def test_get_available_industries_error(self):
        """测试获取行业列表 - 错误场景"""
        with patch(
            "app.routers.stock_data.AkShareAdapter.get_available_industries",
            side_effect=Exception("数据源错误"),
        ):
            response = client.get("/api/stocks/industries")

            assert response.status_code == 500
            assert "获取行业列表失败" in response.json()["detail"]


class TestStockCodeValidation:
    """股票代码验证测试类"""

    def test_valid_stock_codes(self):
        """测试有效的股票代码"""
        from app.routers.stock_data import _is_valid_stock_code

        assert _is_valid_stock_code("600519") is True  # 上海主板
        assert _is_valid_stock_code("000001") is True  # 深圳主板
        assert _is_valid_stock_code("300750") is True  # 创业板

    def test_invalid_stock_codes(self):
        """测试无效的股票代码"""
        from app.routers.stock_data import _is_valid_stock_code

        assert _is_valid_stock_code("12345") is False  # 长度不足
        assert _is_valid_stock_code("1234567") is False  # 长度过长
        assert _is_valid_stock_code("500001") is False  # 不以 0/3/6 开头
        assert _is_valid_stock_code("ABCDEF") is False  # 非数字
        assert _is_valid_stock_code("") is False  # 空字符串
        assert _is_valid_stock_code(123456) is False  # 非字符串类型
