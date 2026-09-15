#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22+ with npm is required. See README.md.'
  exit 1
fi
if [ ! -x node_modules/.bin/electron ]; then
  echo 'First launch: installing the Electron runtime from npm. Internet is required.'
  npm install --no-fund --no-audit || exit 1
fi
exec npm start
