#!/usr/bin/env python3
"""ZERO's localhost-only launcher and narrowly scoped Census proxy. Python 3.9+."""
from __future__ import annotations
import argparse
import json
import math
import mimetypes
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FEED = "https://www.census.gov/popclock/data/population.php/world"
ALLOWED = {"/index.html", "/web/style.css", "/web/app.js", "/web/core.js", "/web/instruments.js", "/web/instrument-view.js", "/web/telemetry.js", "/web/telemetry-view.js", "/web/telemetry.css", "/web/weather.js", "/web/weather-view.js", "/web/weather.css", "/web/live-signal.js", "/web/unified-view.js", "/web/seed.js", "/web/icon.svg", "/data/census-world.json"}
LIMIT = 1_000_000
CACHE_SECONDS = 6 * 60 * 60
_cache: tuple[float, bytes] | None = None
_failure_at = 0.0
_lock = threading.Lock()

class OfficialRedirectsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlparse(newurl)
        if url.scheme != "https" or url.hostname != "www.census.gov":
            raise urllib.error.URLError("Refused an unexpected source redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def validate_feed(payload: bytes) -> None:
    world = json.loads(payload)["world"]
    population, rate = world["population"], world["population_rate"]
    if isinstance(population, bool) or not isinstance(population, (int, float)) or not 1e8 <= population <= 2e10:
        raise ValueError("Invalid population")
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or not -100 <= rate <= 100:
        raise ValueError("Invalid rate")
    if world["rate_interval"] != "second" or not 946684800 <= float(world["last_updated"]) <= 7258118400:
        raise ValueError("Unsupported source metadata")

def census_response() -> bytes:
    global _cache, _failure_at
    with _lock:
        now = time.monotonic()
        if _cache and now - _cache[0] < CACHE_SECONDS:
            return _cache[1]
        if _failure_at and now - _failure_at < 30:
            raise OSError("Recent source failure; short retry backoff is active")
        try:
            request = urllib.request.Request(FEED, headers={"Accept": "application/json", "User-Agent": "ZERO-Population-Widget/1.0"})
            opener = urllib.request.build_opener(OfficialRedirectsOnly)
            with opener.open(request, timeout=8) as response:
                payload = response.read(LIMIT + 1)
                if len(payload) > LIMIT:
                    raise ValueError("Source response is too large")
            validate_feed(payload)
            _cache = (now, payload)
            _failure_at = 0
            return payload
        except Exception:
            _failure_at = now
            raise

class Handler(BaseHTTPRequestHandler):
    server_version = "ZERO/1.0"
    def log_message(self, fmt, *args):
        pass

    def respond(self, status: int, payload: bytes, content_type: str, head: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if not head:
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def serve(self, head: bool = False) -> None:
        port = self.server.server_address[1]
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host", "") not in allowed_hosts:
            self.respond(403, b"Local host only", "text/plain", head)
            return
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in allowed_hosts}:
            self.respond(403, b"Local origin only", "text/plain", head)
            return
        route = urllib.parse.urlparse(self.path).path
        if route == "/api/population":
            try:
                if self.server.offline:
                    raise OSError("Offline mode")
                payload = census_response()
                self.respond(200, payload, "application/json; charset=utf-8", head)
            except Exception:
                self.respond(503, b'{"error":"Census source unavailable. Keep using the bundled or saved estimate."}', "application/json", head)
            return
        if route == "/":
            route = "/index.html"
        if route not in ALLOWED:
            self.respond(404, b"Not found", "text/plain", head)
            return
        try:
            payload = (ROOT / route.lstrip("/")).read_bytes()
            content_type = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".json": "application/json"}.get(Path(route).suffix, "application/octet-stream")
            self.respond(200, payload, content_type + "; charset=utf-8", head)
        except OSError:
            self.respond(404, b"Not found", "text/plain", head)

    def do_GET(self):
        self.serve()

    def do_HEAD(self):
        self.serve(head=True)

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--offline", action="store_true", help="Disable the Census proxy for offline use or tests")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Choose a port between 1024 and 65535")
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as error:
        parser.exit(1, f"Could not bind port {args.port}: {error}\nTry: python server.py --port {min(args.port + 1, 65535)}\n")
    server.daemon_threads = True
    server.offline = args.offline
    url = f"http://127.0.0.1:{args.port}/"
    print(f"\nZERO is ready: {url}\nKeep this terminal open. Press Ctrl+C to stop.\n", flush=True)
    if not args.no_browser:
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nZERO server stopped.")
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
