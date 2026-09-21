@echo off
title RCC Stocks V11 - Restart
cd /d "%~dp0"
docker compose restart
if errorlevel 1 (
 echo Restart failed. Send screenshot.
 pause
 exit /b 1
)
start "" http://localhost:3000
pause
