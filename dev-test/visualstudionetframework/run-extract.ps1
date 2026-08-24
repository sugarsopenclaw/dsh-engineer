# Batch-extract transformer DWGs via AutoCAD 2024 accoreconsole + Shb.AutoCAD.Extractor.
param(
    [string]$Drawing = "",
    [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $root "..\..")).Path
$acadDir = "D:\autocad2024\AutoCAD 2024"
$accore = Join-Path $acadDir "accoreconsole.exe"
$msbuild = "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"
$csproj = Join-Path $root "ClassLibrary1\ClassLibrary1\ClassLibrary1.csproj"
$dll = Join-Path $root "ClassLibrary1\ClassLibrary1\bin\x64\$Configuration\Shb.AutoCAD.Extractor.dll"
$outRoot = Join-Path $root "out"
$dwgRoot = Join-Path $repo "client-data\transformer-design-drawings"
$scriptDir = Join-Path $root "scripts"
$logDir = Join-Path $outRoot "_logs"

if (-not (Test-Path $accore)) { throw "accoreconsole not found: $accore" }
if (-not (Test-Path $msbuild)) { throw "MSBuild not found: $msbuild" }

Write-Host "Building $csproj"
& $msbuild $csproj /p:Configuration=$Configuration /p:Platform=x64 /v:minimal
if ($LASTEXITCODE -ne 0) { throw "MSBuild failed: $LASTEXITCODE" }
if (-not (Test-Path $dll)) { throw "DLL not built: $dll" }

New-Item -ItemType Directory -Force -Path $outRoot, $scriptDir, $logDir | Out-Null
$env:SHB_EXTRACT_OUT = $outRoot

if ($Drawing) {
    $dwgs = @(Get-Item -LiteralPath $Drawing)
} else {
    $dwgs = @(Get-ChildItem -LiteralPath $dwgRoot -Filter *.DWG)
}
if ($dwgs.Count -eq 0) { throw "No DWG files to extract." }

$dllScr = $dll.Replace("\", "\\")
Set-Content -LiteralPath (Join-Path (Split-Path $dll) "output-root.txt") -Value $outRoot -Encoding ASCII

foreach ($dwg in $dwgs) {
    $stem = [IO.Path]::GetFileNameWithoutExtension($dwg.Name)
    $scr = Join-Path $scriptDir "$stem.scr"
    $log = Join-Path $logDir "$stem.log"
    @"
FILEDIA 0
CMDECHO 1
PROXYNOTICE 0
SECURELOAD 0
(command "._NETLOAD" "$dllScr")
SHBEXTRACT
QUIT
N
"@ | Set-Content -LiteralPath $scr -Encoding ASCII

    Write-Host "---- $($dwg.Name) ----"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $errLog = "$log.err"
    $p = Start-Process -FilePath $accore -ArgumentList @("/i", $dwg.FullName, "/s", $scr) -WorkingDirectory $acadDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog
    if (-not $p.WaitForExit(180000)) {
        Write-Warning "accoreconsole timed out for $($dwg.Name); killing PID $($p.Id)"
        Stop-Process -Id $p.Id -Force
        $code = -1
    } else {
        $code = $p.ExitCode
        if ($null -eq $code) { $code = 0 }
    }
    $sw.Stop()
    Write-Host "accoreconsole exit=$code elapsed_s=$([math]::Round($sw.Elapsed.TotalSeconds, 1)) log=$log"
    if ($code -ne 0) {
        Write-Warning "accoreconsole failed for $($dwg.Name) (exit $code)"
    }
}

Write-Host "Output root: $outRoot"
Get-ChildItem $outRoot -Directory | ForEach-Object {
    $report = Join-Path $_.FullName "extraction-report.json"
    if (Test-Path $report) { Write-Host "OK  $($_.Name)" } else { Write-Host "MISS $($_.Name)" }
}
