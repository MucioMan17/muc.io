@echo off
setlocal EnableDelayedExpansion
title muc.io — Update and Launch
color 0A

echo.
echo  ================================================
echo    muc.io  ^|  Investigation Toolkit
echo  ================================================
echo.

REM Always run from this script's own directory
cd /d "%~dp0"

REM ── Prerequisite checks ──────────────────────────────────────────────────

git --version >nul 2>&1
if errorlevel 1 (
    echo  [!]  Git is not installed.
    echo       Download from: https://git-scm.com/
    echo.
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo  [!]  Node.js is not installed.
    echo       Download from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM ── Pull latest updates ──────────────────────────────────────────────────

echo  [1/3]  Pulling latest updates...
echo.
git pull origin claude/predator-investigation-support-xd2lk6 2>&1
if errorlevel 1 (
    echo.
    echo  [~]  Could not pull updates ^(offline or up to date^).
    echo       Starting with local files.
)

echo.

REM ── Install / update dependencies ────────────────────────────────────────

echo  [2/3]  Checking dependencies...
echo.
npm install --prefer-offline 2>&1
if errorlevel 1 (
    echo.
    echo  [!]  npm install failed. See error above.
    pause
    exit /b 1
)

echo.

REM ── Launch ───────────────────────────────────────────────────────────────

echo  [3/3]  Starting muc.io...
echo.
echo  ┌─────────────────────────────────────────────┐
echo  │                                             │
echo  │   Open in browser:  http://localhost:3000   │
echo  │                                             │
echo  │   Close this window to stop the server.     │
echo  │                                             │
echo  └─────────────────────────────────────────────┘
echo.

REM Open browser after a 2-second delay (runs in background so it doesn't
REM block the server window, which stays open and shows live logs).
start /min cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

npm start

REM If the server exits on its own, pause so the user can read any error.
echo.
echo  Server stopped.
pause
