[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$BackendBaseUrl = "http://127.0.0.1:8000",
    [string]$Profile = "web",
    [ValidateRange(1, 300)]
    [int]$BackendStartupTimeoutSeconds = 30,
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$DshArguments
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $repositoryRoot "backend"
$harnessStarter = Join-Path $PSScriptRoot "start-harness-via-backend.ps1"
$healthUrl = "$($BackendBaseUrl.TrimEnd('/'))/api/v1/health/live"
$backendProcess = $null
$ownsBackendProcess = $false

function Test-ShenbianBackendHealth {
    try {
        $health = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 1
        return $health.status -eq "alive"
    }
    catch {
        return $false
    }
}

function Start-ShenbianBackend {
    $uvCommand = Get-Command uv -CommandType Application -ErrorAction Stop
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $uvCommand.Source
    $startInfo.WorkingDirectory = $backendDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.Arguments = "run shenbian-api"

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Failed to start Shenbian FastAPI."
    }
    return $process
}

if (-not (Test-Path -LiteralPath (Join-Path $backendDirectory "pyproject.toml"))) {
    throw "Backend directory not found: $backendDirectory"
}
if (-not (Test-Path -LiteralPath $harnessStarter)) {
    throw "Harness startup script not found: $harnessStarter"
}

try {
    if (Test-ShenbianBackendHealth) {
        Write-Host "[1/2] FastAPI is already healthy; reusing the existing service."
    }
    else {
        Write-Host "[1/2] Starting Shenbian FastAPI..."
        $backendProcess = Start-ShenbianBackend
        $ownsBackendProcess = $true
        $deadline = [DateTime]::UtcNow.AddSeconds($BackendStartupTimeoutSeconds)

        while (-not (Test-ShenbianBackendHealth)) {
            if ($backendProcess.HasExited) {
                throw "Shenbian FastAPI exited during startup with code $($backendProcess.ExitCode)."
            }
            if ([DateTime]::UtcNow -ge $deadline) {
                throw "Shenbian FastAPI did not become healthy within $BackendStartupTimeoutSeconds seconds."
            }
            Start-Sleep -Milliseconds 250
        }
        Write-Host "      FastAPI ready: $BackendBaseUrl/docs"
    }

    Write-Host "[2/2] Starting DSH $Profile..."
    if ($ownsBackendProcess) {
        Write-Host "      Stop DSH with Ctrl+C; this script will also stop FastAPI."
    }

    & $harnessStarter `
        -BackendBaseUrl $BackendBaseUrl `
        -Profile $Profile `
        -SkipHealthCheck `
        -NoExit `
        @DshArguments
    $dshExitCode = $LASTEXITCODE
    if ($dshExitCode -ne 0) {
        throw "DSH exited with code $dshExitCode."
    }
}
finally {
    if ($ownsBackendProcess -and $null -ne $backendProcess) {
        Write-Host "Stopping Shenbian FastAPI..."
        if (-not $backendProcess.HasExited) {
            & taskkill.exe /PID $backendProcess.Id /T /F 2>$null | Out-Null
            $null = $backendProcess.WaitForExit(5000)
        }
        $backendProcess.Dispose()
    }
}
