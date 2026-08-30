param(
    [string]$InventoryId = "autocad-2024.com",
    [string]$OutputDir = "",
    [string]$TlbImpPath = "C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\x64\TlbImp.exe",
    [string]$CapturedAt = "2026-08-28T00:00:00Z"
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -InventoryId $InventoryId -OutputDir $OutputDir -TlbImpPath $TlbImpPath -CapturedAt $CapturedAt
    exit $LASTEXITCODE
}

$probeDirectory = Split-Path -Parent $PSCommandPath
. (Join-Path $probeDirectory "AutoCad2024Host.ps1")
$parentProbe = Split-Path -Parent $probeDirectory
$repoRoot = Get-AutoCad2024RepoRoot -StartPath $PSCommandPath
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $repoRoot "data\datasets\staging\cad-capabilities\$InventoryId"
}
Assert-AutoCadOutputIsolation -InventoryId $InventoryId -OutputDir $OutputDir

$hostInfo = Confirm-AutoCad2024Host
$whitelist = Get-AutoCad2024WhitelistRoots -HostInfo $hostInfo
if (-not (Test-Path -LiteralPath $TlbImpPath)) {
    throw "TlbImp not found: $TlbImpPath"
}

$scanTypePath = Join-Path $parentProbe "ComCapabilityScan.cs"
if (-not ("Shb.Thcad.Probes.ComCapabilityScan" -as [Type])) {
    Add-Type -Path $scanTypePath
}

$temporaryDirectory = Join-Path $probeDirectory ".tmp-com"
New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$sources = Get-AutoCad2024TypeLibrarySources -HostInfo $hostInfo -TemporaryDirectory $temporaryDirectory -TlbImpPath $TlbImpPath
$typeLibraryJson = New-Object 'System.Collections.Generic.List[string]'
$conversionErrors = New-Object 'System.Collections.Generic.List[string]'
$reflectionErrors = New-Object 'System.Collections.Generic.List[string]'
$referencePaths = New-Object 'System.Collections.Generic.List[string]'

foreach ($source in $sources) {
    if (-not (Test-PathInWhitelist -Path $source.source -Roots $whitelist) -and -not $source.source.StartsWith($hostInfo.install_root, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-ForbiddenCadPath $source.source) {
            throw "COM type-library source is not on the AutoCAD whitelist: $($source.source)"
        }
    }
    if (Test-Path -LiteralPath $source.output) {
        Remove-Item -LiteralPath $source.output -Force
    }
    $fileName = [IO.Path]::GetFileName($source.source)
    $version = Get-FileVersionOrNull $source.source
    $sha256 = Get-FileSha256Lower $source.source
    $arguments = @(
        $source.source,
        "/out:$($source.output)",
        "/silent")
    foreach ($reference in $referencePaths) {
        $arguments += "/reference:$reference"
    }
    & $source.tlb_imp @arguments
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $source.output)) {
        $conversionErrors.Add([Shb.Thcad.Probes.ComCapabilityScan]::ErrorObject(
            $source.label,
            "TlbImp failed with exit code $LASTEXITCODE"))
        $typeLibraryJson.Add([Shb.Thcad.Probes.ComCapabilityScan]::EmptyTypeLibrary(
            $source.label,
            $source.bitness,
            $fileName,
            $version,
            $sha256))
        continue
    }
    $referencePaths.Add($source.output)
    try {
        $libraryJson = [Shb.Thcad.Probes.ComCapabilityScan]::ScanTypeLibrary(
            $source.output,
            $source.label,
            $source.bitness,
            $fileName,
            $version,
            $sha256,
            $reflectionErrors)
        $typeLibraryJson.Add($libraryJson)
    }
    catch {
        $reflectionErrors.Add([Shb.Thcad.Probes.ComCapabilityScan]::ErrorObject(
            $source.label,
            $_.Exception.Message))
        $typeLibraryJson.Add([Shb.Thcad.Probes.ComCapabilityScan]::EmptyTypeLibrary(
            $source.label,
            $source.bitness,
            $fileName,
            $version,
            $sha256))
    }
}

$progIdJson = New-Object 'System.Collections.Generic.List[string]'
foreach ($item in Get-AutoCad2024RegisteredProgIds -WhitelistRoots $whitelist) {
    $progIdJson.Add([string]$item)
}

$scanPath = Join-Path $OutputDir "com-capability-scan.json"
[Shb.Thcad.Probes.ComCapabilityScan]::WriteScanDocument(
    $scanPath,
    $InventoryId,
    "autocad-2024",
    $typeLibraryJson,
    $progIdJson,
    $conversionErrors,
    $reflectionErrors)

$atomizer = Join-Path $repoRoot "data\pipelines\cad_capabilities\com_atoms.py"
$firstDir = Join-Path $OutputDir ".emit1"
$secondDir = Join-Path $OutputDir ".emit2"
New-Item -ItemType Directory -Force -Path $firstDir | Out-Null
New-Item -ItemType Directory -Force -Path $secondDir | Out-Null
Invoke-PythonAtomizer -RepoRoot $repoRoot -PythonArgs @($atomizer, "--scan", $scanPath, "--output-dir", $firstDir, "--captured-at", $CapturedAt)
Invoke-PythonAtomizer -RepoRoot $repoRoot -PythonArgs @($atomizer, "--scan", $scanPath, "--output-dir", $secondDir, "--captured-at", $CapturedAt)
$firstHash = (Get-FileHash -LiteralPath (Join-Path $firstDir "capability-atoms.jsonl") -Algorithm SHA256).Hash.ToLowerInvariant()
$secondHash = (Get-FileHash -LiteralPath (Join-Path $secondDir "capability-atoms.jsonl") -Algorithm SHA256).Hash.ToLowerInvariant()
if ($firstHash -ne $secondHash) {
    throw "Two-export identity failed: $firstHash vs $secondHash"
}
Copy-Item -LiteralPath (Join-Path $firstDir "capability-atoms.jsonl") -Destination (Join-Path $OutputDir "capability-atoms.jsonl") -Force
Copy-Item -LiteralPath (Join-Path $firstDir "inventory-manifest.json") -Destination (Join-Path $OutputDir "inventory-manifest.json") -Force
Write-Host "Wrote $OutputDir"
Write-Host "atoms_sha256=$firstHash"
