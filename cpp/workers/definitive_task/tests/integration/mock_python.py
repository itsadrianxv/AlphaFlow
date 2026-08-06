from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time


_attempts: dict[str, int] = {}
_attempts_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _write_json(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self) -> None:  # noqa: N802
        self._write_json(200 if self.path == "/health" else 404, {"status": "healthy"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/v1/definitive-scheduled-tasks/execute":
            self._write_json(404, {"message": "not found"})
            return
        request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        execution_id = request["executionId"]
        plan = request.get("executionPlan", {})
        with _attempts_lock:
            attempt = _attempts.get(execution_id, 0)
            _attempts[execution_id] = attempt + 1

        delays = plan.get("mockDelaySequenceMs", [plan.get("delayMs", 0)])
        time.sleep(int(delays[min(attempt, len(delays) - 1)]) / 1000)
        statuses = plan.get("mockStatusSequence", [200])
        status = int(statuses[min(attempt, len(statuses) - 1)])
        if status != 200:
            self._write_json(status, {"code": f"FIXTURE_{status}", "message": "fixture error", "retryable": status >= 500})
            return

        rule_results = {
            "macd_positive": {
                "status": "MATCHED",
                "awardedDelta": 15,
                "configuredDelta": 15,
                "observations": {"daily.macd.histogram": {"current": 1.2}},
            }
        }
        self._write_json(200, {
            "executionId": execution_id,
            "status": "SUCCEEDED",
            "asOfDate": "2026-07-29",
            "universeCount": 2,
            "evaluatedCount": 2,
            "selectedCount": 2,
            "rules": [{"id": "macd_positive", "name": "MACD 柱为正", "scoreDelta": 15}],
            "results": [
                {"stockCode": "600519", "stockName": "贵州茅台", "rank": 1, "selected": True, "evaluationStatus": "FULL", "score": 15, "minimumPossibleScore": 0, "maximumPossibleScore": 15, "ruleResults": rule_results},
                {"stockCode": "000001", "stockName": "平安银行", "rank": 2, "selected": True, "evaluationStatus": "FULL", "score": 15, "minimumPossibleScore": 0, "maximumPossibleScore": 15, "ruleResults": rule_results},
            ],
            "warnings": [],
            "diagnostics": {"provider": "fixture"},
        })

    def log_message(self, *_args: object) -> None:
        return


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
