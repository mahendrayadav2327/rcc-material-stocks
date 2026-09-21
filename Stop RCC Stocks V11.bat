@echo off
title RCC Stocks V11 - Stop
cd /d "%~dp0"
docker compose stop
echo.
echo RCC Stocks V11 stopped.
echo Database volume was NOT deleted.
pause
