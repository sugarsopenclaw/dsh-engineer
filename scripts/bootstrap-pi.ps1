[CmdletBinding(PositionalBinding = $false)]
param(
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [switch]$RefreshModels
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pi-common.ps1")

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$piDirectory = Join-Path $repositoryRoot "pi"
$baseline = Get-PiBaseline
$nodePath = Assert-PiNodeVersion -MinimumVersion $baseline.MinimumNodeVersion
$npmPath = Get-RequiredCommand -Name "npm"
$gitPath = Get-RequiredCommand -Name "git"

if (-not (Test-Path -LiteralPath (Join-Path $piDirectory "package.json"))) {
    Write-Host "[1/4] Initializing Pi submodule at $($baseline.Tag)..."
    Invoke-CheckedCommand `
        -FilePath $gitPath `
        -ArgumentList @("-C", $repositoryRoot, "submodule", "update", "--init", "--depth", "1", "--", "pi") `
        -FailureMessage "Pi submodule initialization failed"
}
else {
    Write-Host "[1/4] Pi submodule already initialized."
}

$actualCommit = (& $gitPath -C $piDirectory rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $baseline.Commit) {
    throw "Pi HEAD is $actualCommit; expected $($baseline.Commit) ($($baseline.Tag)). Run scripts/update-pi.ps1 for deliberate upgrades."
}

$piChanges = @(& $gitPath -C $piDirectory status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect Pi submodule status."
}
if ($piChanges.Count -gt 0) {
    throw "Pi submodule contains local changes. Keep product code outside pi/."
}

Push-Location -LiteralPath $piDirectory
try {
    if ($SkipInstall) {
        Write-Host "[2/4] Skipping npm dependency install."
    }
    else {
        Write-Host "[2/4] Installing pinned Pi dependencies (lifecycle scripts disabled)..."
        Invoke-CheckedCommand `
            -FilePath $npmPath `
            -ArgumentList @("ci", "--ignore-scripts") `
            -FailureMessage "Pi dependency installation failed"
    }

    if ($SkipBuild) {
        Write-Host "[3/4] Skipping Pi build."
    }
    else {
        $modelData = Join-Path $piDirectory "packages/ai/src/providers/data/deepseek.json"
        $buildScript = if ($RefreshModels -or -not (Test-Path -LiteralPath $modelData)) {
            "build"
        }
        else {
            "build:offline"
        }
        Write-Host "[3/4] Building Pi with npm run $buildScript..."
        Invoke-CheckedCommand `
            -FilePath $npmPath `
            -ArgumentList @("run", $buildScript) `
            -FailureMessage "Pi build failed"
    }
}
finally {
    Pop-Location
}

Write-Host "[4/4] Verifying Pi and the Shenbian package..."
& (Join-Path $PSScriptRoot "verify-pi.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "Pi verification failed with exit code $LASTEXITCODE."
}

Write-Host "Pi $($baseline.PackageVersion) is ready. Start it with .\start-pi.cmd"
