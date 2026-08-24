# Compare AutoCAD vs THCAD extracts of the same drawing by handle.
param(
    [string]$DrawingId = "5TBC.384.A110050.2_1"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$acadDir = Join-Path $root "out\$DrawingId"
$thcadDir = Join-Path $root "out-thcad\$DrawingId"

function Read-Report([string]$dir) {
    $path = Join-Path $dir "extraction-report.json"
    if (-not (Test-Path $path)) { throw "missing $path" }
    Get-Content $path -Encoding UTF8 -Raw | ConvertFrom-Json
}

function Read-Handles([string]$jsonl) {
    $map = @{}
    Get-Content $jsonl -Encoding UTF8 | ForEach-Object {
        if (-not $_) { return }
        $o = $_ | ConvertFrom-Json
        $h = [string]$o.handle
        if ($h) { $map[$h] = $o }
    }
    return $map
}

$acad = Read-Report $acadDir
$thcad = Read-Report $thcadDir

Write-Host "==== $DrawingId ===="
Write-Host ("AutoCAD  entities={0} proxy={1} failed={2} source={3}" -f $acad.entity_count, $acad.proxy_count, $acad.failed_count, $acad.source)
Write-Host ("THCAD    entities={0} proxy={1} failed={2} source={3}" -f $thcad.entity_count, $thcad.proxy_count, $thcad.failed_count, $thcad.source)
Write-Host ("entity_count delta (THCAD-AutoCAD) = {0}" -f ($thcad.entity_count - $acad.entity_count))
Write-Host ("proxy_count  delta (THCAD-AutoCAD) = {0}" -f ($thcad.proxy_count - $acad.proxy_count))

$acadEnt = Read-Handles (Join-Path $acadDir "entities.jsonl")
$thcadEnt = Read-Handles (Join-Path $thcadDir "entities.jsonl")
$onlyAcad = @($acadEnt.Keys | Where-Object { -not $thcadEnt.ContainsKey($_) })
$onlyThcad = @($thcadEnt.Keys | Where-Object { -not $acadEnt.ContainsKey($_) })
$common = @($acadEnt.Keys | Where-Object { $thcadEnt.ContainsKey($_) })

$classChanged = @()
$decodeChanged = @()
foreach ($h in $common) {
    $a = $acadEnt[$h]
    $t = $thcadEnt[$h]
    if ([string]$a.runtime_class -ne [string]$t.runtime_class) {
        $classChanged += [pscustomobject]@{
            handle = $h
            acad_class = $a.runtime_class
            thcad_class = $t.runtime_class
            acad_proxy = $a.proxy.original_class_name
            thcad_proxy = $t.proxy.original_class_name
            acad_decode = $a.decode_status
            thcad_decode = $t.decode_status
        }
    }
    if ([string]$a.decode_status -ne [string]$t.decode_status) {
        $decodeChanged += $h
    }
}

Write-Host ("handles only in AutoCAD: {0}" -f $onlyAcad.Count)
Write-Host ("handles only in THCAD:   {0}" -f $onlyThcad.Count)
Write-Host ("shared handles:          {0}" -f $common.Count)
Write-Host ("runtime_class changed:   {0}" -f $classChanged.Count)
Write-Host ("decode_status changed:   {0}" -f $decodeChanged.Count)

Write-Host "`n==== decode_status counts ===="
Write-Host ("AutoCAD " + ($acad.decode_status_counts | ConvertTo-Json -Compress))
Write-Host ("THCAD   " + ($thcad.decode_status_counts | ConvertTo-Json -Compress))

if ($classChanged.Count -gt 0) {
    Write-Host "`n==== class changes (top 40) ===="
    $classChanged |
        Group-Object { "{0} -> {1}" -f $_.acad_class, $_.thcad_class } |
        Sort-Object Count -Descending |
        Select-Object -First 40 |
        ForEach-Object { Write-Host ("  {0}`t{1}" -f $_.Count, $_.Name) }

    Write-Host "`n==== proxy original_class resolved in THCAD (sample) ===="
    $classChanged |
        Where-Object { $_.acad_class -match "Zombie|Proxy" } |
        Select-Object -First 15 |
        ForEach-Object {
            Write-Host ("  {0}  {1} ({2}) -> {3} decode={4}" -f $_.handle, $_.acad_class, $_.acad_proxy, $_.thcad_class, $_.thcad_decode)
        }
}

$cmpDir = Join-Path $root "compare\$DrawingId"
New-Item -ItemType Directory -Force -Path $cmpDir | Out-Null
$classChanged | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $cmpDir "class-changed.json") -Encoding UTF8
[pscustomobject]@{
    drawing_id = $DrawingId
    acad_entities = $acad.entity_count
    thcad_entities = $thcad.entity_count
    acad_proxy = $acad.proxy_count
    thcad_proxy = $thcad.proxy_count
    only_acad = $onlyAcad.Count
    only_thcad = $onlyThcad.Count
    shared = $common.Count
    class_changed = $classChanged.Count
    decode_changed = $decodeChanged.Count
} | ConvertTo-Json | Set-Content (Join-Path $cmpDir "summary.json") -Encoding UTF8
Write-Host "`nWrote $cmpDir"
