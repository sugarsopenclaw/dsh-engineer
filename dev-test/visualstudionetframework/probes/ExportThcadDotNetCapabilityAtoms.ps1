param(
    [string]$ThcadDirectory = "D:\THSOFT\THCAD V24_Mechanical2D\THCAD",
    [string]$InventoryId = "thcad-v24.dotnet",
    [string]$OutputDir = "",
    [string]$ProbeDirectory = "",
    [string]$RepoRoot = "",
    [string[]]$AssemblyNames = @(
        "BrxMgd",
        "TA_Mgd",
        "TA_MgdArch",
        "TA_MgdStructure",
        "TD_Mgd",
        "TD_MgdBrep",
        "TD_MgdDbConstraints"
    )
)

$ErrorActionPreference = "Stop"

if ($AssemblyNames.Count -eq 1 -and $AssemblyNames[0] -like "*,*") {
    $AssemblyNames = @($AssemblyNames[0].Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

if ([string]::IsNullOrWhiteSpace($ProbeDirectory)) {
    $ProbeDirectory = Split-Path -Parent $PSCommandPath
}
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path (Join-Path $ProbeDirectory "..\..\..")).Path
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "data\datasets\staging\cad-capabilities\$InventoryId"
}

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $source = Get-Content -LiteralPath $PSCommandPath -Raw -Encoding UTF8
    $windowsScript = Join-Path $env:TEMP "ExportThcadDotNetCapabilityAtoms.windows.ps1"
    [IO.File]::WriteAllText($windowsScript, $source, [Text.Encoding]::Unicode)
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $windowsScript `
        -ThcadDirectory $ThcadDirectory `
        -InventoryId $InventoryId `
        -OutputDir $OutputDir `
        -ProbeDirectory $ProbeDirectory `
        -RepoRoot $RepoRoot `
        -AssemblyNames ($AssemblyNames -join ",")
    exit $LASTEXITCODE
}

$scanTypePath = Join-Path $ProbeDirectory "DotNetCapabilityScan.cs"
if (-not ("Shb.Thcad.Probes.DotNetCapabilityScan" -as [Type])) {
    Add-Type -Path $scanTypePath
}

if (-not (Test-Path -LiteralPath $ThcadDirectory -PathType Container)) {
    throw "THCAD directory not found: $ThcadDirectory"
}

$managedFiles = @()
foreach ($file in Get-ChildItem -LiteralPath $ThcadDirectory -Filter "*.dll" -File) {
    try {
        $assemblyName = [Reflection.AssemblyName]::GetAssemblyName($file.FullName)
        $managedFiles += [pscustomobject]@{
            File = $file
            AssemblyName = $assemblyName
        }
    }
    catch {
        # Native DLL.
    }
}

$targetNames = @($AssemblyNames)
Write-Host "Scanning $($targetNames.Count) assemblies: $($targetNames -join ', ')"
foreach ($name in $targetNames) {
    $match = @($managedFiles | Where-Object { $_.AssemblyName.Name -eq $name })
    if ($match.Count -eq 0) {
        throw "Target assembly not found in THCAD directory: $name"
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
        $localPath = Join-Path $ThcadDirectory ($reference.Name + ".dll")
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
            # GetExportedTypes records missing dependencies.
        }
    }
}

$temporaryDirectory = Join-Path $ProbeDirectory ".tmp-dotnet"
New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null

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

$scanPath = Join-Path $temporaryDirectory "dotnet-capability-scan.json"
[Shb.Thcad.Probes.DotNetCapabilityScan]::WriteScanDocument(
    $scanPath,
    $InventoryId,
    "thcad-v24",
    $assemblyJson,
    $conversionErrors,
    $reflectionErrors)

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$atomizer = Join-Path $RepoRoot "data\pipelines\cad_capabilities\dotnet_atoms.py"
$backend = Join-Path $RepoRoot "backend"
$uv = Get-Command uv -ErrorAction SilentlyContinue
if ($uv) {
    & uv run --project $backend python $atomizer --scan $scanPath --output-dir $OutputDir
}
else {
    & python $atomizer --scan $scanPath --output-dir $OutputDir
}
if ($LASTEXITCODE -ne 0) {
    throw "NET atomizer failed with exit code $LASTEXITCODE"
}

Write-Host "Wrote $OutputDir"
