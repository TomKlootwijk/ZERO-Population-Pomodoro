@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer with npm is required. See README.md.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\electron.cmd" (
  echo First launch: installing the Electron runtime from npm. Internet is required.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo Installation failed. Check your internet connection, then try again.
    pause
    exit /b 1
  )
)
call npm start
pause
