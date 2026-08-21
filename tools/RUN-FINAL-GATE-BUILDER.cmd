@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "CANDIDATE=%~dp0SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-win-x64.zip"
if not exist "%CANDIDATE%" (
  echo [ERROR] Put the exact candidate ZIP in this folder first:
  echo SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-win-x64.zip
  echo.
  pause
  exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 22 or newer was not found.
  echo Install Node.js, then run this file again.
  echo.
  pause
  exit /b 2
)

set "PS_EXE="
if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not defined PS_EXE (
  where powershell.exe >nul 2>&1
  if not errorlevel 1 set "PS_EXE=powershell.exe"
)
if not defined PS_EXE (
  where pwsh.exe >nul 2>&1
  if not errorlevel 1 set "PS_EXE=pwsh.exe"
)
if not defined PS_EXE (
  echo [ERROR] PowerShell was not found.
  echo Checked Windows PowerShell and PowerShell 7.
  echo Send this screen to ChatGPT.
  echo.
  pause
  exit /b 3
)

echo [INFO] Using PowerShell: %PS_EXE%
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v024-final-installer-local.ps1" -CandidateZip "%CANDIDATE%" -OutputDir "%~dp0final-gate-output"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [PASS] Final Gate blocked installer build completed.
  echo Output: %~dp0final-gate-output
) else (
  echo [FAIL] Builder exited with code %RC%.
)
pause
exit /b %RC%
