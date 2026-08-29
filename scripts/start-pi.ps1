[CmdletBinding(PositionalBinding = $false)]
param(
    [switch]$SkipEnvironment,
    [switch]$UseUserPiHome,
    [switch]$UseUserSkills,
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$PiArguments
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pi-common.ps1")

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$piCli = Join-Path $repositoryRoot "pi/packages/coding-agent/dist/bundle/cli.js"
$environmentPath = Join-Path $repositoryRoot ".env"
$baseline = Get-PiBaseline
$nodePath = Assert-PiNodeVersion -MinimumVersion $baseline.MinimumNodeVersion
$forwardedArguments = @(
    $PiArguments | Where-Object { -not [string]::IsNullOrEmpty($_) }
)

if (-not (Test-Path -LiteralPath $piCli)) {
    throw "Pi has not been built. Run .\scripts\bootstrap-pi.ps1 first."
}

if (-not $SkipEnvironment) {
    $loadedCount = Import-RepositoryEnvironment -Path $environmentPath
    Write-Host "Loaded $loadedCount environment variables from the repository .env (values hidden)."
}

if (-not $UseUserPiHome) {
    $projectPiHome = Join-Path $repositoryRoot ".pi/runtime"
    if (-not (Test-Path -LiteralPath $projectPiHome)) {
        New-Item -ItemType Directory -Path $projectPiHome -Force | Out-Null
    }
    [Environment]::SetEnvironmentVariable("PI_CODING_AGENT_DIR", $projectPiHome, "Process")
    Write-Host "Using isolated project Pi state at $projectPiHome."
}

if (-not $UseUserSkills) {
    $controlledSkillArguments = @("--no-skills")
    $projectSkills = Join-Path $repositoryRoot "plugins/shenbian-pi/skills"
    if (Test-Path -LiteralPath $projectSkills) {
        $controlledSkillArguments += @("--skill", $projectSkills)
    }
    $forwardedArguments = @($controlledSkillArguments + $forwardedArguments)
    Write-Host "Using only Shenbian project skills; user-global skill discovery is disabled."
}

Push-Location -LiteralPath $repositoryRoot
try {
    & $nodePath $piCli @forwardedArguments
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $exitCode
