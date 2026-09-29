#!/usr/bin/env bash
# Local preview only (no-cache static server on 127.0.0.1:3110, registered in PORTS.md).
set -euo pipefail
exec python3 "$(dirname "$0")/serve.py"
