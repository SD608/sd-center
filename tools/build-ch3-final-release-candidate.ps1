param(
  [string]$OutputDir = (Join-Path (Get-Location) 'final-gate-ch3-output'),
  [string]$CandidateVersion = '2.2.10'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedChapter3Head = '92abcf8ce231171e3f717e52a4c0f84261c60332'
$ExpectedMainHead = 'f57fe178d8915225b3a5ca987169961e65f6dd5b'
$ExpectedBaseVersion = '2.2.8'
$BaseNupkgUrl = 'https://github.com/SD608/sd-center/releases/download/v.2.2.8/SDCenter-2.2.8-full.nupkg'
$BaseNupkgSize = 139392231
$BaseNupkgSha256 = '97299eab1117b6fa1e2edd25c9e3aaadca5de28c7085cc866bb25b73550e47d5'
$BaseExeSha256 = '226811c8086805c68ce631330808842d320654797e3bf3c6661d345b1bf427ba'
$BaseMainSha256 = 'eec3a7ac2ce56e3fd68005d0ed86f766b99c4d37832f03d8729ad5d6d8afb38d'
$BaseCoreRuntimeSha256 = '1be6f63eac00363ae4c19af42d33398aca1402431c9a7f88bb480edf7f1b68b6'
$BaseBackgroundGuardSha256 = '5b5ab522315facb2e2562c8c1cced6736bdc4d0252c194e60b68b86641c95e20'
$ReviewedAudioSha256 = '33b200c45be66dfecd8130e94b8942b34720abe8fdffb36981aa18286f78237a'
$ReviewedAudioSize = 71889
$BundledSdLinkVersion = '1.4.1'
$BundledSdLinkFile = 'SDLink_v1.4.1_Desktop.zip'
$BundledSdLinkSize = 85865
$BundledSdLinkSha256 = '032d7e9fec32d99f9ae13a568baa1d1d80c5fb713392bdd103ccbd3ce9f59707'
$ElectronWinstallerVersion = '5.4.4'

function Hash([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing file: $Path" }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Hash([string]$Path, [string]$Expected, [string]$Label) {
  $actual = Hash $Path
  if ($actual -ne $Expected) { throw "$Label SHA-256 mismatch. expected=$Expected actual=$actual" }
  Write-Host "PASS $Label SHA-256 $actual"
}

function Invoke-Node([string[]]$Arguments) {
  & node @Arguments
  if ($LASTEXITCODE -ne 0) { throw "node failed: node $($Arguments -join ' ')" }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Stop-Center {
  Get-Process SDCenter -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

if ($CandidateVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'CandidateVersion must be numeric x.y.z.' }
if ([version]$CandidateVersion -le [version]$ExpectedBaseVersion) { throw "CandidateVersion must be greater than $ExpectedBaseVersion" }

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $repoRoot
try {
  & git fetch origin main --depth=1
  if ($LASTEXITCODE -ne 0) { throw 'git fetch origin main failed' }
  $actualMain = (& git rev-parse origin/main).Trim()
  if ($actualMain -ne $ExpectedMainHead) { throw "main moved after Gate start. expected=$ExpectedMainHead actual=$actualMain" }

  & git merge-base --is-ancestor $ExpectedChapter3Head HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Exact Chapter 3 #70 HEAD is not an ancestor of this candidate branch.' }

  $allowed = @(
    '.github/workflows/ch3-final-release-candidate.yml',
    'tools/build-ch3-final-release-candidate.ps1',
    'tools/patch-ch3-final-sdlink-bundle.js',
    'tools/test-ch3-final-sdlink-bundle.js'
  ) | Sort-Object
  $changed = @(& git diff --name-only "$ExpectedChapter3Head..HEAD") | Where-Object { $_ } | Sort-Object
  if (($changed -join "`n") -ne ($allowed -join "`n")) {
    throw "Unexpected candidate-branch diff since #70:`n$($changed -join "`n")"
  }

  $manifest = Get-Content -LiteralPath 'update/center-update.json' -Raw | ConvertFrom-Json
  if ($manifest.version -ne '2.2.8') { throw 'Official update manifest was modified before Release Gate PASS.' }
  $site = Get-Content -LiteralPath 'site-config.js' -Raw
  if ($site -notmatch 'version:\s*"2\.2\.8"') { throw 'Official site version was modified before Release Gate PASS.' }

  $audio = Join-Path $repoRoot 'assets\audio\achievement-unlock-13.mp3'
  if ((Get-Item -LiteralPath $audio).Length -ne $ReviewedAudioSize) { throw 'Reviewed achievement MP3 size mismatch.' }
  Assert-Hash $audio $ReviewedAudioSha256 'reviewed achievement MP3'

  $bundledSdLinkSource = Join-Path $repoRoot "downloads\extensions\$BundledSdLinkFile"
  if ((Get-Item -LiteralPath $bundledSdLinkSource).Length -ne $BundledSdLinkSize) {
    throw "Reviewed SD Link package size mismatch. expected=$BundledSdLinkSize actual=$((Get-Item -LiteralPath $bundledSdLinkSource).Length)"
  }
  Assert-Hash $bundledSdLinkSource $BundledSdLinkSha256 'reviewed bundled SD Link v1.4.1 package'

  Write-Host 'Running Chapter 3 overlay/source regressions before packaging...'
  Invoke-Node @('tools/test-achievement-unlock-overlay-v1.js')
  Invoke-Node @('tools/test-achievement-overlay-sound-v2.js')
  Invoke-Node @('--check','preview/v024-core/sdlink-achievement-overlay.js')
  Invoke-Node @('--check','tools/patch-achievement-unlock-overlay-v1.js')
  Invoke-Node @('--check','tools/patch-ch3-final-sdlink-bundle.js')
  Invoke-Node @('--check','tools/test-ch3-final-sdlink-bundle.js')

  $work = Join-Path ([IO.Path]::GetTempPath()) ('sdcenter-ch3-finalgate-' + [guid]::NewGuid().ToString('N'))
  $download = Join-Path $work 'SDCenter-2.2.8-full.nupkg'
  $zip = Join-Path $work 'base.zip'
  $extract = Join-Path $work 'base-extract'
  $stage = Join-Path $work 'stage'
  $builder = Join-Path $work 'builder'
  $output = [IO.Path]::GetFullPath($OutputDir)
  New-Item -ItemType Directory -Force -Path $work,$extract,$builder | Out-Null

  try {
    Write-Host 'Downloading exact published v2.2.8 R5 full nupkg...'
    Invoke-WebRequest -UseBasicParsing -Uri $BaseNupkgUrl -OutFile $download
    if ((Get-Item -LiteralPath $download).Length -ne $BaseNupkgSize) { throw 'Base R5 nupkg size mismatch.' }
    Assert-Hash $download $BaseNupkgSha256 'base R5 full nupkg'

    Copy-Item -LiteralPath $download -Destination $zip -Force
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
    $source = Join-Path $extract 'lib\net45'
    if (-not (Test-Path -LiteralPath (Join-Path $source 'SDCenter.exe') -PathType Leaf)) { throw 'R5 nupkg lib/net45 payload missing.' }
    Copy-Item -LiteralPath $source -Destination $stage -Recurse -Force

    $appRoot = Join-Path $stage 'resources\app'
    Assert-Hash (Join-Path $stage 'SDCenter.exe') $BaseExeSha256 'base SDCenter.exe'
    Assert-Hash (Join-Path $appRoot 'main.js') $BaseMainSha256 'base R5 main.js'
    Assert-Hash (Join-Path $appRoot 'src\sdlink-core-runtime.js') $BaseCoreRuntimeSha256 'base Core runtime'
    Assert-Hash (Join-Path $appRoot 'src\sdlink-background-window-guard.js') $BaseBackgroundGuardSha256 'base background guard'

    $packagePath = Join-Path $appRoot 'package.json'
    $pkg = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if ($pkg.version -ne $ExpectedBaseVersion) { throw "Base app version mismatch. expected=$ExpectedBaseVersion actual=$($pkg.version)" }

    Write-Host 'Applying exact Chapter 3-7 overlay patch to exact R5 app payload...'
    Invoke-Node @('tools/patch-achievement-unlock-overlay-v1.js', $appRoot)
    $patchedHelper = Join-Path $appRoot 'src\sdlink-achievement-overlay.js'
    $patchedHelperSha256 = Hash $patchedHelper
    $helperText = Get-Content -LiteralPath $patchedHelper -Raw
    if ($helperText -match 'shell\.beep\(\)') { throw 'System beep remains in final helper.' }
    if ($helperText -notmatch 'ACHIEVEMENT_CHIME_DATA_URL') { throw 'Reviewed achievement chime is not embedded.' }

    Write-Host 'Applying mandatory bundled SD Link clean-install bootstrap...'
    Invoke-Node @('tools/test-ch3-final-sdlink-bundle.js',(Join-Path $appRoot 'main.js'))
    $bundledDir = Join-Path $appRoot 'bundled'
    New-Item -ItemType Directory -Force -Path $bundledDir | Out-Null
    $bundledSdLinkTarget = Join-Path $bundledDir $BundledSdLinkFile
    Copy-Item -LiteralPath $bundledSdLinkSource -Destination $bundledSdLinkTarget -Force
    Assert-Hash $bundledSdLinkTarget $BundledSdLinkSha256 'staged bundled SD Link package'
    Invoke-Node @('tools/patch-ch3-final-sdlink-bundle.js', $appRoot)
    $patchedMainSha256 = Hash (Join-Path $appRoot 'main.js')

    Write-Host 'Running staged app source checks...'
    Invoke-Node @('--check',(Join-Path $appRoot 'main.js'))
    Invoke-Node @('--check',$patchedHelper)
    foreach ($test in @(
      'tools\check-all.js',
      'tools\test-theme-catalog-v020.js',
      'tools\test-theme-assets-v020.js',
      'tools\test-theme-ui-v020.js',
      'tools\test-sdlink-integration-v021.js',
      'tools\test-sdlink-hardening-v022.js',
      'tools\test-sdlink-session-persistence-v023.js',
      'tools\test-sdlink-core-runtime-v024.js',
      'tools\test-core-public-errors-v024.js',
      'tools\test-sdlink-background-window-guard-v024.js'
    )) {
      $p = Join-Path $appRoot $test
      if (Test-Path -LiteralPath $p -PathType Leaf) { Invoke-Node @($p) }
    }

    Write-Host 'Running patched portable Windows process smoke...'
    Stop-Center
    $proc = Start-Process -FilePath (Join-Path $stage 'SDCenter.exe') -PassThru
    Start-Sleep -Seconds 10
    if ($proc.HasExited) { throw "Patched portable app exited during smoke. code=$($proc.ExitCode)" }
    Stop-Center

    $pkg = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $pkg.version = $CandidateVersion
    Write-Utf8NoBom $packagePath ($pkg | ConvertTo-Json -Depth 100)
    Invoke-Node @('-e',"const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(p.version!==process.argv[2]) throw new Error('version mismatch');",$packagePath,$CandidateVersion)

    if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $output | Out-Null

    Push-Location $builder
    try {
      & npm init -y | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'npm init failed' }
      & npm install "electron-winstaller@$ElectronWinstallerVersion" --save-exact --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw 'electron-winstaller install failed' }
      $resolved = (& node -p "require('./node_modules/electron-winstaller/package.json').version").Trim()
      if ($resolved -ne $ElectronWinstallerVersion) { throw "electron-winstaller drift: $resolved" }
      $builderLockSha256 = Hash (Join-Path $builder 'package-lock.json')
    }
    finally { Pop-Location }

    $oldNodePath=$env:NODE_PATH; $oldAppDir=$env:APP_DIR; $oldOutput=$env:BUILD_OUTPUT; $oldVersion=$env:INSTALLER_VERSION
    try {
      $env:NODE_PATH = Join-Path $builder 'node_modules'
      $env:APP_DIR = $stage
      $env:BUILD_OUTPUT = $output
      $env:INSTALLER_VERSION = $CandidateVersion
      Invoke-Node @('tools/build-v024-final-installer.js')
    }
    finally {
      $env:NODE_PATH=$oldNodePath; $env:APP_DIR=$oldAppDir; $env:BUILD_OUTPUT=$oldOutput; $env:INSTALLER_VERSION=$oldVersion
    }

    $setup = Join-Path $output 'SDCenterSetup.exe'
    $releases = Join-Path $output 'RELEASES'
    $fullNupkg = Join-Path $output "SDCenter-$CandidateVersion-full.nupkg"
    foreach ($required in @($setup,$releases,$fullNupkg)) {
      if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Installer output missing: $required" }
    }
    if ((Get-Item -LiteralPath $setup).Length -lt 100MB) { throw 'Generated Setup.exe is unexpectedly small.' }

    $setupSha256 = Hash $setup
    $fullNupkgSha256 = Hash $fullNupkg
    $releasesSha256 = Hash $releases

    Write-Host 'Verifying generated nupkg contains exact patched payload and mandatory SD Link bundle...'
    $verifyZip = Join-Path $work 'verify.zip'
    $verifyDir = Join-Path $work 'verify'
    Copy-Item -LiteralPath $fullNupkg -Destination $verifyZip -Force
    Expand-Archive -LiteralPath $verifyZip -DestinationPath $verifyDir -Force
    $verifyApp = Join-Path $verifyDir 'lib\net45\resources\app'
    Assert-Hash (Join-Path $verifyApp 'main.js') $patchedMainSha256 'packaged patched main.js'
    Assert-Hash (Join-Path $verifyApp 'src\sdlink-achievement-overlay.js') $patchedHelperSha256 'packaged overlay helper'
    Assert-Hash (Join-Path $verifyApp "bundled\$BundledSdLinkFile") $BundledSdLinkSha256 'packaged bundled SD Link v1.4.1'
    $verifyPkg = Get-Content -LiteralPath (Join-Path $verifyApp 'package.json') -Raw | ConvertFrom-Json
    if ($verifyPkg.version -ne $CandidateVersion) { throw 'Packaged candidate version mismatch.' }

    $head = (& git rev-parse HEAD).Trim()
    $tree = (& git rev-parse 'HEAD^{tree}').Trim()
    $provenance = Join-Path $output 'FINAL_GATE_PROVENANCE.txt'
    @(
      'SDCenter Chapter 3 Final Release Gate candidate — SD Link bundle fix',
      "built_at_utc=$([DateTime]::UtcNow.ToString('o'))",
      "candidate_source_head=$head",
      "candidate_source_tree=$tree",
      "chapter3_integrated_head=$ExpectedChapter3Head",
      "main_guard_head=$ExpectedMainHead",
      "base_official_version=$ExpectedBaseVersion",
      "candidate_staging_version=$CandidateVersion",
      "base_nupkg_sha256=$BaseNupkgSha256",
      "base_main_sha256=$BaseMainSha256",
      "reviewed_audio_size=$ReviewedAudioSize",
      "reviewed_audio_sha256=$ReviewedAudioSha256",
      "bundled_sdlink_version=$BundledSdLinkVersion",
      "bundled_sdlink_size=$BundledSdLinkSize",
      "bundled_sdlink_sha256=$BundledSdLinkSha256",
      "patched_main_sha256=$patchedMainSha256",
      "patched_overlay_helper_sha256=$patchedHelperSha256",
      "electron_winstaller_version=$ElectronWinstallerVersion",
      "builder_package_lock_sha256=$builderLockSha256",
      "setup_size_bytes=$((Get-Item -LiteralPath $setup).Length)",
      "setup_sha256=$setupSha256",
      "full_nupkg_size_bytes=$((Get-Item -LiteralPath $fullNupkg).Length)",
      "full_nupkg_sha256=$fullNupkgSha256",
      "releases_sha256=$releasesSha256",
      'replaces_retired_candidate_setup_sha256=7fe1813f74e8be8425de4e021f15c17bd8c10778c3d55b9bf99db3541dfafc0a',
      'publication_state=BLOCKED_FINAL_GATE_ARTIFACT_ONLY',
      'official_version_manifest_release_modified=false'
    ) | Set-Content -LiteralPath $provenance -Encoding utf8

    Write-Host "FINAL_SETUP_SHA256=$setupSha256"
    Write-Host "FINAL_NUPKG_SHA256=$fullNupkgSha256"
    Write-Host "FINAL_RELEASES_SHA256=$releasesSha256"
    Write-Host 'PASS Chapter 3 blocked Final Release Gate candidate generated with mandatory bundled SD Link.'
  }
  finally {
    Stop-Center
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
finally { Pop-Location }
