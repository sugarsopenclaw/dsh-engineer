param(
    [string]$InventoryId = "autocad-2024.native",
    [string]$OutputDir = "",
    [string]$ScanOutput = "",
    [string]$CapturedAt = "2026-08-28T00:00:00Z"
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -InventoryId $InventoryId -OutputDir $OutputDir -ScanOutput $ScanOutput -CapturedAt $CapturedAt
    exit $LASTEXITCODE
}

$probeDirectory = Split-Path -Parent $PSCommandPath
. (Join-Path $probeDirectory "AutoCad2024Host.ps1")
$parentProbe = Split-Path -Parent $probeDirectory
$repoRoot = Get-AutoCad2024RepoRoot -StartPath $PSCommandPath
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $repoRoot "data\datasets\staging\cad-capabilities\$InventoryId"
}
if ([string]::IsNullOrWhiteSpace($ScanOutput)) {
    $ScanOutput = Join-Path $OutputDir "native-capability-scan.json"
}
Assert-AutoCadOutputIsolation -InventoryId $InventoryId -OutputDir $OutputDir
if ($ScanOutput -like "*thcad-v24*") {
    throw "AutoCAD native scan refused THCAD output path."
}

$hostInfo = Confirm-AutoCad2024Host
$modules = @(Get-AutoCad2024NativeModulePaths -HostInfo $hostInfo)
Write-Host "Scanning $($modules.Count) native modules"

$readerPath = Join-Path $parentProbe "PeExportReader.cs"
$scanTypePath = Join-Path $parentProbe "NativeCapabilityScan.cs"
if (-not ("Shb.Thcad.Probes.NativeCapabilityScan" -as [Type])) {
    Add-Type -Path @($readerPath, $scanTypePath)
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
[Shb.Thcad.Probes.NativeCapabilityScan]::WriteInventoryScanFromFiles(
    $hostInfo.install_root,
    [string[]]$modules,
    $ScanOutput,
    $InventoryId,
    "autocad-2024")
Write-Host "Wrote scan $ScanOutput"

$atomizer = Join-Path $repoRoot "data\pipelines\cad_capabilities\native_atoms.py"
$firstDir = Join-Path $OutputDir ".emit1"
$secondDir = Join-Path $OutputDir ".emit2"
New-Item -ItemType Directory -Force -Path $firstDir | Out-Null
New-Item -ItemType Directory -Force -Path $secondDir | Out-Null
Invoke-PythonAtomizer -RepoRoot $repoRoot -PythonArgs @($atomizer, "--scan", $ScanOutput, "--output-dir", $firstDir, "--captured-at", $CapturedAt)
Invoke-PythonAtomizer -RepoRoot $repoRoot -PythonArgs @($atomizer, "--scan", $ScanOutput, "--output-dir", $secondDir, "--captured-at", $CapturedAt)
$firstHash = (Get-FileHash -LiteralPath (Join-Path $firstDir "capability-atoms.jsonl") -Algorithm SHA256).Hash.ToLowerInvariant()
$secondHash = (Get-FileHash -LiteralPath (Join-Path $secondDir "capability-atoms.jsonl") -Algorithm SHA256).Hash.ToLowerInvariant()
if ($firstHash -ne $secondHash) {
    throw "Two-export identity failed: $firstHash vs $secondHash"
}
Copy-Item -LiteralPath (Join-Path $firstDir "capability-atoms.jsonl") -Destination (Join-Path $OutputDir "capability-atoms.jsonl") -Force
Copy-Item -LiteralPath (Join-Path $firstDir "inventory-manifest.json") -Destination (Join-Path $OutputDir "inventory-manifest.json") -Force
Write-Host "Wrote $OutputDir"
Write-Host "atoms_sha256=$firstHash"
