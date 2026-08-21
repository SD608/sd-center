param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateZip,
  [string]$InstallerVersion = '2.2.8',
  [string]$OutputDir = (Join-Path (Get-Location) 'final-gate-output-r3')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedFilename = 'SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-R3-win-x64.zip'
$ExpectedZipSha256 = 'f88c77455849e8545a192ed7cc0979bb33864c9fdbebcfbd0110408170849939'
$ExpectedMainSha256 = '065b1c2c78c60d45026d3ba41718fedd9c8ff05595119c0adb441eaffacfd215'
$BaseR2ZipSha256 = '61078f1e6bac7c2cc541d1bc0b13d4b260c9cb431f47fef3fcff796e201a234b'

function Hash([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$candidate = (Resolve-Path -LiteralPath $CandidateZip).Path
if ([IO.Path]::GetFileName($candidate) -ne $ExpectedFilename) {
  throw "R3 candidate filename mismatch. expected=$ExpectedFilename"
}
$actualZip = Hash $candidate
if ($actualZip -ne $ExpectedZipSha256) {
  throw "R3 candidate SHA-256 mismatch. expected=$ExpectedZipSha256 actual=$actualZip"
}

$baseScript = Join-Path $PSScriptRoot 'run-v024-final-installer-local.ps1'
$helperTest = Join-Path $PSScriptRoot 'test-extension-update-integrity-helper.js'
if (-not (Test-Path -LiteralPath $baseScript -PathType Leaf)) { throw 'Base Final Gate builder script missing.' }
if (-not (Test-Path -LiteralPath $helperTest -PathType Leaf)) { throw 'Updater integrity regression helper missing.' }

$runtimeScript = Join-Path $PSScriptRoot '.run-v024-final-installer-r3-runtime.ps1'
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
  "  Write-Host 'Running R3 extension update integrity regression...'`r`n  Invoke-Node -Arguments @('$helperTest', (Join-Path `$appRoot 'main.js'))`r`n`r`n  Write-Host 'Running portable Windows process smoke...'"
)
$text = $text.Replace(
  "'SDCenter v0.24 Final Gate local installer build'",
  "'SDCenter v0.24 Final Gate R3 local installer build'"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($runtimeScript, $text, $utf8NoBom)
try {
  & $runtimeScript -CandidateZip $candidate -InstallerVersion $InstallerVersion -OutputDir $OutputDir
}
finally {
  Remove-Item -LiteralPath $runtimeScript -Force -ErrorAction SilentlyContinue
}
