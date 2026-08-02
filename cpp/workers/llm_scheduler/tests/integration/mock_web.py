from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time


attempts: dict[str, int] = {}
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def write_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self) -> None:  # noqa: N802
        self.write_json(200 if self.path == "/api/health/live" else 404, {"status": "ok"})

    def do_POST(self) -> None:  # noqa: N802
        task_id = self.path.split("/")[-2] if self.path.endswith("/execute") else ""
        if not task_id:
            self.write_json(404, {"code": "NOT_FOUND"})
            return
        with lock:
            attempt = attempts.get(task_id, 0)
            attempts[task_id] = attempt + 1
        if "delay" in task_id and attempt == 0:
            time.sleep(6)
        if "retry" in task_id and attempt == 0:
            self.write_json(503, {"code": "UPSTREAM_BUSY", "message": "temporary"})
            return
        if "terminal" in task_id:
            self.write_json(422, {"code": "INVALID_EVIDENCE", "message": "rejected", "retryable": False})
            return
        self.write_json(
            200,
            {
                "status": "COMPLETED",
                "taskId": task_id,
                "taskType": self.headers.get("X-Alphaflow-Task-Type", "EVENT_ADJUDICATION"),
                "idempotencyKey": self.headers.get("Idempotency-Key", ""),
                "inputHash": self.headers.get("X-Alphaflow-Input-Hash", ""),
                "result": {"decision": "HOLD"},
                "metadata": {"fixtureAttempt": attempt + 1},
            },
        )

    def log_message(self, *_args: object) -> None:
        return


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
