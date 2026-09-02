[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$BackendBaseUrl = "http://127.0.0.1:8000",
    [ValidateRange(1, 65535)]
    [int]$Port = 5173,
    [ValidateRange(1, 300)]
    [int]$BackendStartupTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendDirectory = Join-Path $repositoryRoot "frontend"
$backendStarter = Join-Path $PSScriptRoot "start-backend.ps1"
$healthUrl = "$($BackendBaseUrl.TrimEnd('/'))/api/v1/health/live"
$backendProcess = $null
$ownsBackendProcess = $false

function Test-ShenbianBackendHealth {
    try {
        $health = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 2
        return $health.status -eq "alive"
    }
    catch {
        return $false
    }
}

function Start-ShenbianBackend {
    $psCommand = Get-Command powershell.exe -CommandType Application -ErrorAction Stop
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $psCommand.Source
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$backendStarter`""

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Failed to start Shenbian FastAPI via $backendStarter."
    }
    return $process
}

if (-not (Test-Path -LiteralPath $backendStarter)) {
    throw "Backend startup script not found: $backendStarter"
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendDirectory "package.json"))) {
    throw "Frontend directory not found: $frontendDirectory"
}
$pnpmCommand = Get-Command pnpm.cmd -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $pnpmCommand) {
    throw "pnpm was not found. Install pnpm and make sure it is available on PATH."
}

try {
    if (Test-ShenbianBackendHealth) {
        Write-Host "[1/2] FastAPI is already healthy; reusing the existing service."
    }
    else {
        Write-Host "[1/2] Starting Shenbian FastAPI (local SQLite)..."
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
            Start-Sleep -Milliseconds 500
        }
        Write-Host "      FastAPI ready: $BackendBaseUrl/docs"
    }

    Write-Host "[2/2] Starting knowledge graph frontend at http://localhost:$Port"
    if ($ownsBackendProcess) {
        Write-Host "      Stop the frontend with Ctrl+C; this script will also stop FastAPI."
    }

    Push-Location -LiteralPath $frontendDirectory
    try {
        & $pnpmCommand.Source dev --port $Port --strictPort
        $frontendExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($frontendExitCode -ne 0) {
        throw "Vite dev server exited with code $frontendExitCode."
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
