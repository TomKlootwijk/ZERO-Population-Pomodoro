@echo off
setlocal
cd /d "%~dp0"
call npm ci --no-fund --no-audit
if errorlevel 1 exit /b 1
call npm run package:windows
if errorlevel 1 exit /b 1
powershell -NoProfile -File "%~dp0scripts\install-windows.ps1"
pause
