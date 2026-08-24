[CmdletBinding()]
param(
    [switch]$E2E
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    Write-Host "==> $Label"
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

Push-Location -LiteralPath $ProjectRoot
try {
    Invoke-Checked "unit and round-trip tests" {
        uv run --frozen pytest -m "not e2e" -q
    }
    Invoke-Checked "dependency-direction contracts" {
        uv run --frozen lint-imports
    }
    if ($E2E) {
        $requiredE2EVariables = @(
            "XIAOLIANG_CADSTACK_E2E_PROJECT_ROOT",
            "XIAOLIANG_CADSTACK_E2E_LOGICAL_SOURCE",
            "XIAOLIANG_CADSTACK_E2E_DXF",
            "XIAOLIANG_CADSTACK_E2E_MLIGHT_INDEX"
        )
        $missingE2EVariables = @(
            $requiredE2EVariables | Where-Object {
                [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
            }
        )
        if ($missingE2EVariables.Count -gt 0) {
            throw "-E2E requires: $($missingE2EVariables -join ', ')"
        }
        Invoke-Checked "real drawing end-to-end checks" {
            uv run --frozen pytest -m e2e -q
        }
    }
}
finally {
    Pop-Location
}
