[CmdletBinding()]
param(
    [switch]$Corpus
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
    Invoke-Checked "unit and property tests" {
        uv run --frozen pytest -m "not corpus and not bench" -q
    }
    Invoke-Checked "dependency-direction contracts" {
        uv run --frozen lint-imports
    }
    Invoke-Checked "semantic performance smoke gate" {
        uv run --frozen pytest -m bench -q
    }
    if ($Corpus) {
        Invoke-Checked "external semantic corpus checks" {
            uv run --frozen pytest -m corpus -q
        }
    }
}
finally {
    Pop-Location
}
