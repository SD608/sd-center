param(
  [Parameter(Mandatory=$true)][string]$CandidateZip,
  [string]$OutputDirectory = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ExpectedFilename = 'SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-R5-win-x64.zip'
$ExpectedZipSha256 = '728a60445253a8798bb65d578e2192222d4cffcce61d22a3b2192f7fc2612ee5'
$ExpectedMainSha256 = 'eec3a7ac2ce56e3fd68005d0ed86f766b99c4d37832f03d8729ad5d6d8afb38d'
$Repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$Original = (Resolve-Path -LiteralPath $CandidateZip).Path
function Sha([string]$File) { (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() }
if ([IO.Path]::GetFileName($Original) -cne $ExpectedFilename) {
  throw "BLOCKED: exact R5 candidate filename required: $ExpectedFilename"
}
if ((Sha $Original) -ne $ExpectedZipSha256) { throw 'BLOCKED: R5 candidate ZIP hash mismatch' }
if ((& node --version) -notmatch '^v(2[2-9]|[3-9][0-9])\.') { throw 'Node.js 22+ required' }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path ([IO.Path]::GetTempPath()) ("SDCenter-Bitcoin-Retirement-QA-" + [guid]::NewGuid().ToString('N'))
}
if (Test-Path -LiteralPath $OutputDirectory) { throw 'BLOCKED: output already exists; do not overwrite an existing candidate' }
$Output = [IO.Path]::GetFullPath($OutputDirectory)
if ($Output -eq $Repo -or $Output.StartsWith($Repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'BLOCKED: QA output must be outside repository/public release paths'
}
New-Item -ItemType Directory -Path $Output -Force | Out-Null
try {
  $Extract = Join-Path $Output 'verified-unpublished-candidate'
  Expand-Archive -LiteralPath $Original -DestinationPath $Extract
  $Exes = @(Get-ChildItem -LiteralPath $Extract -Recurse -File -Filter 'SDCenter.exe')
  if ($Exes.Count -ne 1) { throw "BLOCKED: exactly one SDCenter.exe required; found $($Exes.Count)" }
  $Root = Join-Path $Exes[0].Directory.FullName 'resources\app'
  $MainFile = Join-Path $Root 'main.js'
  $UiFile = Join-Path $Root 'public\js\app.js'
  foreach ($File in @($MainFile,$UiFile)) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "BLOCKED: candidate runtime file missing: $File" }
  }
  if ((Sha $MainFile) -ne $ExpectedMainSha256) { throw 'BLOCKED: R5 main.js SHA mismatch' }
  $MainBefore = Sha $MainFile
  $UiBefore = Sha $UiFile
  $Patch = Join-Path $Repo 'tools\patch-retired-bitcoin-v024.js'
  $Test = Join-Path $Repo 'tools\test-retired-bitcoin-v024.js'
  & node $Test
  if ($LASTEXITCODE -ne 0) { throw 'BLOCKED: isolated patch regression failed' }
  & node $Patch $Root
  if ($LASTEXITCODE -ne 0) { throw 'BLOCKED: target candidate patch failed' }
  & node --check $MainFile
  if ($LASTEXITCODE -ne 0) { throw 'BLOCKED: main.js syntax failure' }
  & node --check $UiFile
  if ($LASTEXITCODE -ne 0) { throw 'BLOCKED: app.js syntax failure' }
  $MainAfter = Sha $MainFile
  $UiAfter = Sha $UiFile
  if ($MainBefore -eq $MainAfter -or $UiBefore -eq $UiAfter) { throw 'BLOCKED: no verified changes to both targeted files' }
  $TextMain = Get-Content -LiteralPath $MainFile -Raw
  $TextUi = Get-Content -LiteralPath $UiFile -Raw
  foreach ($Mark in @('SD-BITCOIN-RETIRED-GUARD:installStoreApp','SD-BITCOIN-RETIRED-GUARD:updateAppFromCatalog','SD-BITCOIN-RETIRED-GUARD:addAppFromZip')) {
    if (-not $TextMain.Contains($Mark)) { throw "BLOCKED: missing backend guard $Mark" }
  }
  if (-not $TextUi.Contains('SD-BITCOIN-RETIRED-GUARD:renderStore')) { throw 'BLOCKED: UI store guard missing' }
  & node $Patch $Root
  if ($LASTEXITCODE -ne 0 -or (Sha $MainFile) -ne $MainAfter -or (Sha $UiFile) -ne $UiAfter) {
    throw 'BLOCKED: patched candidate was not idempotent'
  }
  if ((Sha $Original) -ne $ExpectedZipSha256) { throw 'BLOCKED: original candidate changed' }
  @(
    'STATUS=QA_ONLY_NOT_RELEASE'
    'SOURCE=immutable R5 UI Preview v0.24 candidate'
    "source_sha256=$ExpectedZipSha256"
    "main_before_sha256=$MainBefore"
    "main_after_sha256=$MainAfter"
    "ui_before_sha256=$UiBefore"
    "ui_after_sha256=$UiAfter"
    'main_merged=false'
    'official_release=false'
    'runtime_user_data_touched=false'
    'actual_windows_user_visual_gate=NOT_RUN'
    'PRODUCTION_DB_CHANGED=false'
  ) | Set-Content -LiteralPath (Join-Path $Output 'DO_NOT_PUBLISH_QA_ONLY.txt') -Encoding UTF8
  Write-Host "PASS: safe candidate patch verification: $Output"
  Write-Host 'BLOCKED: do not launch/distribute until Windows manual user environment and full Release Gate tests pass'
}
catch {
  if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force -Recurse -ErrorAction SilentlyContinue }
  throw
}
