"""Local HTTP server for the flywheel judge browser."""

from __future__ import annotations

import json
import mimetypes
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from flywheel.config import corpus_dir
from flywheel.sqlite_store import LocalStore
from flywheel.web.tree import (
    FOLLOWUPS,
    connect_readonly,
    connect_write,
    load_case,
    load_summary,
    load_tree,
    safe_corpus_file,
    save_followup,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


class JudgeBrowserHandler(SimpleHTTPRequestHandler):
    corpus: Path
    db_path: Path
    _lock = threading.Lock()

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        if self.path.startswith("/api/") or self.path.startswith("/media"):
            super().log_message(format, *args)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/summary":
            self._send_json(self._summary())
            return
        if parsed.path == "/api/tree":
            self._send_json(self._tree())
            return
        if parsed.path.startswith("/api/cases/"):
            rest = unquote(parsed.path[len("/api/cases/") :])
            if rest.endswith("/followup"):
                self.send_error(405, "use POST")
                return
            payload = self._case(rest)
            if payload is None:
                self._send_json({"error": "not_found"}, status=404)
                return
            self._send_json(payload)
            return
        if parsed.path == "/media":
            rel = (parse_qs(parsed.query).get("p") or [""])[0]
            self._send_media(rel)
            return
        if parsed.path in ("/", "/index.html"):
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/cases/") or not parsed.path.endswith("/followup"):
            self.send_error(404, "not found")
            return
        rest = unquote(parsed.path[len("/api/cases/") :])
        case_id = rest[: -len("/followup")].rstrip("/")
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send_json({"error": "invalid_json"}, status=400)
            return
        status = str(body.get("status") or "")
        note = str(body.get("note") or "")
        if status not in FOLLOWUPS:
            self._send_json({"error": "invalid_status", "allowed": list(FOLLOWUPS)}, status=400)
            return
        saved = self._save_followup(case_id, status, note)
        if saved is None:
            self._send_json({"error": "not_found"}, status=404)
            return
        self._send_json(saved)

    def _tree(self) -> dict[str, Any]:
        with self._lock:
            conn = connect_readonly(self.db_path)
            try:
                return load_tree(conn)
            finally:
                conn.close()

    def _summary(self) -> dict[str, Any]:
        return load_summary(self._tree())

    def _case(self, case_id: str) -> dict[str, Any] | None:
        if not case_id:
            return None
        with self._lock:
            conn = connect_readonly(self.db_path)
            try:
                return load_case(conn, case_id, corpus=self.corpus)
            finally:
                conn.close()

    def _save_followup(self, case_id: str, status: str, note: str) -> dict[str, Any] | None:
        if not case_id:
            return None
        with self._lock:
            conn = connect_write(self.db_path)
            try:
                return save_followup(conn, case_id=case_id, status=status, note=note)
            finally:
                conn.close()

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_media(self, rel: str) -> None:
        path = safe_corpus_file(self.corpus, rel)
        if path is None:
            self.send_error(404, "not found")
            return
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(data)


def serve_web(*, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, corpus: Path | None = None) -> None:
    root = corpus or corpus_dir()
    db_path = root / "index.sqlite"
    if not db_path.is_file():
        raise FileNotFoundError(f"missing sqlite index: {db_path}")
    store = LocalStore(db_path)
    store.close()
    JudgeBrowserHandler.corpus = root
    JudgeBrowserHandler.db_path = db_path
    httpd = ThreadingHTTPServer((host, port), JudgeBrowserHandler)
    print(f"flywheel review UI http://{host}:{port}  corpus={root}", flush=True)
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
