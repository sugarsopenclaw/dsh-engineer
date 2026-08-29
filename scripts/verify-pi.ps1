[CmdletBinding(PositionalBinding = $false)]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pi-common.ps1")

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$piDirectory = Join-Path $repositoryRoot "pi"
$pluginDirectory = Join-Path $repositoryRoot "plugins/shenbian-pi"
$piCli = Join-Path $piDirectory "packages/coding-agent/dist/bundle/cli.js"
$baseline = Get-PiBaseline
$nodePath = Assert-PiNodeVersion -MinimumVersion $baseline.MinimumNodeVersion
$gitPath = Get-RequiredCommand -Name "git"

if (-not (Test-Path -LiteralPath (Join-Path $piDirectory "package.json"))) {
    throw "Pi submodule is not initialized. Run scripts/bootstrap-pi.ps1."
}

$actualCommit = (& $gitPath -C $piDirectory rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $baseline.Commit) {
    throw "Pi commit mismatch: expected $($baseline.Commit), found $actualCommit."
}

$actualTag = $baseline.Tag
if ($baseline.Tag.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
    $actualTag = (& $gitPath -C $piDirectory describe --tags --exact-match HEAD 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualTag -ne $baseline.Tag) {
        throw "Pi tag mismatch: expected $($baseline.Tag), found $actualTag."
    }
}

$piChanges = @(& $gitPath -C $piDirectory status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0 -or $piChanges.Count -gt 0) {
    throw "Pi submodule must remain unchanged."
}

$upstreamPackage = Get-Content -Raw -LiteralPath (Join-Path $piDirectory "packages/coding-agent/package.json") | ConvertFrom-Json
if ($upstreamPackage.version -ne $baseline.PackageVersion) {
    throw "Pi package version mismatch: expected $($baseline.PackageVersion), found $($upstreamPackage.version)."
}

$pluginManifestPath = Join-Path $pluginDirectory "package.json"
$plugin = Get-Content -Raw -LiteralPath $pluginManifestPath | ConvertFrom-Json
if ($plugin.keywords -notcontains "pi-package") {
    throw "Shenbian package must declare the pi-package keyword."
}
if ($plugin.pi.extensions -notcontains "./extensions" -or $plugin.pi.themes -notcontains "./themes") {
    throw "Shenbian package resource manifest is incomplete."
}
foreach ($peer in @("@earendil-works/pi-coding-agent", "@earendil-works/pi-tui")) {
    $peerProperty = $plugin.peerDependencies.PSObject.Properties[$peer]
    if ($null -eq $peerProperty -or $peerProperty.Value -ne "*") {
        throw "$peer must be a non-bundled peer dependency."
    }
    $dependenciesProperty = $plugin.PSObject.Properties["dependencies"]
    if ($null -ne $dependenciesProperty -and $null -ne $dependenciesProperty.Value.PSObject.Properties[$peer]) {
        throw "$peer must not be installed as a runtime dependency."
    }
}

$settings = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot ".pi/settings.json") | ConvertFrom-Json
if ($settings.packages -notcontains "../plugins/shenbian-pi") {
    throw "Project Pi settings do not load the Shenbian package."
}
if ($settings.theme -ne "shenbian") {
    throw "Project Pi settings do not select the Shenbian theme."
}
if ($settings.defaultProvider -ne "deepseek" -or $settings.defaultModel -ne "deepseek-v4-flash") {
    throw "Project Pi settings do not select the verified DeepSeek default."
}
if ($settings.enabledModels -notcontains "deepseek/deepseek-v4-flash") {
    throw "Project Pi model scope does not include its default DeepSeek model."
}

$theme = Get-Content -Raw -LiteralPath (Join-Path $pluginDirectory "themes/shenbian.json") | ConvertFrom-Json
if ($theme.name -ne "shenbian") {
    throw "Shenbian theme name mismatch."
}

if (-not (Test-Path -LiteralPath $piCli)) {
    throw "Built Pi CLI not found: $piCli"
}

$tsgo = Join-Path $piDirectory "node_modules/.bin/tsgo.cmd"
if (-not (Test-Path -LiteralPath $tsgo)) {
    throw "Pi TypeScript compiler not found. Run scripts/bootstrap-pi.ps1 without -SkipInstall."
}
Push-Location -LiteralPath $repositoryRoot
try {
    & $tsgo -p (Join-Path $pluginDirectory "tsconfig.json") --noEmit
    if ($LASTEXITCODE -ne 0) {
        throw "Shenbian Pi extension type check failed with exit code $LASTEXITCODE."
    }

    $reportedVersion = (& $nodePath $piCli --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $reportedVersion -ne $baseline.PackageVersion) {
        throw "Pi CLI version mismatch: expected $($baseline.PackageVersion), found $reportedVersion."
    }
}
finally {
    Pop-Location
}

Write-Host "Verified Pi $actualTag ($actualCommit), clean upstream, typed Shenbian extension, and CLI $reportedVersion."
