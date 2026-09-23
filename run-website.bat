@echo off
title Honest Hire - Website Server
cd /d "%~dp0"
echo ============================================
echo  Honest Hire - Starting web server...
echo ============================================
echo.
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python was not found on PATH.
  echo Install Python 3 from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  echo.
  echo Fallback: opening index.html directly in your browser...
  start "" "%~dp0index.html"
  pause
  exit /b 1
)
set PORT=8000
python -c "import socket;s=socket.socket();s.settimeout(0.5);r=s.connect_ex(('127.0.0.1',8000));exit(r==0)" >nul 2>nul
if not errorlevel 1 goto :serve
set PORT=8001
python -c "import socket;s=socket.socket();s.settimeout(0.5);r=s.connect_ex(('127.0.0.1',8001));exit(r==0)" >nul 2>nul
if not errorlevel 1 goto :serve
set PORT=8080
:serve
echo Serving this folder at:  http://127.0.0.1:%PORT%/
echo Opening index.html in your browser...
start "" "http://127.0.0.1:%PORT%/index.html"
echo.
echo Keep this window open while you browse. Press Ctrl+C to stop.
echo.
python -m http.server %PORT% --bind 127.0.0.1
pause
