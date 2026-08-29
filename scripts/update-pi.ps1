[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?|[0-9a-fA-F]{40})$')]
    [string]$Ref
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pi-common.ps1")

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$piDirectory = Join-Path $repositoryRoot "pi"
$baselinePath = Join-Path $PSScriptRoot "pi-baseline.psd1"
$gitPath = Get-RequiredCommand -Name "git"
$oldCommit = (& $gitPath -C $piDirectory rev-parse HEAD).Trim()

$piChanges = @(& $gitPath -C $piDirectory status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0 -or $piChanges.Count -gt 0) {
    throw "Refusing to update a Pi submodule with local changes."
}

try {
    if ($Ref.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
        Invoke-CheckedCommand `
            -FilePath $gitPath `
            -ArgumentList @("-C", $piDirectory, "fetch", "--depth", "1", "--filter=blob:none", "origin", "refs/tags/$Ref`:refs/tags/$Ref") `
            -FailureMessage "Unable to fetch Pi tag $Ref"
        $targetCommit = (& $gitPath -C $piDirectory rev-parse "$Ref^{commit}").Trim()
    }
    else {
        Invoke-CheckedCommand `
            -FilePath $gitPath `
            -ArgumentList @("-C", $piDirectory, "fetch", "--depth", "1", "--filter=blob:none", "origin", $Ref) `
            -FailureMessage "Unable to fetch Pi commit $Ref"
        $targetCommit = (& $gitPath -C $piDirectory rev-parse FETCH_HEAD).Trim()
    }

    Invoke-CheckedCommand `
        -FilePath $gitPath `
        -ArgumentList @("-C", $piDirectory, "checkout", "--detach", $targetCommit) `
        -FailureMessage "Unable to checkout Pi $Ref"

    $package = Get-Content -Raw -LiteralPath (Join-Path $piDirectory "packages/coding-agent/package.json") | ConvertFrom-Json
    $nodeRange = [string]$package.engines.node
    if ($nodeRange -notmatch '^\s*>=\s*(?<minimum>\d+\.\d+\.\d+)\s*$') {
        throw "Unsupported Pi Node.js engine range '$nodeRange'; update the baseline parser before accepting this release."
    }
    $minimumNodeVersion = $Matches.minimum
    $tagValue = if ($Ref.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) { $Ref } else { $targetCommit }
    $baselineContent = @"
@{
    Repository         = "https://github.com/earendil-works/pi.git"
    Tag                = "$tagValue"
    Commit             = "$targetCommit"
    PackageVersion     = "$($package.version)"
    MinimumNodeVersion = "$minimumNodeVersion"
}
"@
    Set-Content -LiteralPath $baselinePath -Value $baselineContent -Encoding utf8NoBOM

    & (Join-Path $PSScriptRoot "bootstrap-pi.ps1") -RefreshModels
    if ($LASTEXITCODE -ne 0) {
        throw "Pi bootstrap/verification failed for $Ref."
    }

    Write-Host "Pi candidate $Ref is verified. Review the changelog and git diff, then commit the pi gitlink and compatibility changes together."
}
catch {
    Write-Warning "Pi update did not complete. The previous verified commit was $oldCommit."
    Write-Warning "Inspect the failure before choosing whether to keep the candidate or run: git -C pi checkout --detach $oldCommit"
    throw
}
