[CmdletBinding()]
param(
    [switch]$Corpus,
    [switch]$FullBenchmark
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PreviousCorpusGate = [Environment]::GetEnvironmentVariable(
    "CADKERNEL_RUN_CORPUS",
    "Process"
)
$PreviousBenchGate = [Environment]::GetEnvironmentVariable(
    "CADKERNEL_RUN_BENCH",
    "Process"
)

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

    [Environment]::SetEnvironmentVariable("CADKERNEL_RUN_BENCH", "1", "Process")
    Invoke-Checked "2k performance smoke gate" {
        uv run --frozen pytest -m bench -q
    }

    if ($Corpus) {
        [Environment]::SetEnvironmentVariable("CADKERNEL_RUN_CORPUS", "1", "Process")
        Invoke-Checked "hash-pinned six-drawing corpus rebuild" {
            uv run --frozen pytest -m corpus -q
        }
    }

    if ($FullBenchmark) {
        Invoke-Checked "2k/20k/300k performance acceptance" {
            uv run --frozen python -m tests.bench.run_baseline `
                --tiers 2000 20000 300000 `
                --output benchmarks/baseline-local.json
        }
    }
}
finally {
    [Environment]::SetEnvironmentVariable(
        "CADKERNEL_RUN_CORPUS",
        $PreviousCorpusGate,
        "Process"
    )
    [Environment]::SetEnvironmentVariable(
        "CADKERNEL_RUN_BENCH",
        $PreviousBenchGate,
        "Process"
    )
    Pop-Location
}
