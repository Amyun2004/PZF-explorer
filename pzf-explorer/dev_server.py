"""
Local development server (standard library only) — mirrors the Vercel setup.

    python dev_server.py            # then open http://localhost:8000

Serves the static frontend AND handles POST /api/compute using the same
engine the Vercel function uses, so local behavior matches production.
"""

import os
import sys
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "api"))
import _engine  # noqa: E402

PORT = int(os.environ.get("PORT", 8000))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") != "/api/compute":
            self._json(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("content-length", 0) or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            data = json.loads(raw)
            n = int(data.get("n", 0))
            edges = [[int(a), int(b)] for a, b in data.get("edges", [])]
            seed = list(data.get("seed", []))
            mode = data.get("mode", "exact")
            trials = int(data.get("trials", 2000))
            self._json(200, _engine.compute_graph(n, edges, seed, mode=mode, trials=trials))
        except Exception as exc:
            self._json(200, {"ok": False, "error": f"Computation failed: {exc}"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"PZF Explorer dev server  ->  http://localhost:{PORT}")
    print("Ctrl-C to stop.")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
