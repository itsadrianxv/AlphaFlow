from fastapi.testclient import TestClient

from app.contracts.intelligence import ConfidenceCheckRequest
from app.main import app
from app.services.confidence_analysis_service import ConfidenceAnalysisService

client = TestClient(app)


def _request_payload(response_text: str, reference_excerpt: str):
    return {
        "module": "company_research",
        "question": "How credible is the conclusion?",
        "responseText": response_text,
        "referenceItems": [
            {
                "id": "ref-1",
                "title": "Quarterly filing",
                "sourceName": "official filing",
                "excerpt": reference_excerpt,
                "publishedAt": "2026-03-01T00:00:00+00:00",
                "sourceType": "official",
                "credibilityScore": 0.9,
            },
            {
                "id": "ref-2",
                "title": "Newswire",
                "sourceName": "newswire",
                "excerpt": reference_excerpt,
                "publishedAt": "2026-03-05T00:00:00+00:00",
                "sourceType": "news",
            },
        ],
    }


def test_confidence_service_supported_claim_returns_high_score():
    service = ConfidenceAnalysisService()
    analysis = service.check(
        request=ConfidenceCheckRequest(
            **_request_payload(
                "Revenue increased to 20%.",
                "The filing states revenue increased to 20% this quarter.",
            )
        )
    )

    assert analysis.status == "PARTIAL"
    assert analysis.finalScore == 100
    assert analysis.supportedCount == 1
    assert analysis.contradictedCount == 0


def test_confidence_service_contradicted_claim_returns_low_score():
    service = ConfidenceAnalysisService()
    analysis = service.check(
        request=ConfidenceCheckRequest(
            **_request_payload(
                "Revenue increased to 20%.",
                "The filing states revenue increased to 10% this quarter.",
            )
        )
    )

    assert analysis.contradictedCount == 1
    assert analysis.finalScore == 0


def test_confidence_service_without_references_is_unavailable():
    service = ConfidenceAnalysisService()
    analysis = service.check(
        request=ConfidenceCheckRequest(
            module="quick_research",
            responseText="This is a conclusion.",
            referenceItems=[],
        )
    )

    assert analysis.status == "UNAVAILABLE"
    assert analysis.finalScore is None


def test_confidence_check_endpoint_returns_analysis():
    response = client.post(
        "/api/intelligence/confidence/check",
        json=_request_payload(
            "Revenue increased to 20%.",
            "The filing states revenue increased to 20% this quarter.",
        ),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["supportedCount"] == 1
    assert payload["finalScore"] == 100


def test_confidence_check_batch_endpoint_returns_items():
    response = client.post(
        "/api/intelligence/confidence/check-batch",
        json={
            "items": [
                _request_payload(
                    "Revenue increased to 20%.",
                    "The filing states revenue increased to 20% this quarter.",
                ),
                _request_payload(
                    "Revenue increased to 20%.",
                    "The filing states revenue increased to 10% this quarter.",
                ),
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 2
    assert payload["items"][0]["supportedCount"] == 1
    assert payload["items"][1]["contradictedCount"] == 1
