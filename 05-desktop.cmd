@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Building dependencies. Internet connection is required...
  call npm.cmd ci --no-fund --no-audit
  if errorlevel 1 goto failed
  node node_modules\electron\install.js
  if errorlevel 1 goto failed
)
node scripts\preflight.js
if errorlevel 1 goto failed
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
:failed
pause
exit /b 1
