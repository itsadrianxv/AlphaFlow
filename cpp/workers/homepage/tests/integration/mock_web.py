from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time


_attempts: dict[str, int] = {}
_lock = threading.Lock()


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
        task_id = self.path.rsplit("/", 1)[-1]
        with _lock:
            attempt = _attempts.get(task_id, 0)
            _attempts[task_id] = attempt + 1
        if "delay" in task_id and attempt == 0:
            time.sleep(6)
        if "retry" in task_id and attempt == 0:
            self.write_json(500, {"message": "temporary"})
            return
        if "obsolete" in task_id:
            self.write_json(409, {"message": "偏好指纹已过期"})
            return
        self.write_json(200, {"payload": {"taskId": task_id}, "dataAsOf": "2026-08-01"})

    def log_message(self, *_args: object) -> None:
        return


ThreadingHTTPServer(("0.0.0.0", 3001), Handler).serve_forever()
