#!/bin/sh
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py
else
  printf '%s\n' 'Python 3.9+ was not found. Open index.html in your browser for offline-capable mode.'
  command -v xdg-open >/dev/null 2>&1 && xdg-open index.html
fi
