[CmdletBinding(PositionalBinding = $false)]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $repositoryRoot "backend"
$backendProject = Join-Path $backendDirectory "pyproject.toml"

if (-not (Test-Path -LiteralPath $backendProject)) {
    throw "Backend project not found: $backendProject"
}

$uvCommand = Get-Command uv -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $uvCommand) {
    throw "uv was not found. Install uv and make sure it is available on PATH."
}

Push-Location -LiteralPath $backendDirectory
try {
    Write-Host "[1/2] Applying backend database migrations..."
    & $uvCommand.Source run alembic upgrade head
    if ($LASTEXITCODE -ne 0) {
        throw "Backend database migration failed with code $LASTEXITCODE."
    }

    Write-Host "[2/2] Starting Shenbian FastAPI at http://127.0.0.1:8000"
    Write-Host "      API docs: http://127.0.0.1:8000/docs"
    Write-Host "      Press Ctrl+C to stop the backend."
    & $uvCommand.Source run shenbian-api
    $backendExitCode = $LASTEXITCODE
    if ($backendExitCode -ne 0) {
        throw "Shenbian FastAPI exited with code $backendExitCode."
    }
}
finally {
    Pop-Location
}
