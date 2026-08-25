@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "INDEX=%ROOT%index.html"

if not exist "%INDEX%" (
  echo [FAIL] index.html을 찾을 수 없습니다.
  pause
  exit /b 1
)

set "EDGE="
if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if defined ProgramFiles if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE (
  for /f "delims=" %%E in ('where msedge.exe 2^>nul') do if not defined EDGE set "EDGE=%%~fE"
)

if not defined EDGE (
  echo [FAIL] Microsoft Edge를 찾을 수 없습니다.
  echo Edge가 설치되어 있는지 확인하세요.
  pause
  exit /b 2
)

set "URI=file:///%INDEX:\=/%"
set "URI=%URI%?demo=1"

echo SD광부 4막 5장 Windows UI Gate 후보를 엽니다.
echo 현재 Windows 디스플레이 배율에서 작업장/광산을 확인하세요.
echo 이 후보는 demo 전용이며 Core/지갑/경제 데이터를 변경하지 않습니다.

if defined SD_UI_GATE_VALIDATE_ONLY (
  echo [PASS] CMD launcher validation complete.
  echo Edge: %EDGE%
  echo URI: %URI%
  exit /b 0
)

start "" "%EDGE%" --app="%URI%" --start-maximized --no-first-run --disable-features=msEdgeSidebarV2
if errorlevel 1 (
  echo.
  echo [FAIL] Microsoft Edge 실행에 실패했습니다.
  pause
  exit /b 3
)

exit /b 0
