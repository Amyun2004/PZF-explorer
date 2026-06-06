"""
Vercel Python serverless function:  POST /api/compute
Body: { "n": int, "edges": [[u,v],...], "seed": [int,...],
        "mode": "exact" | "montecarlo", "trials": int }
Returns the PZF pattern-DAG + expected-steps data as JSON.
"""

import os
import sys
import json
from http.server import BaseHTTPRequestHandler

# make the sibling engine module importable on Vercel
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _engine  # noqa: E402


def _run(body):
    try:
        data = json.loads(body or "{}")
    except Exception:
        return {"ok": False, "error": "Invalid JSON in request body."}
    try:
        n = int(data.get("n", 0))
        edges = [[int(a), int(b)] for a, b in data.get("edges", [])]
        seed = list(data.get("seed", []))
        mode = data.get("mode", "exact")
        trials = int(data.get("trials", 2000))
        return _engine.compute_graph(n, edges, seed, mode=mode, trials=trials)
    except Exception as exc:  # never 500 on bad input; report it
        return {"ok": False, "error": f"Computation failed: {exc}"}


class handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
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
        length = int(self.headers.get("content-length", 0) or 0)
        body = self.rfile.read(length).decode("utf-8") if length else ""
        self._send(200, _run(body))

    def do_GET(self):
        self._send(200, {"ok": True, "service": "pzf-compute",
                         "usage": "POST { n, edges, seed }"})

    def log_message(self, *args):
        pass
