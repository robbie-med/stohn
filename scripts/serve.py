#!/usr/bin/env python3
"""Local preview server: static files with caching disabled, loopback only.
Port 3110 is registered to stohn in /home/user/Projects/PORTS.md."""
import functools
import http.server
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCache, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", 3110), handler) as httpd:
        print("First Stone preview on http://127.0.0.1:3110")
        httpd.serve_forever()
