@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "CANDIDATE=%~dp0SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-R5-win-x64.zip"
set "TOOLS=%~dp0r5-builder-tools"
set "OUTPUT=%~dp0final-gate-output-r5"
set "EXPECTED=728a60445253a8798bb65d578e2192222d4cffcce61d22a3b2192f7fc2612ee5"
set "COMMIT=7791eb054d6334d9c4c7c9fb27795b63b4e59ec5"

rem Do not rely on PATH for Windows PowerShell. Some user environments omit it.
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo [FAIL] Windows PowerShell 5.1 executable was not found.
  echo Checked System32 and Sysnative WindowsPowerShell paths.
  pause
  exit /b 1
)

echo Using Windows PowerShell: %PS%

if not exist "%CANDIDATE%" (
  echo [FAIL] R5 candidate ZIP not found next to this CMD.
  echo Expected: %CANDIDATE%
  pause
  exit /b 1
)

"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p='%CANDIDATE%'; $e='%EXPECTED%'; $a=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant(); if($a -ne $e){throw ('R5 candidate SHA-256 mismatch. expected='+$e+' actual='+$a)}; Write-Host ('PASS R5 candidate SHA-256 '+$a)"
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist "%TOOLS%" mkdir "%TOOLS%"

"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $base='https://raw.githubusercontent.com/SD608/sd-center/%COMMIT%/tools/'; $dst='%TOOLS%'; $files=@('run-v024-final-installer-r5-local.ps1','run-v024-final-installer-local.ps1','build-v024-final-installer.js','test-extension-update-trust-bootstrap.js','test-offline-ui-state-v024.js'); foreach($f in $files){$u=$base+$f; $o=Join-Path $dst $f; Write-Host ('Downloading pinned builder source: '+$f); Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $o}; Write-Host 'PASS pinned R5 builder sources downloaded'"
if errorlevel 1 (
  echo [FAIL] Could not download the pinned R5 builder scripts.
  pause
  exit /b 1
)

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%TOOLS%\run-v024-final-installer-r5-local.ps1" -CandidateZip "%CANDIDATE%" -InstallerVersion "2.2.8" -OutputDir "%OUTPUT%"
if errorlevel 1 (
  echo.
  echo [FAIL] R5 Final Gate installer build failed.
  pause
  exit /b 1
)

echo.
echo [PASS] R5 blocked Final Gate installer build completed.
echo Output: %OUTPUT%
echo Do NOT publish yet. Physical Windows offline/reconnect smoke is still required.
pause
exit /b 0
