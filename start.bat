@echo off
chcp 65001 >nul
title in-net API Relay

cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════════════════╗
echo   ║     in-net — API Relay Proxy           ║
echo   ╚══════════════════════════════════════════╝
echo.
echo   Starting proxy server...
echo.

:: Set your config here
set IN_NET_API_KEY=sk-nD53AQHuRyf11BQ8McnaCPtEL67J9lpM4AwbvVNJtNQnOAw0
set IN_NET_PORT=8787
set IN_NET_ADMIN_PASSWORD=123456

:: Kill any existing instance on the same port
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%IN_NET_PORT% " ^| findstr "LISTENING"') do (
    echo   Stopping old server on port %IN_NET_PORT%...
    taskkill /f /pid %%a >nul 2>&1
)

:: Start the server
npx tsx src/index.ts

:: If server exits, wait so user can see errors
echo.
echo   Server stopped. Press any key to close...
pause >nul
