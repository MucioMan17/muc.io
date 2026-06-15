@echo off
setlocal EnableDelayedExpansion
title muc.io - Update and Launch
color 0A

:: This wrapper ensures the window NEVER closes automatically --
:: every exit path ends at the final pause so you can always read errors.

echo.
echo  ================================================
echo    muc.io  ^|  Investigation Toolkit
echo  ================================================
echo.

REM Always run from this script's own directory
cd /d "%~dp0"
echo  Working folder: %CD%
echo.

REM -- Prerequisite checks --

echo  Checking for Git...
git --version 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Git is not installed.
    echo  Download from: https://git-scm.com/
    echo.
    goto :DONE
)

echo.
echo  Checking for Node.js...
node --version 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js is not installed.
    echo  Download from: https://nodejs.org/
    echo.
    goto :DONE
)

echo.
echo  ------------------------------------------------

REM -- Pull latest updates --

echo  [1/3]  Pulling latest updates...
echo.
git pull origin claude/predator-investigation-support-xd2lk6 2>&1
if errorlevel 1 (
    echo.
    echo  [~] Could not pull updates. Starting with local files.
)

echo.
echo  ------------------------------------------------

REM -- Install / update dependencies --

echo  [2/3]  Installing dependencies...
echo.
npm install 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] npm install failed. See error above.
    echo.
    goto :DONE
)

echo.
echo  ------------------------------------------------

REM -- Launch --

echo  [3/3]  Starting server...
echo.
echo  +---------------------------------------------+
echo  ^|                                             ^|
echo  ^|   Browser opening: http://localhost:3000    ^|
echo  ^|                                             ^|
echo  ^|   Keep this window open while you work.     ^|
echo  ^|   Close it when you are done.               ^|
echo  ^|                                             ^|
echo  +---------------------------------------------+
echo.

REM Open browser after 3 seconds (runs in background)
start /min cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

REM Start the server -- this line blocks until the server stops
npm start 2>&1

echo.
echo  ------------------------------------------------
echo  Server stopped. If you saw an error above,
echo  take a screenshot and send it for help.
echo.

:DONE
echo  Press any key to close this window...
pause >nul
