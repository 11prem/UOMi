<#
.SYNOPSIS
Builds the standalone UOMi release APK on Windows.

.DESCRIPTION
Run from the repo root:  .\mobile\scripts\build-apk.ps1
If script execution is blocked:  powershell -ExecutionPolicy Bypass -File .\mobile\scripts\build-apk.ps1
Output: <repo>\dist\UOMi-<version>.apk

Builds the COMMITTED state of mobile/ (git archive HEAD:mobile), not your working tree, inside a
short real path. Reason: with LongPathsEnabled=0 the SDK's ninja 1.10.2 cannot create object dirs
over 248 chars, which a build under the repo path produces. The CMake object-path and ABI fixes are
emitted into the generated android/ project by mobile/plugins/withAndroidReleaseBuild.js.

.PARAMETER BuildRoot
Short folder to build in. Keep it short. An existing folder is renamed to <BuildRoot>-old-<timestamp>.
#>
[CmdletBinding()]
param(
    [string]$BuildRoot = 'C:\u\m'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BuildRoot = $BuildRoot.TrimEnd('\')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$oldCI = $env:CI
$archive = $null

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Assert-Ok($what) {
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

try {
    if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'uomi-toolchain\jdk17' }
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'uomi-toolchain\android-sdk' }
    foreach ($dir in $env:JAVA_HOME, $env:ANDROID_HOME) {
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
            throw "Toolchain folder not found: $dir. Install the JDK 17 / Android SDK there, or set JAVA_HOME / ANDROID_HOME."
        }
    }
    if (-not (Test-Path -LiteralPath "$repo\mobile\node_modules" -PathType Container)) {
        throw "mobile\node_modules is missing. Run 'npm ci' in mobile\ first."
    }
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'  # not PATH: Git's GNU tar misreads C:\ paths
    if (-not (Test-Path -LiteralPath $tar)) { throw "Windows tar.exe not found at $tar." }

    if (git -C $repo status --porcelain -- mobile) {
        Write-Warning 'mobile/ has uncommitted changes. Only the committed state (HEAD) is built.'
    }

    Step "[1/5] Exporting mobile/ at HEAD to $BuildRoot"
    if (Test-Path -LiteralPath $BuildRoot) {
        # A Gradle daemon from the previous run holds the folder open on Windows; stop it first (exit code ignored).
        $oldGradlew = "$BuildRoot\android\gradlew.bat"
        if (Test-Path -LiteralPath $oldGradlew) {
            Write-Host '    stopping any Gradle daemon from the previous build'
            try { & $oldGradlew --stop | Out-Null } catch { }
        }
        $old = "$(Split-Path $BuildRoot -Leaf)-old-$stamp"
        try { Rename-Item -LiteralPath $BuildRoot -NewName $old }
        catch {
            throw "Cannot rename $BuildRoot. A process (a Gradle daemon, an editor, a terminal sitting in that folder) may be holding it open; close it and re-run. ($($_.Exception.Message))"
        }
        Write-Host "    existing folder renamed to $old"
    }
    New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
    $archive = Join-Path $env:TEMP "uomi-mobile-$stamp.tar"
    git -C $repo archive --format=tar "--output=$archive" HEAD:mobile
    Assert-Ok 'git archive'
    & $tar -xf $archive -C $BuildRoot
    Assert-Ok 'tar extract'

    # Read the version now so a bad app.json fails before the long build, not after it.
    $version = (Get-Content -Raw -LiteralPath "$BuildRoot\app.json" | ConvertFrom-Json).expo.version
    if ($version -notmatch '^\d+\.\d+\.\d+') { throw "expo.version in mobile/app.json at HEAD is '$version'; expected something like 1.2.3." }

    Step '[2/5] Copying node_modules (robocopy)'
    $roboOut = robocopy "$repo\mobile\node_modules" "$BuildRoot\node_modules" /E /MT:16 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) {  # 0-7 are success codes
        $code = $LASTEXITCODE
        $roboOut | Select-Object -Last 20 | ForEach-Object { Write-Host "    robocopy: $_" }
        throw "robocopy failed (exit code $code)."
    }

    Step '[3/5] expo prebuild (android)'
    Push-Location $BuildRoot
    try {
        $env:CI = '1'
        npx.cmd expo prebuild --platform android --no-install
        Assert-Ok 'expo prebuild'
    } finally { Pop-Location }

    Step '[4/5] Gradle assembleRelease'
    Push-Location "$BuildRoot\android"
    try {
        & .\gradlew.bat assembleRelease --no-daemon  # no daemon: it would keep BuildRoot locked for the next run
        Assert-Ok 'gradlew assembleRelease'
    } finally { Pop-Location }

    Step '[5/5] Copying APK to dist\'
    $apk = "$BuildRoot\android\app\build\outputs\apk\release\app-release.apk"
    if (-not (Test-Path -LiteralPath $apk)) { throw "Gradle reported success but $apk does not exist." }
    $dist = Join-Path $repo 'dist'
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    $out = Join-Path $dist "UOMi-$version.apk"
    Copy-Item -LiteralPath $apk -Destination $out -Force
    $mb = '{0:N1}' -f ((Get-Item -LiteralPath $out).Length / 1MB)
    Write-Host "APK ready: $out ($mb MB)" -ForegroundColor Green
}
catch {
    Write-Host "BUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    $env:CI = $oldCI
    if ($archive -and (Test-Path -LiteralPath $archive)) { Remove-Item -LiteralPath $archive -ErrorAction SilentlyContinue }
}
