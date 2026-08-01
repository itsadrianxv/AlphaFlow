from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time


_attempts: dict[str, int] = {}
_attempts_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _write(self, encoded: bytes) -> None:
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_HEAD(self) -> None:  # noqa: N802
        self.send_response(200 if self.path == "/health" else 404)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200 if self.path == "/health" else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"healthy"}')

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/v1/screening/execute-run":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        request = json.loads(body)
        run_id = request["runId"]
        config = request.get("config", {})
        with _attempts_lock:
            attempt = _attempts.get(run_id, 0)
            _attempts[run_id] = attempt + 1

        delay_sequence = config.get("mockDelaySequenceMs", [])
        delay_ms = int(
            delay_sequence[min(attempt, len(delay_sequence) - 1)]
            if delay_sequence
            else config.get("delayMs", 0)
        )
        if delay_ms > 0:
            time.sleep(delay_ms / 1000)

        status_sequence = config.get("mockStatusSequence", [200])
        status = int(status_sequence[min(attempt, len(status_sequence) - 1)])
        if status != 200:
            encoded = json.dumps({"error": f"fixture HTTP {status}"}).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self._write(encoded)
            return

        response = {
            "runId": run_id,
            "status": "SUCCEEDED",
            "universeCount": 5531,
            "totalCount": 2,
            "results": [
                {"stockCode": "600519", "rank": 1},
                {"stockCode": "000001", "rank": 2},
            ],
            "warnings": [],
            "diagnostics": {"provider": "fixture"},
        }
        encoded = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self._write(encoded)

    def log_message(self, *_args: object) -> None:
        return


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
