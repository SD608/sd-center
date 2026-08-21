param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateZip,
  [string]$InstallerVersion = '2.2.8',
  [string]$OutputDir = (Join-Path (Get-Location) 'final-gate-output-r5')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedFilename = 'SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-R5-win-x64.zip'
$ExpectedZipSha256 = '728a60445253a8798bb65d578e2192222d4cffcce61d22a3b2192f7fc2612ee5'
$ExpectedMainSha256 = 'eec3a7ac2ce56e3fd68005d0ed86f766b99c4d37832f03d8729ad5d6d8afb38d'
$BaseR4ZipSha256 = 'a563fe772adff9a9c4ce834c20c6a02c802e8b61da6ff411aa103ec43383448b'
$BaseR2ZipSha256 = '61078f1e6bac7c2cc541d1bc0b13d4b260c9cb431f47fef3fcff796e201a234b'

function Hash([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$candidate = (Resolve-Path -LiteralPath $CandidateZip).Path
if ([IO.Path]::GetFileName($candidate) -ne $ExpectedFilename) {
  throw "R5 candidate filename mismatch. expected=$ExpectedFilename"
}
$actualZip = Hash $candidate
if ($actualZip -ne $ExpectedZipSha256) {
  throw "R5 candidate SHA-256 mismatch. expected=$ExpectedZipSha256 actual=$actualZip"
}

$baseScript = Join-Path $PSScriptRoot 'run-v024-final-installer-local.ps1'
$trustHelper = Join-Path $PSScriptRoot 'test-extension-update-trust-bootstrap.js'
$offlineHelper = Join-Path $PSScriptRoot 'test-offline-ui-state-v024.js'
if (-not (Test-Path -LiteralPath $baseScript -PathType Leaf)) { throw 'Base Final Gate builder script missing.' }
if (-not (Test-Path -LiteralPath $trustHelper -PathType Leaf)) { throw 'Updater trust-bootstrap regression helper missing.' }
if (-not (Test-Path -LiteralPath $offlineHelper -PathType Leaf)) { throw 'Offline UI regression helper missing.' }

$runtimeScript = Join-Path $PSScriptRoot '.run-v024-final-installer-r5-runtime.ps1'
$text = Get-Content -LiteralPath $baseScript -Raw
$text = $text.Replace(
  "`$ExpectedCandidateFilename = 'SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-win-x64.zip'",
  "`$ExpectedCandidateFilename = '$ExpectedFilename'"
)
$text = $text.Replace(
  "`$ExpectedCandidateZipSha256 = '$BaseR2ZipSha256'",
  "`$ExpectedCandidateZipSha256 = '$ExpectedZipSha256'"
)
$text = $text.Replace(
  "`$ExpectedCandidateMainSha256 = '1c5379d171d1226b80e951655bd85e0eb098beb77ba817c49fa1b49f30b32187'",
  "`$ExpectedCandidateMainSha256 = '$ExpectedMainSha256'"
)
$text = $text.Replace(
  "  Write-Host 'Running portable Windows process smoke...'",
  "  Write-Host 'Running R5 extension updater trust-bootstrap regression...'`r`n  Invoke-Node -Arguments @('$trustHelper', (Join-Path `$appRoot 'main.js'))`r`n  Write-Host 'Running R5 offline/remote-failure UI regression...'`r`n  Invoke-Node -Arguments @('$offlineHelper', `$appRoot)`r`n`r`n  Write-Host 'Running portable Windows process smoke...'"
)
$text = $text.Replace(
  "'SDCenter v0.24 Final Gate local installer build'",
  "'SDCenter v0.24 Final Gate R5 local installer build'"
)

foreach ($required in @(
  $ExpectedFilename,
  $ExpectedZipSha256,
  $ExpectedMainSha256,
  'Running R5 extension updater trust-bootstrap regression...',
  'Running R5 offline/remote-failure UI regression...',
  'SDCenter v0.24 Final Gate R5 local installer build'
)) {
  if (-not $text.Contains($required)) { throw "R5 runtime patch marker missing: $required" }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($runtimeScript, $text, $utf8NoBom)
try {
  & $runtimeScript -CandidateZip $candidate -InstallerVersion $InstallerVersion -OutputDir $OutputDir
}
finally {
  Remove-Item -LiteralPath $runtimeScript -Force -ErrorAction SilentlyContinue
}
