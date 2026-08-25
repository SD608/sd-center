@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT=%~dp0"
set "GATE=%ROOT%WINDOWS-UI-GATE.html"
if exist "%GATE%" goto gate_ok
echo [FAIL] WINDOWS-UI-GATE.html을 찾을 수 없습니다.
pause
exit /b 1

:gate_ok
set "EDGE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE for /f "delims=" %%E in ('where msedge.exe 2^>nul') do if not defined EDGE set "EDGE=%%~fE"
if defined EDGE goto edge_ok
echo [FAIL] Microsoft Edge를 찾을 수 없습니다.
echo Edge가 설치되어 있는지 확인하세요.
pause
exit /b 2

:edge_ok
echo SD광부 4막 5장 Windows UI Gate 후보를 엽니다.
echo 현재 Windows 디스플레이 배율에서 작업장/광산을 확인하세요.
echo 이 후보는 demo 전용이며 Core/지갑/경제 데이터를 변경하지 않습니다.

if defined SD_UI_GATE_VALIDATE_ONLY goto validate_only
if defined SD_UI_GATE_E2E goto launch_e2e
goto launch_user

:validate_only
echo [PASS] CMD launcher validation complete.
echo Gate: "%GATE%"
exit /b 0

:launch_user
start "" "%EDGE%" --new-window --start-maximized --no-first-run "%GATE%"
if not errorlevel 1 exit /b 0
echo [FAIL] Microsoft Edge 실행에 실패했습니다.
pause
exit /b 3

:launch_e2e
set "PORT=%SD_UI_GATE_E2E_PORT%"
if not defined PORT set "PORT=9333"
set "PROFILE=%SD_UI_GATE_USER_DATA%"
if not defined PROFILE set "PROFILE=%TEMP%\SDMiner-UIGate-E2E"
start "" "%EDGE%" --new-window --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run "%GATE%"
if not errorlevel 1 exit /b 0
exit /b 4
