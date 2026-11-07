@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12+ from https://nodejs.org/ and try again.
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22 ? 0 : a===22 ? b>=12 ? 0 : 1 : 1)"
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Download: https://nodejs.org/
  exit /b 1
)
if not exist "node_modules\.package-lock.json" (
  echo Installing dependencies. Internet connection is required...
  call npm.cmd ci --no-fund --no-audit
  if errorlevel 1 exit /b 1
)
node src\index.js %*
exit /b %errorlevel%
