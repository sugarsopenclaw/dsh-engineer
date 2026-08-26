[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$BackendBaseUrl = "http://127.0.0.1:8000",
    [string]$Profile = "web",
    [switch]$SkipHealthCheck,
    [switch]$NoExit,
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$DshArguments
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$harnessDirectory = Join-Path $repositoryRoot "harness"
$normalizedBackendBaseUrl = $BackendBaseUrl.TrimEnd("/")
$modelGatewayBaseUrl = "$normalizedBackendBaseUrl/api/v1/llm/deepseek"

if (-not (Test-Path -LiteralPath (Join-Path $harnessDirectory "package.json"))) {
    throw "Harness directory not found: $harnessDirectory"
}

if (-not $SkipHealthCheck) {
    try {
        $health = Invoke-RestMethod `
            -Method Get `
            -Uri "$normalizedBackendBaseUrl/api/v1/health/live" `
            -TimeoutSec 3
        if ($health.status -ne "alive") {
            throw "Unexpected health response."
        }
    }
    catch {
        Write-Error "Shenbian FastAPI is not reachable. Start it from backend/ with: uv run shenbian-api"
        exit 1
    }
}

$previousBaseUrl = [Environment]::GetEnvironmentVariable("DEEPSEEK_BASE_URL", "Process")
$previousSearchBaseUrl = [Environment]::GetEnvironmentVariable(
    "DEEPSEEK_SEARCH_BASE_URL",
    "Process"
)
$exitCode = 1

try {
    [Environment]::SetEnvironmentVariable(
        "DEEPSEEK_BASE_URL",
        $modelGatewayBaseUrl,
        "Process"
    )
    [Environment]::SetEnvironmentVariable(
        "DEEPSEEK_SEARCH_BASE_URL",
        "$modelGatewayBaseUrl/anthropic/v1",
        "Process"
    )
    Push-Location -LiteralPath $harnessDirectory
    try {
        & pnpm dsh --profile $Profile @DshArguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    [Environment]::SetEnvironmentVariable(
        "DEEPSEEK_BASE_URL",
        $previousBaseUrl,
        "Process"
    )
    [Environment]::SetEnvironmentVariable(
        "DEEPSEEK_SEARCH_BASE_URL",
        $previousSearchBaseUrl,
        "Process"
    )
}

if ($NoExit) {
    $global:LASTEXITCODE = $exitCode
    return
}

exit $exitCode
