@echo off
setlocal
set "URL=http://localhost:3000"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%EDGE%" (
  set "BROWSER=%EDGE%"
  goto make
)
if exist "%CHROME%" (
  set "BROWSER=%CHROME%"
  goto make
)
set "BROWSER=%SystemRoot%\System32\cmd.exe"
:make
powershell -NoProfile -ExecutionPolicy Bypass -Command "$desktop=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'RCC Material Stocks.lnk')); if('%BROWSER%' -like '*cmd.exe'){ $s.TargetPath='%BROWSER%'; $s.Arguments='/c start %URL%' } else { $s.TargetPath='%BROWSER%'; $s.Arguments='--app=%URL%' }; $s.WorkingDirectory=(Split-Path '%BROWSER%'); $s.IconLocation='%BROWSER%,0'; $s.Save()"
echo.
echo RCC Material Stocks desktop shortcut created.
echo Double-click the shortcut to open the app.
pause
