@echo off
title RCC Stocks V11 - Backup
cd /d "%~dp0"
if not exist backups mkdir backups
set "BACKUP=backups\rcc_stocks_backup_%date:~-4%-%date:~3,2%-%date:~0,2%.db"
docker compose exec -T rcc-stocks sh -c "cp /data/rcc_stocks.db /tmp/rcc_stocks_backup.db" >nul 2>&1
if errorlevel 1 (
 echo Backup failed. Make sure RCC Stocks is running.
 pause
 exit /b 1
)
docker cp rcc-stocks-v11:/tmp/rcc_stocks_backup.db "%BACKUP%" >nul 2>&1
if errorlevel 1 (
 echo Backup copy failed.
 pause
 exit /b 1
)
echo Backup created: %BACKUP%
pause
