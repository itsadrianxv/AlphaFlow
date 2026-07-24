"""Intelligence routes tests."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_get_theme_news_success():
    mock_payload = [
        {
            "id": "news-1",
            "title": "AI板块景气快照",
            "summary": "板块涨跌幅2.1%",
            "source": "minishare:news",
            "publishedAt": "2026-01-01T00:00:00+00:00",
            "sentiment": "positive",
            "relevanceScore": 0.82,
            "relatedStocks": ["002230"],
        }
    ]

    with patch(
        "app.routers.intelligence_data.IntelligenceDataAdapter.get_theme_news",
        return_value=mock_payload,
    ):
        response = client.get("/api/intelligence/news", params={"theme": "人工智能"})

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == "news-1"


def test_get_candidates_success():
    mock_payload = [
        {
            "stockCode": "002230",
            "stockName": "科大讯飞",
            "reason": "来自概念板块",
            "heat": 81.2,
            "concept": "人工智能",
        }
    ]

    with patch(
        "app.routers.intelligence_data.IntelligenceDataAdapter.get_candidates",
        return_value=mock_payload,
    ):
        response = client.get(
            "/api/intelligence/candidates",
            params={"theme": "人工智能", "limit": 6},
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["stockCode"] == "002230"


def test_match_theme_concepts_success():
    mock_payload = {
        "theme": "算力",
        "matchedBy": "zhipu",
        "concepts": [
            {
                "name": "算力租赁",
                "code": "BK1234",
                "aliases": ["算力服务"],
                "confidence": 0.86,
                "reason": "与主题词语义高度相关",
                "source": "zhipu_web_search",
            }
        ],
    }

    with patch(
        "app.routers.intelligence_data.IntelligenceDataAdapter.match_theme_concepts",
        return_value=mock_payload,
    ):
        response = client.get(
            "/api/intelligence/concepts/match",
            params={"theme": "算力", "limit": 3},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["matchedBy"] == "zhipu"
    assert payload["concepts"][0]["source"] == "zhipu_web_search"


def test_get_concept_rules_success():
    mock_payload = {
        "theme": "算力",
        "whitelist": ["算力租赁"],
        "blacklist": ["通用云计算"],
        "aliases": ["算力基础设施"],
        "updatedAt": "2026-03-07T00:00:00+00:00",
    }

    with patch(
        "app.routers.intelligence_data.IntelligenceDataAdapter.get_concept_rules",
        return_value=mock_payload,
    ):
        response = client.get("/api/intelligence/concepts/rules", params={"theme": "算力"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["theme"] == "算力"
    assert payload["whitelist"] == ["算力租赁"]


def test_put_concept_rules_success():
    mock_payload = {
        "theme": "算力",
        "whitelist": ["算力租赁"],
        "blacklist": ["通用云计算"],
        "aliases": ["算力基础设施"],
        "updatedAt": "2026-03-07T00:00:00+00:00",
    }

    request_payload = {
        "theme": "算力",
        "whitelist": ["算力租赁"],
        "blacklist": ["通用云计算"],
        "aliases": ["算力基础设施"],
    }

    with patch(
        "app.routers.intelligence_data.IntelligenceDataAdapter.update_concept_rules",
        return_value=mock_payload,
    ):
        response = client.put("/api/intelligence/concepts/rules", json=request_payload)

    assert response.status_code == 200
    payload = response.json()
    assert payload["theme"] == "算力"
    assert payload["blacklist"] == ["通用云计算"]


def test_get_company_evidence_invalid_stock_code():
    response = client.get("/api/intelligence/evidence/invalid")

    assert response.status_code == 400
    assert "无效的股票代码" in response.json()["detail"]


def test_get_company_evidence_batch_invalid_stock_code():
    response = client.post(
        "/api/intelligence/evidence/batch",
        json={
            "stockCodes": ["600519", "invalid"],
            "concept": "白酒",
        },
    )

    assert response.status_code == 400
    assert "存在无效股票代码" in response.json()["detail"]

