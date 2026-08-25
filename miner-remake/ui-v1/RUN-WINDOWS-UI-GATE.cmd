@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN-WINDOWS-UI-GATE.ps1"
if errorlevel 1 (
  echo.
  echo 실행에 실패했습니다. 위 오류를 확인하세요.
  pause
)
endlocal
