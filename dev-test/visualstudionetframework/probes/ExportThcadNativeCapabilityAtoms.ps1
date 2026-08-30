param(
    [string]$MechanicalRoot = "D:\THSOFT\THCAD V24_Mechanical2D",
    [string]$InventoryId = "thcad-v24.native",
    [string]$OutputDir = "",
    [string]$ScanOutput = ""
)

$ErrorActionPreference = "Stop"

$probeDirectory = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path (Join-Path $probeDirectory "..\..\..")).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $repoRoot "data\datasets\staging\cad-capabilities\$InventoryId"
}
if ([string]::IsNullOrWhiteSpace($ScanOutput)) {
    $ScanOutput = Join-Path $OutputDir "native-capability-scan.json"
}

if (-not (Test-Path -LiteralPath $MechanicalRoot -PathType Container)) {
    throw "THCAD mechanical root not found: $MechanicalRoot"
}

$readerPath = Join-Path $probeDirectory "PeExportReader.cs"
$scanTypePath = Join-Path $probeDirectory "NativeCapabilityScan.cs"
if (-not ("Shb.Thcad.Probes.NativeCapabilityScan" -as [Type])) {
    Add-Type -Path @($readerPath, $scanTypePath)
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
[Shb.Thcad.Probes.NativeCapabilityScan]::WriteInventoryScan(
    $MechanicalRoot,
    $ScanOutput,
    $InventoryId,
    "thcad-v24")
Write-Host "Wrote scan $ScanOutput"

$atomizer = Join-Path $repoRoot "data\pipelines\cad_capabilities\native_atoms.py"
$backend = Join-Path $repoRoot "backend"
$uv = Get-Command uv -ErrorAction SilentlyContinue
$firstDir = Join-Path $OutputDir ".emit1"
$secondDir = Join-Path $OutputDir ".emit2"
New-Item -ItemType Directory -Force -Path $firstDir | Out-Null
New-Item -ItemType Directory -Force -Path $secondDir | Out-Null

function Invoke-Atomizer {
    param([string]$Target)
    if ($uv) {
        & uv run --project $backend python $atomizer --scan $ScanOutput --output-dir $Target --captured-at "2026-08-28T00:00:00Z"
    }
    else {
        & python $atomizer --scan $ScanOutput --output-dir $Target --captured-at "2026-08-28T00:00:00Z"
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Native atomizer failed with exit code $LASTEXITCODE"
    }
}

Invoke-Atomizer $firstDir
Invoke-Atomizer $secondDir

$firstHash = (Get-FileHash -LiteralPath (Join-Path $firstDir "capability-atoms.jsonl") -Algorithm SHA256).Hash.ToLowerInvariant()
$secondHash = (Get-FileHash -LiteralPath (Join-Path $secondDir "capability-atoms.jsonl") -Algorithm SHA256).Hash.ToLowerInvariant()
if ($firstHash -ne $secondHash) {
    throw "Two-export identity failed: $firstHash vs $secondHash"
}

Copy-Item -LiteralPath (Join-Path $firstDir "capability-atoms.jsonl") -Destination (Join-Path $OutputDir "capability-atoms.jsonl") -Force
Copy-Item -LiteralPath (Join-Path $firstDir "inventory-manifest.json") -Destination (Join-Path $OutputDir "inventory-manifest.json") -Force
Write-Host "Wrote $OutputDir"
Write-Host "atoms_sha256=$firstHash"
