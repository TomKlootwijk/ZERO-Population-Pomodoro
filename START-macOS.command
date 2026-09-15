#!/bin/bash
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  python3 server.py
else
  echo 'Python 3.9+ was not found. Opening the offline-capable browser version.'
  open index.html
fi
