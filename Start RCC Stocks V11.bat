@echo off
title RCC Stocks V11 - Start
cd /d "%~dp0"
echo.
echo ==========================================
echo       RCC STOCKS V11 - STARTING
echo ==========================================
echo.
where docker >nul 2>&1
if errorlevel 1 (
  echo ERROR: Docker command was not found.
  echo Please install/open Docker Desktop.
  pause
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo ERROR: Docker Desktop is not running.
  echo Open Docker Desktop and wait until it is ready.
  pause
  exit /b 1
)
echo Starting RCC Stocks V11...
echo No Windows data-folder sharing is required.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Startup failed. Do not delete any Docker volumes.
  echo Send me a screenshot of this window.
  pause
  exit /b 1
)
echo.
echo RCC Stocks V11 is running at http://localhost:3000
echo Opening browser...
start "" http://localhost:3000
echo.
echo Username: admin
echo Password: Admin@123
echo.
pause
