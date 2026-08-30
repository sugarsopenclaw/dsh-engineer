param(
    [string]$InventoryId = "autocad-2024.dotnet",
    [string]$OutputDir = "",
    [string]$ProbeDirectory = "",
    [string]$RepoRoot = "",
    [string]$CapturedAt = "2026-08-28T00:00:00Z",
    [string[]]$AssemblyNames = @()
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProbeDirectory)) {
    $ProbeDirectory = Split-Path -Parent $PSCommandPath
}
. (Join-Path $ProbeDirectory "AutoCad2024Host.ps1")
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Get-AutoCad2024RepoRoot -StartPath $PSCommandPath
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "data\datasets\staging\cad-capabilities\$InventoryId"
}

if ($AssemblyNames.Count -eq 1 -and $AssemblyNames[0] -like "*,*") {
    $AssemblyNames = @($AssemblyNames[0].Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $source = Get-Content -LiteralPath $PSCommandPath -Raw -Encoding UTF8
    $windowsScript = Join-Path $env:TEMP "ExportAutoCad2024DotNetCapabilityAtoms.windows.ps1"
    [IO.File]::WriteAllText($windowsScript, $source, [Text.Encoding]::Unicode)
    $joined = ""
    if ($AssemblyNames.Count -gt 0) {
        $joined = ($AssemblyNames -join ",")
    }
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $windowsScript `
        -InventoryId $InventoryId `
        -OutputDir $OutputDir `
        -ProbeDirectory $ProbeDirectory `
        -RepoRoot $RepoRoot `
        -CapturedAt $CapturedAt `
        -AssemblyNames $joined
    exit $LASTEXITCODE
}

Assert-AutoCadOutputIsolation -InventoryId $InventoryId -OutputDir $OutputDir
$hostInfo = Confirm-AutoCad2024Host
$parentProbe = Split-Path -Parent $ProbeDirectory
$scanTypePath = Join-Path $parentProbe "DotNetCapabilityScan.cs"
if (-not ("Shb.Thcad.Probes.DotNetCapabilityScan" -as [Type])) {
    Add-Type -Path $scanTypePath
}

$productDirectory = $hostInfo.install_root
if (-not (Test-Path -LiteralPath $productDirectory -PathType Container)) {
    throw "AutoCAD directory not found: $productDirectory"
}
if (Test-ForbiddenCadPath $productDirectory) {
    throw "AutoCAD directory failed whitelist: $productDirectory"
}

if ($AssemblyNames.Count -eq 0) {
    $AssemblyNames = @(Get-AutoCad2024ManagedAssemblyNames -HostInfo $hostInfo)
}

$managedFiles = @()
foreach ($file in Get-ChildItem -LiteralPath $productDirectory -Filter "*.dll" -File) {
    try {
        $assemblyName = [Reflection.AssemblyName]::GetAssemblyName($file.FullName)
        $managedFiles += [pscustomobject]@{
            File = $file
            AssemblyName = $assemblyName
        }
    }
    catch {
    }
}

$targetNames = @($AssemblyNames)
Write-Host "Scanning $($targetNames.Count) assemblies: $($targetNames -join ', ')"
foreach ($name in $targetNames) {
    $match = @($managedFiles | Where-Object { $_.AssemblyName.Name -eq $name })
    if ($match.Count -eq 0) {
        throw "Target assembly not found in AutoCAD directory: $name"
    }
}

$targetAssemblies = @()
foreach ($managed in $managedFiles) {
    $targetAssemblies += [Reflection.Assembly]::ReflectionOnlyLoadFrom($managed.File.FullName)
}

$loadQueue = [System.Collections.Generic.Queue[Reflection.Assembly]]::new()
foreach ($assembly in $targetAssemblies) {
    $loadQueue.Enqueue($assembly)
}
while ($loadQueue.Count -gt 0) {
    $assembly = $loadQueue.Dequeue()
    foreach ($reference in $assembly.GetReferencedAssemblies()) {
        $alreadyLoaded = [AppDomain]::CurrentDomain.ReflectionOnlyGetAssemblies() |
            Where-Object { $_.FullName -eq $reference.FullName } |
            Select-Object -First 1
        if ($null -ne $alreadyLoaded) {
            continue
        }
        $localPath = Join-Path $productDirectory ($reference.Name + ".dll")
        try {
            $dependency = if (Test-Path -LiteralPath $localPath) {
                [Reflection.Assembly]::ReflectionOnlyLoadFrom($localPath)
            }
            else {
                [Reflection.Assembly]::ReflectionOnlyLoad($reference.FullName)
            }
            if ($null -ne $dependency) {
                $loadQueue.Enqueue($dependency)
            }
        }
        catch {
        }
    }
}

$temporaryDirectory = Join-Path $ProbeDirectory ".tmp-dotnet"
New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$assemblyJson = New-Object 'System.Collections.Generic.List[string]'
$conversionErrors = New-Object 'System.Collections.Generic.List[string]'
$reflectionErrors = New-Object 'System.Collections.Generic.List[string]'

foreach ($name in $targetNames) {
    $managed = @($managedFiles | Where-Object { $_.AssemblyName.Name -eq $name } | Select-Object -First 1)[0]
    $fileName = $managed.File.Name
    $version = $managed.AssemblyName.Version.ToString()
    $sha256 = (Get-FileHash -LiteralPath $managed.File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    try {
        $json = [Shb.Thcad.Probes.DotNetCapabilityScan]::ScanNamedAssembly(
            $name,
            $fileName,
            $version,
            $sha256,
            $reflectionErrors)
        $assemblyJson.Add($json)
    }
    catch {
        $conversionErrors.Add([Shb.Thcad.Probes.DotNetCapabilityScan]::ErrorObject(
            $name,
            $_.Exception.Message))
        $assemblyJson.Add([Shb.Thcad.Probes.DotNetCapabilityScan]::EmptyAssembly(
            $name,
            $fileName,
            $version,
            $sha256))
    }
}

$scanPath = Join-Path $OutputDir "dotnet-capability-scan.json"
[Shb.Thcad.Probes.DotNetCapabilityScan]::WriteScanDocument(
    $scanPath,
    $InventoryId,
    "autocad-2024",
    $assemblyJson,
    $conversionErrors,
    $reflectionErrors)

$atomizer = Join-Path $RepoRoot "data\pipelines\cad_capabilities\dotnet_atoms.py"
$firstDir = Join-Path $OutputDir ".emit1"
$secondDir = Join-Path $OutputDir ".emit2"
New-Item -ItemType Directory -Force -Path $firstDir | Out-Null
New-Item -ItemType Directory -Force -Path $secondDir | Out-Null
Invoke-PythonAtomizer -RepoRoot $RepoRoot -PythonArgs @($atomizer, "--scan", $scanPath, "--output-dir", $firstDir, "--captured-at", $CapturedAt)
Invoke-PythonAtomizer -RepoRoot $RepoRoot -PythonArgs @($atomizer, "--scan", $scanPath, "--output-dir", $secondDir, "--captured-at", $CapturedAt)
$firstHash = (Get-FileHash -LiteralPath (Join-Path $firstDir "capability-atoms.jsonl") -Algorithm SHA256).Hash.ToLowerInvariant()
$secondHash = (Get-FileHash -LiteralPath (Join-Path $secondDir "capability-atoms.jsonl") -Algorithm SHA256).Hash.ToLowerInvariant()
if ($firstHash -ne $secondHash) {
    throw "Two-export identity failed: $firstHash vs $secondHash"
}
Copy-Item -LiteralPath (Join-Path $firstDir "capability-atoms.jsonl") -Destination (Join-Path $OutputDir "capability-atoms.jsonl") -Force
Copy-Item -LiteralPath (Join-Path $firstDir "inventory-manifest.json") -Destination (Join-Path $OutputDir "inventory-manifest.json") -Force
Write-Host "Wrote $OutputDir"
Write-Host "atoms_sha256=$firstHash"
Write-Host "assemblies=$($targetNames -join ',')"
