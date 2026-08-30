param(
    [string]$ThcadDirectory = "D:\THSOFT\THCAD V24_Mechanical2D\THCAD",
    [string]$MechanicalRoot = "D:\THSOFT\THCAD V24_Mechanical2D",
    [string]$ThsoftSharedDirectory = "C:\Program Files (x86)\Common Files\THSOFT Shared",
    [string]$TlbImpPath = "C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\x64\TlbImp.exe",
    [string]$TlbImp32Path = "C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\TlbImp.exe",
    [string]$InventoryId = "thcad-v24.com",
    [string]$OutputDir = "",
    [switch]$SkipRuntimeProbe
)

$ErrorActionPreference = "Stop"

$probeDirectory = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path (Join-Path $probeDirectory "..\..\..")).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $repoRoot "data\datasets\staging\cad-capabilities\$InventoryId"
}

$scanTypePath = Join-Path $probeDirectory "ComCapabilityScan.cs"
if (-not ("Shb.Thcad.Probes.ComCapabilityScan" -as [Type])) {
    Add-Type -Path $scanTypePath
}

function Get-FileSha256Lower {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-FileVersionOrNull {
    param([string]$Path)
    $info = (Get-Item -LiteralPath $Path).VersionInfo
    foreach ($candidate in @($info.FileVersion, $info.ProductVersion)) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            return $candidate.Trim()
        }
    }
    return $null
}

function Get-ThcadComTypeLibrarySources {
    param(
        [string]$ThcadDirectory,
        [string]$MechanicalRoot,
        [string]$ThsoftSharedDirectory,
        [string]$TlbImpPath,
        [string]$TlbImp32Path,
        [string]$TemporaryDirectory
    )
    return @(
        [ordered]@{
            label = "BricscadDb"
            source = Join-Path $ThcadDirectory "axbricscaddb1.dll"
            output = Join-Path $TemporaryDirectory "BricscadDb.Interop.dll"
            bitness = "64-bit"
            tlb_imp = $TlbImpPath
        },
        [ordered]@{
            label = "BricscadApp"
            source = Join-Path $ThcadDirectory "axbricscadapp1.dll"
            output = Join-Path $TemporaryDirectory "BricscadApp.Interop.dll"
            bitness = "64-bit"
            tlb_imp = $TlbImpPath
        },
        [ordered]@{
            label = "BricscadSm"
            source = Join-Path $ThcadDirectory "axbricscadsm.dll"
            output = Join-Path $TemporaryDirectory "BricscadSm.Interop.dll"
            bitness = "64-bit"
            tlb_imp = $TlbImpPath
        },
        [ordered]@{
            label = "THCadToolKit"
            source = Join-Path $MechanicalRoot "V24\THCadToolKit.arx"
            output = Join-Path $TemporaryDirectory "THCadToolKit.Interop.dll"
            bitness = "64-bit"
            tlb_imp = $TlbImpPath
        },
        [ordered]@{
            label = "THCADComReport"
            source = Join-Path $ThsoftSharedDirectory "THCADComReport.ocx"
            output = Join-Path $TemporaryDirectory "THCADComReport.Interop.dll"
            bitness = "32-bit"
            tlb_imp = $TlbImp32Path
        },
        [ordered]@{
            label = "THCADsCardInfoX"
            source = Join-Path $ThsoftSharedDirectory "THCADsCardInfoX.dll"
            output = Join-Path $TemporaryDirectory "THCADsCardInfoX.Interop.dll"
            bitness = "32-bit"
            tlb_imp = $TlbImp32Path
        },
        [ordered]@{
            label = "THCADsCardEngine"
            source = Join-Path $ThsoftSharedDirectory "THCADsCardEngine.dll"
            output = Join-Path $TemporaryDirectory "THCADsCardEngine.Interop.dll"
            bitness = "32-bit"
            tlb_imp = $TlbImp32Path
        },
        [ordered]@{
            label = "THCADReport"
            source = Join-Path $ThsoftSharedDirectory "THCADReport.ocx"
            output = Join-Path $TemporaryDirectory "THCADReport.Interop.dll"
            bitness = "32-bit"
            tlb_imp = $TlbImp32Path
        },
        [ordered]@{
            label = "THCADPickUp"
            source = Join-Path $ThsoftSharedDirectory "THCADPickUp.ocx"
            output = Join-Path $TemporaryDirectory "THCADPickUp.Interop.dll"
            bitness = "32-bit"
            tlb_imp = $TlbImp32Path
        },
        [ordered]@{
            label = "THCADPickUpEngine"
            source = Join-Path $ThsoftSharedDirectory "THCADPickUpEngine.dll"
            output = Join-Path $TemporaryDirectory "THCADPickUpEngine.Interop.dll"
            bitness = "32-bit"
            tlb_imp = $TlbImp32Path
        }
    )
}

function Get-ThcadComRegisteredProgIds {
    $registered = New-Object 'System.Collections.Generic.List[string]'
    $prefixPattern = "^(BricscadApp|BricscadDb|BricscadSm|THCadToolKit|THCAD)"
    foreach ($key in Get-ChildItem -Path "Registry::HKEY_CLASSES_ROOT" -ErrorAction SilentlyContinue) {
        if ($key.PSChildName -notmatch $prefixPattern) {
            continue
        }
        $classIdPath = Join-Path $key.PSPath "CLSID"
        if (-not (Test-Path -LiteralPath $classIdPath)) {
            continue
        }
        $classId = (Get-ItemProperty -LiteralPath $classIdPath -ErrorAction SilentlyContinue)."(default)"
        if ([string]::IsNullOrWhiteSpace($classId)) {
            continue
        }
        $classPath = "Registry::HKEY_CLASSES_ROOT\CLSID\$classId"
        $registryView = "64-bit"
        if (-not (Test-Path -LiteralPath $classPath)) {
            $classPath = "Registry::HKEY_CLASSES_ROOT\WOW6432Node\CLSID\$classId"
            $registryView = "32-bit"
        }
        $inprocPath = Join-Path $classPath "InprocServer32"
        $localPath = Join-Path $classPath "LocalServer32"
        $typeLibPath = Join-Path $classPath "TypeLib"
        $inproc = $null
        $local = $null
        $typeLib = $null
        if (Test-Path -LiteralPath $inprocPath) {
            $inproc = (Get-ItemProperty -LiteralPath $inprocPath -ErrorAction SilentlyContinue)."(default)"
        }
        if (Test-Path -LiteralPath $localPath) {
            $local = (Get-ItemProperty -LiteralPath $localPath -ErrorAction SilentlyContinue)."(default)"
        }
        if (Test-Path -LiteralPath $typeLibPath) {
            $typeLib = (Get-ItemProperty -LiteralPath $typeLibPath -ErrorAction SilentlyContinue)."(default)"
        }
        $serverKind = if ($inproc) { "inproc" } elseif ($local) { "local" } else { "unknown" }
        $registered.Add([Shb.Thcad.Probes.ComCapabilityScan]::ProgIdObject(
            $key.PSChildName,
            $classId,
            $serverKind,
            $typeLib,
            $registryView))
    }
    return @($registered | Sort-Object)
}

if (-not (Test-Path -LiteralPath $ThcadDirectory)) {
    throw "THCAD directory not found: $ThcadDirectory"
}
if (-not (Test-Path -LiteralPath $MechanicalRoot)) {
    throw "Mechanical root not found: $MechanicalRoot"
}
if (-not (Test-Path -LiteralPath $ThsoftSharedDirectory)) {
    throw "THSOFT shared directory not found: $ThsoftSharedDirectory"
}
if (-not (Test-Path -LiteralPath $TlbImpPath)) {
    throw "TlbImp not found: $TlbImpPath"
}
if (-not (Test-Path -LiteralPath $TlbImp32Path)) {
    throw "32-bit TlbImp not found: $TlbImp32Path"
}

$temporaryDirectory = Join-Path $probeDirectory ".tmp-com"
New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null

$sources = Get-ThcadComTypeLibrarySources `
    -ThcadDirectory $ThcadDirectory `
    -MechanicalRoot $MechanicalRoot `
    -ThsoftSharedDirectory $ThsoftSharedDirectory `
    -TlbImpPath $TlbImpPath `
    -TlbImp32Path $TlbImp32Path `
    -TemporaryDirectory $temporaryDirectory

$typeLibraryJson = New-Object 'System.Collections.Generic.List[string]'
$conversionErrors = New-Object 'System.Collections.Generic.List[string]'
$reflectionErrors = New-Object 'System.Collections.Generic.List[string]'

foreach ($source in $sources) {
    if (-not (Test-Path -LiteralPath $source.source)) {
        throw "COM type-library source not found: $($source.source)"
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
    if ($source.label -eq "BricscadApp") {
        $arguments += "/reference:$($sources[0].output)"
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
foreach ($item in Get-ThcadComRegisteredProgIds) {
    $progIdJson.Add([string]$item)
}

$scanPath = Join-Path $temporaryDirectory "com-capability-scan.json"
[Shb.Thcad.Probes.ComCapabilityScan]::WriteScanDocument(
    $scanPath,
    $InventoryId,
    "thcad-v24",
    $typeLibraryJson,
    $progIdJson,
    $conversionErrors,
    $reflectionErrors)

if (-not $SkipRuntimeProbe) {
    $runtimeProbePath = Join-Path $probeDirectory "ProbeThcadComRuntime.ps1"
    $runtime32ProbePath = Join-Path $probeDirectory "ProbeThcadCom32Runtime.ps1"
    try {
        $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
        $runtimeJson = & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $runtimeProbePath
        Write-Host "Runtime probe (64-bit): $runtimeJson"
    }
    catch {
        Write-Host "Runtime probe (64-bit) failed: $($_.Exception.Message)"
    }
    try {
        $windowsPowerShell32 = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
        $runtime32Json = & $windowsPowerShell32 -NoProfile -Sta -ExecutionPolicy Bypass -File $runtime32ProbePath
        Write-Host "Runtime probe (32-bit): $runtime32Json"
    }
    catch {
        Write-Host "Runtime probe (32-bit) failed: $($_.Exception.Message)"
    }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$atomizer = Join-Path $repoRoot "data\pipelines\cad_capabilities\com_atoms.py"
$backend = Join-Path $repoRoot "backend"
$uv = Get-Command uv -ErrorAction SilentlyContinue
if ($uv) {
    & uv run --project $backend python $atomizer --scan $scanPath --output-dir $OutputDir
}
else {
    & python $atomizer --scan $scanPath --output-dir $OutputDir
}
if ($LASTEXITCODE -ne 0) {
    throw "COM atomizer failed with exit code $LASTEXITCODE"
}

Write-Host "Wrote $OutputDir"
