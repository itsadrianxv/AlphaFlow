from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


attempts: dict[str, int] = {}


def _success(attempt_id: str) -> dict:
    return {
        "contractVersion": "1.0",
        "datasetKey": "fixture",
        "providerKey": "test",
        "datasetPayloadVersion": "1.0",
        "normalizationRulesVersion": "1.0",
        "resultStatus": "success",
        "qualityStatus": "normal",
        "coverage": {"requestedScope": {"tradeDate": "2026-08-01"}, "coveredScope": {"tradeDate": "2026-08-01"}, "missingScope": {}},
        "actualDataCutoff": {"key": "trade_date", "value": "2026-08-01"},
        "observations": [
            {
                "identityKey": f"obs-{attempt_id}",
                "canonicalizationVersion": "jcs-1",
                "subjectType": "stock",
                "subjectKey": "600000.SH",
                "metricCatalogId": "close",
                "dimensions": {},
                "observationKind": "INSTANT",
                "observationPeriod": {"date": "2026-08-01"},
                "valueType": "decimal",
                "valueText": "10.50",
                "unit": "CNY",
                "qualityStatus": "normal",
            }
        ],
        "sourceAssertions": [
            {
                "assertionKey": f"assertion-{attempt_id}",
                "canonicalizationVersion": "jcs-1",
                "sourceKey": "test",
                "datasetKey": "fixture",
                "sourceRecordKey": "row-1",
                "observationIdentityKey": f"obs-{attempt_id}",
                "rawRecord": {"close": "10.50"},
                "contentHash": "sha256:content",
                "requestParamsHash": "sha256:request",
                "providerVersion": "1.0",
                "fetchedAt": "2026-08-01T01:00:00Z",
            }
        ],
        "authority": {"strategyVersion": "authority-1", "selectedSourceKey": "test", "selectionReason": "测试"},
        "normalizedAt": "2026-08-01T01:00:00Z",
        "resultHash": f"sha256:{attempt_id}",
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status":"healthy"}')

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        attempt_id = payload.get("attemptId", "unknown")
        attempts[attempt_id] = attempts.get(attempt_id, 0) + 1

        if attempt_id == "retry-then-success" and attempts[attempt_id] == 1:
            body = {"code": "rate_limited", "message": "限流", "retryable": True}
            self.send_response(429)
        elif attempt_id == "terminal-error":
            body = {
                "contractVersion": "1.0",
                "datasetKey": "fixture",
                "providerKey": "test",
                "resultStatus": "error",
                "qualityStatus": "isolated",
                "errors": [{"errorClass": "contract_incompatible", "retryability": "non_retryable", "message": "版本不兼容"}],
            }
            self.send_response(200)
        elif attempt_id == "delay":
            time.sleep(8)
            body = _success(attempt_id)
            self.send_response(200)
        else:
            body = _success(attempt_id)
            self.send_response(200)
        encoded = json.dumps(body).encode()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


HTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
