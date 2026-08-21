param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateZip,

  [string]$InstallerVersion = '2.2.8',

  [string]$OutputDir = (Join-Path (Get-Location) 'final-gate-output')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedCandidateFilename = 'SDCenter-UI-Preview-v0.24-Core-FinalGateCandidate-win-x64.zip'
$ExpectedCandidateZipSha256 = 'c77ff83ddd8ac950873058739f177ed953f29e22f335b276c7440b818aee393f'
$ExpectedCandidateExeSha256 = '226811c8086805c68ce631330808842d320654797e3bf3c6661d345b1bf427ba'
$ExpectedCandidateMainSha256 = 'c5e54e2f46815564e560c5b14200a21062138ecee17d24bdb7e628a4ac8caf9c'
$ExpectedCoreRuntimeSha256 = '1be6f63eac00363ae4c19af42d33398aca1402431c9a7f88bb480edf7f1b68b6'
$CurrentOfficialVersion = '2.2.7'
$ElectronWinstallerVersion = '5.4.4'

function Assert-Hash {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label missing: $Path"
  }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) {
    throw "$Label SHA-256 mismatch. expected=$Expected actual=$actual"
  }
  Write-Host "PASS $Label SHA-256 $actual"
}

function Invoke-Node {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  & node @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "node failed with exit code ${LASTEXITCODE}: node $($Arguments -join ' ')"
  }
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Stop-Center {
  Get-Process SDCenter -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

$nodeVersionText = (& node --version)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($nodeVersionText)) {
  throw 'Node.js is required. Install Node.js 22 or newer before running this script.'
}
$nodeMajor = [int](($nodeVersionText.TrimStart('v') -split '\.')[0])
if ($nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required. Found $nodeVersionText"
}

if ($InstallerVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw 'InstallerVersion must be numeric SemVer x.y.z.'
}
if ([version]$InstallerVersion -le [version]$CurrentOfficialVersion) {
  throw "InstallerVersion must be greater than current official version $CurrentOfficialVersion."
}

$candidate = (Resolve-Path -LiteralPath $CandidateZip).Path
if ([IO.Path]::GetFileName($candidate) -ne $ExpectedCandidateFilename) {
  throw "Candidate ZIP filename must be exactly $ExpectedCandidateFilename"
}
Assert-Hash -Path $candidate -Expected $ExpectedCandidateZipSha256 -Label 'candidate ZIP'

$output = [IO.Path]::GetFullPath($OutputDir)
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$builderScript = Join-Path $PSScriptRoot 'build-v024-final-installer.js'
if (-not (Test-Path -LiteralPath $builderScript -PathType Leaf)) {
  throw "Final installer builder missing: $builderScript"
}

$work = Join-Path ([IO.Path]::GetTempPath()) ("sdcenter-v024-finalgate-" + [guid]::NewGuid().ToString('N'))
$extract = Join-Path $work 'exact-candidate'
$stage = Join-Path $work 'installer-stage'
$builder = Join-Path $work 'squirrel-builder'

New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
  Write-Host 'Expanding exact candidate ZIP...'
  Expand-Archive -LiteralPath $candidate -DestinationPath $extract -Force

  $exeMatches = @(Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'SDCenter.exe')
  if ($exeMatches.Count -ne 1) {
    throw "Expected exactly one SDCenter.exe in candidate, found $($exeMatches.Count)."
  }
  $candidateDir = $exeMatches[0].Directory.FullName
  $appRoot = Join-Path $candidateDir 'resources\app'

  Assert-Hash -Path (Join-Path $candidateDir 'SDCenter.exe') -Expected $ExpectedCandidateExeSha256 -Label 'candidate SDCenter.exe'
  Assert-Hash -Path (Join-Path $appRoot 'main.js') -Expected $ExpectedCandidateMainSha256 -Label 'candidate main.js'
  Assert-Hash -Path (Join-Path $appRoot 'src\sdlink-core-runtime.js') -Expected $ExpectedCoreRuntimeSha256 -Label 'candidate Core runtime'

  $packagePath = Join-Path $appRoot 'package.json'
  $pkg = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
  if ($pkg.version -ne $CurrentOfficialVersion) {
    throw "Exact candidate package version drifted. expected=$CurrentOfficialVersion actual=$($pkg.version)"
  }

  Write-Host 'Running Final Gate candidate regressions...'
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\check-all.js'))
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\test-theme-catalog-v020.js'))
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\test-theme-assets-v020.js'))
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\test-theme-ui-v020.js'))
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\test-sdlink-integration-v021.js'))
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\test-sdlink-hardening-v022.js'))
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\test-sdlink-session-persistence-v023.js'))
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\test-sdlink-core-runtime-v024.js'))
  Invoke-Node -Arguments @((Join-Path $appRoot 'tools\test-core-public-errors-v024.js'))

  foreach ($relative in @(
    'main.js',
    'preload.js',
    'public\js\app.js',
    'public\js\ui-preview.js',
    'src\sdlink-integration.js',
    'src\sdlink-session-persistence.js',
    'src\sdlink-core-runtime.js',
    'src\theme-catalog.js',
    'src\theme-assets.js'
  )) {
    Invoke-Node -Arguments @('--check', (Join-Path $appRoot $relative))
  }

  Write-Host 'Running portable Windows process smoke...'
  Stop-Center
  $portableProcess = Start-Process -FilePath (Join-Path $candidateDir 'SDCenter.exe') -PassThru
  Start-Sleep -Seconds 10
  if ($portableProcess.HasExited) {
    throw "Portable candidate exited during smoke with code $($portableProcess.ExitCode)."
  }
  Stop-Center

  Write-Host "Staging exact candidate as installer version $InstallerVersion..."
  Copy-Item -LiteralPath $candidateDir -Destination $stage -Recurse -Force
  $stagedPackagePath = Join-Path $stage 'resources\app\package.json'
  $stagedPkg = Get-Content -LiteralPath $stagedPackagePath -Raw | ConvertFrom-Json
  $stagedPkg.version = $InstallerVersion
  $stagedPackageJson = $stagedPkg | ConvertTo-Json -Depth 100
  Write-Utf8NoBom -Path $stagedPackagePath -Content $stagedPackageJson

  $stagedPackageBytes = [IO.File]::ReadAllBytes($stagedPackagePath)
  if ($stagedPackageBytes.Length -ge 3 -and $stagedPackageBytes[0] -eq 0xEF -and $stagedPackageBytes[1] -eq 0xBB -and $stagedPackageBytes[2] -eq 0xBF) {
    throw 'Staged package.json unexpectedly contains a UTF-8 BOM.'
  }
  Invoke-Node -Arguments @('-e', "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); console.log('PASS staged package.json JSON parse')", $stagedPackagePath)

  Assert-Hash -Path (Join-Path $stage 'resources\app\main.js') -Expected $ExpectedCandidateMainSha256 -Label 'staged main.js'
  Assert-Hash -Path (Join-Path $stage 'resources\app\src\sdlink-core-runtime.js') -Expected $ExpectedCoreRuntimeSha256 -Label 'staged Core runtime'

  if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  New-Item -ItemType Directory -Force -Path $builder | Out-Null

  Push-Location $builder
  try {
    & npm init -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm init failed with exit code $LASTEXITCODE" }
    & npm install "electron-winstaller@$ElectronWinstallerVersion" --save-exact --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install electron-winstaller failed with exit code $LASTEXITCODE" }

    $resolvedWinstaller = (& node -p "require('./node_modules/electron-winstaller/package.json').version").Trim()
    if ($LASTEXITCODE -ne 0 -or $resolvedWinstaller -ne $ElectronWinstallerVersion) {
      throw "electron-winstaller version mismatch. expected=$ElectronWinstallerVersion actual=$resolvedWinstaller"
    }
    $builderLockSha256 = (Get-FileHash -LiteralPath (Join-Path $builder 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  finally {
    Pop-Location
  }

  $oldNodePath = $env:NODE_PATH
  $oldAppDir = $env:APP_DIR
  $oldBuildOutput = $env:BUILD_OUTPUT
  $oldInstallerVersion = $env:INSTALLER_VERSION
  try {
    $env:NODE_PATH = Join-Path $builder 'node_modules'
    $env:APP_DIR = $stage
    $env:BUILD_OUTPUT = $output
    $env:INSTALLER_VERSION = $InstallerVersion
    Invoke-Node -Arguments @($builderScript)
  }
  finally {
    $env:NODE_PATH = $oldNodePath
    $env:APP_DIR = $oldAppDir
    $env:BUILD_OUTPUT = $oldBuildOutput
    $env:INSTALLER_VERSION = $oldInstallerVersion
  }

  $setup = Join-Path $output 'SDCenterSetup.exe'
  $releases = Join-Path $output 'RELEASES'
  $nupkgs = @(Get-ChildItem -LiteralPath $output -File -Filter '*-full.nupkg')
  if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw 'Squirrel output missing SDCenterSetup.exe.' }
  if (-not (Test-Path -LiteralPath $releases -PathType Leaf)) { throw 'Squirrel output missing RELEASES.' }
  if ($nupkgs.Count -ne 1) { throw "Expected exactly one full nupkg, found $($nupkgs.Count)." }

  $setupInfo = Get-Item -LiteralPath $setup
  if ($setupInfo.Length -lt 100MB) {
    throw "Installer is unexpectedly small: $($setupInfo.Length) bytes."
  }
  $setupSha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
  $nupkgSha256 = (Get-FileHash -LiteralPath $nupkgs[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()

  $provenancePath = Join-Path $output 'FINAL_GATE_PROVENANCE.txt'
  @(
    'SDCenter v0.24 Final Gate local installer build',
    "built_at_utc=$([DateTime]::UtcNow.ToString('o'))",
    "source_repo_root=$repoRoot",
    "candidate_filename=$ExpectedCandidateFilename",
    "candidate_sha256=$ExpectedCandidateZipSha256",
    "candidate_exe_sha256=$ExpectedCandidateExeSha256",
    "candidate_main_sha256=$ExpectedCandidateMainSha256",
    "candidate_core_runtime_sha256=$ExpectedCoreRuntimeSha256",
    "staging_installer_version=$InstallerVersion",
    "electron_winstaller_version=$ElectronWinstallerVersion",
    "builder_package_lock_sha256=$builderLockSha256",
    "setup_size_bytes=$($setupInfo.Length)",
    "setup_sha256=$setupSha256",
    "nupkg_name=$($nupkgs[0].Name)",
    "nupkg_sha256=$nupkgSha256",
    'publication_state=BLOCKED_FINAL_GATE_ARTIFACT_ONLY',
    'official_main_manifest_release_modified=false'
  ) | Set-Content -LiteralPath $provenancePath -Encoding utf8

  Write-Host ''
  Write-Host 'FINAL GATE LOCAL BUILD COMPLETE'
  Write-Host "Installer: $setup"
  Write-Host "SHA-256 : $setupSha256"
  Write-Host "Provenance: $provenancePath"
  Write-Host 'This is a blocked Final Gate artifact. Do not publish it until physical Windows Release Gate checks pass.'
}
finally {
  Stop-Center
  if (Test-Path -LiteralPath $work) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
