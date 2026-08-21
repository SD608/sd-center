@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PROBE_ONLY="
if /I "%~1"=="--probe-only" set "PROBE_ONLY=1"

rem Resolve Node.js without assuming Explorer has refreshed PATH after installation.
set "NODE_EXE="
if defined SDCENTER_NODE_EXE if exist "%SDCENTER_NODE_EXE%" set "NODE_EXE=%SDCENTER_NODE_EXE%"
if defined NODE_EXE goto node_found

for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if defined NODE_EXE goto node_found

if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if defined NODE_EXE goto node_found
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if defined NODE_EXE goto node_found
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE_EXE goto node_found
if exist "%LOCALAPPDATA%\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\nodejs\node.exe"
if defined NODE_EXE goto node_found

echo [ERROR] Node.js 22 or newer was not found.
echo Run ^"where node^" in a new Command Prompt and send the result to ChatGPT.
echo.
if not defined PROBE_ONLY pause
exit /b 2

:node_found
for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
set "PATH=%NODE_DIR%;%PATH%"

rem Do not execute a quoted Program Files path inside FOR /F command substitution.
rem Capture --version to a file first so paths containing spaces are handled safely.
set "NODE_VERSION_FILE=%TEMP%\sdcenter-node-version-%RANDOM%-%RANDOM%.txt"
"%NODE_EXE%" --version > "%NODE_VERSION_FILE%" 2>nul
if errorlevel 1 goto node_exec_fail
set "NODE_VERSION="
set /p NODE_VERSION=<"%NODE_VERSION_FILE%"
del /q "%NODE_VERSION_FILE%" >nul 2>&1
if not defined NODE_VERSION goto node_exec_fail
set "NODE_VERSION=%NODE_VERSION:v=%"
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%M in ("%NODE_VERSION%") do set "NODE_MAJOR=%%M"
if not defined NODE_MAJOR goto node_exec_fail
if %NODE_MAJOR% LSS 22 goto node_too_old

echo [INFO] Using Node.js: %NODE_EXE%
echo [INFO] Node.js version: v%NODE_VERSION%
goto powershell_probe

:node_exec_fail
if exist "%NODE_VERSION_FILE%" del /q "%NODE_VERSION_FILE%" >nul 2>&1
echo [ERROR] Node.js was found but could not be executed:
echo %NODE_EXE%
echo.
if not defined PROBE_ONLY pause
exit /b 2

:node_too_old
echo [ERROR] Node.js 22 or newer is required. Found v%NODE_VERSION%
echo.
if not defined PROBE_ONLY pause
exit /b 2

:powershell_probe
set "PS_EXE="
if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if defined PS_EXE goto powershell_found
for /f "delims=" %%I in ('where powershell.exe 2^>nul') do if not defined PS_EXE set "PS_EXE=%%I"
if defined PS_EXE goto powershell_found
for /f "delims=" %%I in ('where pwsh.exe 2^>nul') do if not defined PS_EXE set "PS_EXE=%%I"
if defined PS_EXE goto powershell_found

echo [ERROR] PowerShell was not found.
echo Checked Windows PowerShell and PowerShell 7.
echo.
if not defined PROBE_ONLY pause
exit /b 3

:powershell_found
echo [INFO] Using PowerShell: %PS_EXE%
if defined PROBE_ONLY (
  echo [PASS] Final Gate launcher dependency probe completed.
  exit /b 0
)

set "CANDIDATE=%~dp0SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-win-x64.zip"
if not exist "%CANDIDATE%" (
  echo [ERROR] Put the exact candidate ZIP in this folder first:
  echo SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-win-x64.zip
  echo.
  pause
  exit /b 1
)

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
