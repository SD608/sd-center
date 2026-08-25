$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexPath = Join-Path $root 'index.html'

if (-not (Test-Path -LiteralPath $indexPath)) {
  Write-Host '[FAIL] index.html을 찾을 수 없습니다.' -ForegroundColor Red
  exit 1
}

$edgeCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not $edgeCandidates -or $edgeCandidates.Count -eq 0) {
  Write-Host '[FAIL] Microsoft Edge를 찾을 수 없습니다.' -ForegroundColor Red
  exit 2
}

$edge = $edgeCandidates[0]
$uri = ([System.Uri]::new($indexPath)).AbsoluteUri + '?demo=1'

Write-Host 'SD광부 4막 5장 Windows UI Gate 후보를 엽니다.' -ForegroundColor Cyan
Write-Host '현재 Windows 디스플레이 배율에서 작업장/광산을 확인하세요.'
Write-Host '이 후보는 demo 전용이며 Core/지갑/경제 데이터를 변경하지 않습니다.' -ForegroundColor Yellow

Start-Process -FilePath $edge -ArgumentList @(
  "--app=$uri",
  '--start-maximized',
  '--no-first-run',
  '--disable-features=msEdgeSidebarV2'
)
