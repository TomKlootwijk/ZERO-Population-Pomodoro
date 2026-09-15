@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 server.py
  goto done
)
where python >nul 2>nul
if not errorlevel 1 (
  python server.py
  goto done
)
echo Python 3.9 or newer is needed for the local feed proxy.
echo Opening the no-install offline-capable browser version instead.
start "" "%~dp0index.html"
:done
pause
