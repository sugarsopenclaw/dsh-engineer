param(
    [string]$MechanicalRoot = "D:\THSOFT\THCAD V24_Mechanical2D",
    [string]$LispInventoryId = "thcad-v24.lisp",
    [string]$CommandInventoryId = "thcad-v24.command",
    [string]$LispOutputDir = "",
    [string]$CommandOutputDir = "",
    [string]$ScanOutput = "",
    [string]$RuntimeJson = "",
    [int]$TimeoutSeconds = 60,
    [switch]$SkipRuntimeProbe
)

$ErrorActionPreference = "Stop"

$probeDirectory = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path (Join-Path $probeDirectory "..\..\..")).Path
$stagingRoot = Join-Path $repoRoot "data\datasets\staging\cad-capabilities"
if ([string]::IsNullOrWhiteSpace($LispOutputDir)) {
    $LispOutputDir = Join-Path $stagingRoot $LispInventoryId
}
if ([string]::IsNullOrWhiteSpace($CommandOutputDir)) {
    $CommandOutputDir = Join-Path $stagingRoot $CommandInventoryId
}
if ([string]::IsNullOrWhiteSpace($ScanOutput)) {
    $ScanOutput = Join-Path $stagingRoot "thcad-v24.lisp-command-scan.json"
}
if ([string]::IsNullOrWhiteSpace($RuntimeJson)) {
    $RuntimeJson = Join-Path $stagingRoot "thcad-v24.lisp-command-runtime.json"
}

if (-not (Test-Path -LiteralPath $MechanicalRoot -PathType Container)) {
    throw "THCAD mechanical root not found: $MechanicalRoot"
}

$runtimeObject = $null
if (-not $SkipRuntimeProbe) {
    $probePath = Join-Path $probeDirectory "ProbeThcadLispRuntime.ps1"
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $probeText = Join-Path $env:TEMP "thcad-lisp-runtime-atoms.txt"
    $runtimeRaw = & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $probePath `
        -OutputPath $probeText `
        -TimeoutSeconds $TimeoutSeconds
    if ($LASTEXITCODE -ne 0) {
        throw "ProbeThcadLispRuntime.ps1 failed with exit code $LASTEXITCODE"
    }
    $runtimeObject = $runtimeRaw | ConvertFrom-Json
    if (-not $runtimeObject.host) {
        throw "LISP runtime probe did not attach to a THCAD session."
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeJson) | Out-Null
    [IO.File]::WriteAllText($RuntimeJson, [string]$runtimeRaw, [Text.UTF8Encoding]::new($false))
    Write-Host "Runtime probe attached: $($runtimeObject.host) / $($runtimeObject.version)"
}
elseif (-not (Test-Path -LiteralPath $RuntimeJson)) {
    throw "SkipRuntimeProbe requires an existing runtime JSON: $RuntimeJson"
}

New-Item -ItemType Directory -Force -Path $LispOutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $CommandOutputDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ScanOutput) | Out-Null

$atomizer = Join-Path $repoRoot "data\pipelines\cad_capabilities\lisp_command_atoms.py"
$backend = Join-Path $repoRoot "backend"
$uv = Get-Command uv -ErrorAction SilentlyContinue
$pythonArgs = @(
    $atomizer,
    "--mechanical-root", $MechanicalRoot,
    "--runtime-json", $RuntimeJson,
    "--lisp-output-dir", $LispOutputDir,
    "--command-output-dir", $CommandOutputDir,
    "--scan-output", $ScanOutput,
    "--require-runtime"
)
if ($uv) {
    & uv run --project $backend python @pythonArgs
}
else {
    & python @pythonArgs
}
if ($LASTEXITCODE -ne 0) {
    throw "LISP/command atomizer failed with exit code $LASTEXITCODE"
}

Write-Host "Wrote $LispOutputDir"
Write-Host "Wrote $CommandOutputDir"
Write-Host "Wrote $ScanOutput"
