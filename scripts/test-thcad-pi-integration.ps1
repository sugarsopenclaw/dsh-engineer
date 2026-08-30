param(
    [switch]$LiveStatus
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build-thcad-agent-bridge.ps1')
if ($LASTEXITCODE -ne 0) { throw "AgentBridge build failed: $LASTEXITCODE" }

& (Join-Path $PSScriptRoot 'verify-pi.ps1')
if ($LASTEXITCODE -ne 0) { throw "Pi verification failed: $LASTEXITCODE" }

$tsx = Join-Path $repositoryRoot 'pi\node_modules\.bin\tsx.cmd'
& $tsx --test `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\artifact-store.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\review-store.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\visual-subagent-runner.test.ts')
if ($LASTEXITCODE -ne 0) { throw "THCAD artifact tests failed: $LASTEXITCODE" }

if ($LiveStatus) {
    & $tsx (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\doctor-cli.ts')
    if ($LASTEXITCODE -ne 0) { throw "Live THCAD status failed: $LASTEXITCODE" }
}

Write-Host 'PASS: Pi THCAD mechanical subagent integration checks completed.'
