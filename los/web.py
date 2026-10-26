"""The HTTP layer: the standard library's threading server, bound to 127.0.0.1 only. The App decides everything."""
from __future__ import annotations

import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .app import MAX_BODY

DRAIN_LIMIT = 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "LearningOS"
    sys_version = ""

    def _send(self, status: int, headers: dict, body: bytes) -> None:
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _run(self, method: str) -> None:
        app = self.server.app
        headers = {k.lower(): v for k, v in self.headers.items()}
        try:
            length = int(headers.get("content-length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            # refuse without keeping the body: up to 1 MB is read and dropped, so the client can read the answer;
            # beyond that the connection is closed on it
            bad = length < 0
            if not bad and length <= DRAIN_LIMIT:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        break
                    remaining -= len(chunk)
            status, hdrs, body = app._json(400 if bad else 413,
                                           {"error": "bad length" if bad else "the request is too large"})
            self.close_connection = True
            return self._send(status, hdrs, body)
        body = self.rfile.read(length) if length else b""
        status, hdrs, out = app.handle(method, self.path, headers, body)
        self._send(status, hdrs, out)

    def do_GET(self):
        self._run("GET")

    def do_POST(self):
        self._run("POST")

    def do_PUT(self):
        self._run("PUT")

    def do_DELETE(self):
        self._run("DELETE")

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.log_date_time_string()} {fmt % args}\n")


def make_server(app, host: str, port: int) -> ThreadingHTTPServer:
    if host not in ("127.0.0.1", "localhost"):
        raise ValueError("the Knowledge OS listens on 127.0.0.1 only")
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    srv.app = app
    return srv
