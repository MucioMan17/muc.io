@echo off
setlocal EnableDelayedExpansion
title muc.io - Update and Launch
color 0A

:: This window NEVER closes on its own. Every path ends at :DONE with a
:: pause, so you can always read what happened. The server is started with
:: node.exe directly (not "npm start") because calling npm -- which is a
:: batch wrapper -- from inside this script can make the window close on its
:: own. node.exe is a real program, so control always returns here.

echo.
echo  ================================================
echo    muc.io  ^|  Investigation Toolkit
echo  ================================================
echo.

REM Always run from this script's own folder
cd /d "%~dp0"
echo  Working folder: %CD%
echo.

REM -- Prerequisite checks --

echo  Checking for Git...
git --version 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Git is not installed.  Download from: https://git-scm.com/
    goto :DONE
)

echo.
echo  Checking for Node.js...
node --version 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js is not installed.  Download from: https://nodejs.org/
    goto :DONE
)

echo.
echo  ------------------------------------------------
echo  [1/3]  Pulling latest updates...
echo.
call git pull origin claude/predator-investigation-support-xd2lk6 2>&1
if errorlevel 1 (
    echo.
    echo  [~] Could not pull updates. Starting with the files you have.
)

echo.
echo  ------------------------------------------------
echo  [2/3]  Installing dependencies...
echo.
call npm install 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] npm install failed. See the messages above.
    goto :DONE
)

echo.
echo  ------------------------------------------------
echo  [3/3]  Starting server...
echo.
echo   Browser will open at:  http://localhost:3000
echo   Keep THIS window open while you work.
echo   Close it when you are done.
echo  ------------------------------------------------
echo.

REM Open the browser a few seconds after the server boots (separate process)
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

REM Run the server directly with node.exe. This line blocks while the server
REM runs, and returns here if it ever stops -- the window stays open either way.
node server.js
set EXITCODE=%errorlevel%

echo.
echo  ------------------------------------------------
echo  Server stopped (exit code %EXITCODE%).
echo  If you see an error above, take a screenshot and send it for help.
echo.

:DONE
echo.
echo  Press any key to close this window...
pause >nul
