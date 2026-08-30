$ErrorActionPreference = "Stop"

function Get-AutoCad2024RepoRoot {
    param([string]$StartPath = $PSCommandPath)
    $probeDirectory = Split-Path -Parent $StartPath
    return (Resolve-Path (Join-Path $probeDirectory "..\..\..\..")).Path
}

function Test-ForbiddenCadPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }
    return $Path -match '(?i)thcad|thsoft|bricscad'
}

function Assert-AutoCadOutputIsolation {
    param(
        [string]$InventoryId,
        [string]$OutputDir
    )
    if ($InventoryId -notlike "autocad-2024.*") {
        throw "AutoCAD export requires inventory_id autocad-2024.*, got $InventoryId"
    }
    if ($InventoryId -like "*thcad-v24*" -or $OutputDir -like "*thcad-v24*") {
        throw "AutoCAD 输出拒绝指向 thcad-v24.*: inventory_id=$InventoryId output_dir=$OutputDir"
    }
    if (Test-ForbiddenCadPath $OutputDir) {
        throw "AutoCAD output directory is not on the product whitelist: $OutputDir"
    }
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

function Confirm-AutoCad2024Host {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='acad.exe'")
    if ($procs.Count -eq 0) {
        throw "No acad.exe process is running."
    }
    if ($procs.Count -ne 1) {
        $paths = ($procs | ForEach-Object { "$($_.ProcessId):$($_.ExecutablePath)" }) -join "; "
        throw "Multiple acad.exe processes cannot be distinguished: $paths"
    }
    $proc = $procs[0]
    $acadPath = [string]$proc.ExecutablePath
    if ([string]::IsNullOrWhiteSpace($acadPath) -or -not (Test-Path -LiteralPath $acadPath)) {
        throw "Running acad.exe path is unavailable."
    }
    if (Test-ForbiddenCadPath $acadPath) {
        throw "Running acad.exe is not AutoCAD: $acadPath"
    }
    $item = Get-Item -LiteralPath $acadPath
    $vi = $item.VersionInfo
    $bytes = [IO.File]::ReadAllBytes($acadPath)
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
    $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
    $bitness = if ($machine -eq 0x8664) { "x64" } elseif ($machine -eq 0x14c) { "x86" } else { ("0x{0:X4}" -f $machine) }
    $reg = Get-ItemProperty "HKLM:\SOFTWARE\Autodesk\AutoCAD\R24.3\ACAD-7101:804" -ErrorAction Stop
    $installRoot = [string]$reg.AcadLocation
    if ([string]::IsNullOrWhiteSpace($installRoot)) {
        $installRoot = [string]$reg.Location
    }
    $installRoot = $installRoot.TrimEnd("\")
    if ($reg.ProductNameGlob -ne "AutoCAD 2024" -or [string]$reg.UPIRELEASE -ne "2024") {
        throw "Registry product is not AutoCAD 2024: $($reg.ProductNameGlob) / $($reg.UPIRELEASE)"
    }
    if ($vi.ProductName -notmatch "AutoCAD" -or $vi.FileVersion -notmatch "24\.3") {
        throw "File version is not AutoCAD 2024: $($vi.ProductName) $($vi.FileVersion)"
    }
    if (-not $acadPath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "acad.exe is not under the AutoCAD 2024 install root: $acadPath vs $installRoot"
    }

    $com = $null
    foreach ($progId in @("AutoCAD.Application.24", "AutoCAD.Application.24.3", "AutoCAD.Application")) {
        try {
            $app = [Runtime.InteropServices.Marshal]::GetActiveObject($progId)
            $com = [ordered]@{
                prog_id = $progId
                name = [string]$app.Name
                version = [string]$app.Version
                full_name = [string]$app.FullName
                path = [string]$app.Path
                caption = [string]$app.Caption
            }
            if ($com.name -notmatch "(?i)autocad" -or $com.name -match "(?i)thcad|bricscad") {
                throw "COM application is not AutoCAD: $($com.name)"
            }
            break
        }
        catch {
            if ($_.Exception.Message -match "not AutoCAD") {
                throw
            }
        }
    }
    if ($null -eq $com) {
        throw "Failed to attach AutoCAD.Application via COM/ROT."
    }

    $loaded = @()
    try {
        $process = Get-Process -Id $proc.ProcessId
        foreach ($module in $process.Modules) {
            $fileName = [string]$module.FileName
            if ($fileName -and $fileName.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
                $loaded += $fileName
            }
        }
    }
    catch {
    }

    return [ordered]@{
        confirmed = $true
        observed_host_id = "autocad-2024"
        product_name = [string]$reg.ProductNameGlob
        full_version = [string]$vi.FileVersion
        release = [string]$reg.Release
        bitness = $bitness
        install_root = $installRoot
        process = [ordered]@{
            pid = [int]$proc.ProcessId
            path = $acadPath
            command_line = [string]$proc.CommandLine
        }
        file_version = [ordered]@{
            product_name = [string]$vi.ProductName
            file_description = [string]$vi.FileDescription
            company_name = [string]$vi.CompanyName
            file_version = [string]$vi.FileVersion
            product_version = [string]$vi.ProductVersion
        }
        registry = [ordered]@{
            key = "HKLM:\SOFTWARE\Autodesk\AutoCAD\R24.3\ACAD-7101:804"
            ProductNameGlob = [string]$reg.ProductNameGlob
            UPIRELEASE = [string]$reg.UPIRELEASE
            AcadLocation = $installRoot
            Release = [string]$reg.Release
            LangAbbrev = [string]$reg.LangAbbrev
        }
        com_rot = $com
        loaded_modules = @($loaded)
        evidence_sources = @("process_path", "file_version", "registry", "com_rot")
    }
}

function Get-AutoCad2024WhitelistRoots {
    param($HostInfo)
    $hkcu = Get-ItemProperty "HKCU:\SOFTWARE\Autodesk\AutoCAD\R24.3\ACAD-7101:804" -ErrorAction SilentlyContinue
    $roots = New-Object 'System.Collections.Generic.List[string]'
    foreach ($candidate in @(
            $HostInfo.install_root,
            "C:\Program Files\Common Files\Autodesk Shared",
            "C:\Program Files (x86)\Common Files\Autodesk Shared",
            $hkcu.RoamableRootFolder,
            $hkcu.SupportFolder,
            $hkcu.SupportFolderLang,
            $hkcu.LocalRootFolder
        )) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $resolved = $candidate.TrimEnd("\")
        if ((Test-Path -LiteralPath $resolved) -and -not (Test-ForbiddenCadPath $resolved)) {
            if (-not $roots.Contains($resolved)) {
                $roots.Add($resolved)
            }
        }
    }
    return @($roots)
}

function Test-PathInWhitelist {
    param(
        [string]$Path,
        [string[]]$Roots
    )
    if ([string]::IsNullOrWhiteSpace($Path) -or (Test-ForbiddenCadPath $Path)) {
        return $false
    }
    foreach ($root in $Roots) {
        if ($Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Get-AutoCad2024TypeLibrarySources {
    param(
        $HostInfo,
        [string]$TemporaryDirectory,
        [string]$TlbImpPath
    )
    $locale = ([string]$HostInfo.registry.LangAbbrev).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($locale)) {
        $locale = "chs"
    }
    $shared = "C:\Program Files\Common Files\Autodesk Shared"
    $sources = @()
    $pairs = @(
        @{ label = "AutoCADAxDb"; file = "axdb24$locale.tlb"; bitness = "64-bit" },
        @{ label = "AcAuthEntities"; file = "AcAuthEntities24$locale.tlb"; bitness = "64-bit" },
        @{ label = "AutoCAD"; file = "acax24$locale.tlb"; bitness = "64-bit" }
    )
    foreach ($pair in $pairs) {
        $source = Join-Path $shared $pair.file
        if (-not (Test-Path -LiteralPath $source)) {
            throw "Required AutoCAD type library not found: $source"
        }
        if (Test-ForbiddenCadPath $source) {
            throw "Type library is not on the AutoCAD whitelist: $source"
        }
        $sources += [ordered]@{
            label = $pair.label
            source = $source
            output = Join-Path $TemporaryDirectory ($pair.label + ".Interop.dll")
            bitness = $pair.bitness
            tlb_imp = $TlbImpPath
        }
    }
    $vlisp = Join-Path $HostInfo.install_root "vl16_u.tlb"
    if (Test-Path -LiteralPath $vlisp) {
        $sources += [ordered]@{
            label = "VLAX"
            source = $vlisp
            output = Join-Path $TemporaryDirectory "VLAX.Interop.dll"
            bitness = "64-bit"
            tlb_imp = $TlbImpPath
        }
    }
    return $sources
}

function Get-AutoCad2024RegisteredProgIds {
    param([string[]]$WhitelistRoots)
    $registered = New-Object 'System.Collections.Generic.List[string]'
    foreach ($key in Get-ChildItem -Path "Registry::HKEY_CLASSES_ROOT" -ErrorAction SilentlyContinue) {
        if ($key.PSChildName -notlike "AutoCAD.*") {
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
        $server = $inproc
        if (-not $server) {
            $server = $local
        }
        $serverPath = $null
        if ($server) {
            $serverPath = ($server -split ' /')[0].Trim('"')
        }
        if ($serverPath -and -not (Test-PathInWhitelist -Path $serverPath -Roots $WhitelistRoots)) {
            continue
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

function Get-AutoCad2024ManagedAssemblyNames {
    param($HostInfo)
    $preferred = @(
        "accoremgd",
        "acdbmgd",
        "acmgd",
        "acdbmgdbrep",
        "AcCui",
        "AcMPolygonMGD",
        "AdWindows",
        "AdUIMgd",
        "AcTcMgd"
    )
    $found = New-Object 'System.Collections.Generic.List[string]'
    foreach ($name in $preferred) {
        $path = Join-Path $HostInfo.install_root ($name + ".dll")
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }
        try {
            $assemblyName = [Reflection.AssemblyName]::GetAssemblyName($path)
            if ($assemblyName.Name -and -not $found.Contains($assemblyName.Name)) {
                $found.Add($assemblyName.Name)
            }
        }
        catch {
        }
    }
    if ($found.Count -eq 0) {
        throw "No public AutoCAD managed assemblies were discovered under $($HostInfo.install_root)"
    }
    return @($found)
}

function Get-AutoCad2024LispSourceTrees {
    param($HostInfo)
    $hkcu = Get-ItemProperty "HKCU:\SOFTWARE\Autodesk\AutoCAD\R24.3\ACAD-7101:804" -ErrorAction SilentlyContinue
    $trees = @()
    $pairs = @(
        @{ prefix = "support"; path = Join-Path $HostInfo.install_root "Support" },
        @{ prefix = "express"; path = Join-Path $HostInfo.install_root "Express" },
        @{ prefix = "sample"; path = Join-Path $HostInfo.install_root "Sample" },
        @{ prefix = "tutorial"; path = Join-Path $HostInfo.install_root "Tutorial" },
        @{ prefix = "userdata-cache"; path = Join-Path $HostInfo.install_root "UserDataCache" },
        @{ prefix = "roaming-support"; path = Join-Path $hkcu.RoamableRootFolder "Support" }
    )
    foreach ($pair in $pairs) {
        if ([string]::IsNullOrWhiteSpace($pair.path)) {
            continue
        }
        if ((Test-Path -LiteralPath $pair.path) -and -not (Test-ForbiddenCadPath $pair.path)) {
            $trees += [ordered]@{ prefix = $pair.prefix; path = $pair.path }
        }
    }
    if ($trees.Count -eq 0) {
        throw "No AutoCAD LISP/CUI source trees were discovered."
    }
    return $trees
}

function Get-AutoCad2024NativeModulePaths {
    param($HostInfo)
    $files = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($pattern in @("*.arx", "*.crx", "*.dbx")) {
        Get-ChildItem -LiteralPath $HostInfo.install_root -Filter $pattern -File -Recurse -ErrorAction SilentlyContinue |
            ForEach-Object { [void]$files.Add($_.FullName) }
    }
    foreach ($name in @("acad.exe", "accore.dll", "acdb24.dll", "ac1st24.dll", "AcGe24.dll", "acui24.dll")) {
        $path = Join-Path $HostInfo.install_root $name
        if (Test-Path -LiteralPath $path) {
            [void]$files.Add($path)
        }
    }
    foreach ($loaded in @($HostInfo.loaded_modules)) {
        if ($loaded -and (Test-Path -LiteralPath $loaded) -and -not (Test-ForbiddenCadPath $loaded)) {
            $ext = [IO.Path]::GetExtension($loaded).ToLowerInvariant()
            if ($ext -in @(".exe", ".dll", ".arx", ".crx", ".dbx")) {
                [void]$files.Add($loaded)
            }
        }
    }
    $sorted = @($files | Sort-Object { $_.ToLowerInvariant() })
    if ($sorted.Count -eq 0) {
        throw "No AutoCAD native modules were discovered."
    }
    return $sorted
}

function Invoke-PythonAtomizer {
    param(
        [string]$RepoRoot,
        [string[]]$PythonArgs
    )
    $backend = Join-Path $RepoRoot "backend"
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
        & uv run --project $backend python @PythonArgs
    }
    else {
        & python @PythonArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Atomizer failed with exit code $LASTEXITCODE"
    }
}
