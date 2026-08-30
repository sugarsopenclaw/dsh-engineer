param(
    [string]$LispInventoryId = "autocad-2024.lisp",
    [string]$CommandInventoryId = "autocad-2024.command",
    [string]$LispOutputDir = "",
    [string]$CommandOutputDir = "",
    [string]$ScanOutput = "",
    [string]$RuntimeJson = "",
    [int]$TimeoutSeconds = 90,
    [string]$CapturedAt = "2026-08-28T00:00:00Z",
    [switch]$SkipRuntimeProbe
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $skip = ""
    if ($SkipRuntimeProbe) { $skip = "-SkipRuntimeProbe" }
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -LispInventoryId $LispInventoryId `
        -CommandInventoryId $CommandInventoryId `
        -LispOutputDir $LispOutputDir `
        -CommandOutputDir $CommandOutputDir `
        -ScanOutput $ScanOutput `
        -RuntimeJson $RuntimeJson `
        -TimeoutSeconds $TimeoutSeconds `
        -CapturedAt $CapturedAt `
        @($skip)
    exit $LASTEXITCODE
}

$probeDirectory = Split-Path -Parent $PSCommandPath
. (Join-Path $probeDirectory "AutoCad2024Host.ps1")
$repoRoot = Get-AutoCad2024RepoRoot -StartPath $PSCommandPath
$stagingRoot = Join-Path $repoRoot "data\datasets\staging\cad-capabilities"
if ([string]::IsNullOrWhiteSpace($LispOutputDir)) {
    $LispOutputDir = Join-Path $stagingRoot $LispInventoryId
}
if ([string]::IsNullOrWhiteSpace($CommandOutputDir)) {
    $CommandOutputDir = Join-Path $stagingRoot $CommandInventoryId
}
if ([string]::IsNullOrWhiteSpace($ScanOutput)) {
    $ScanOutput = Join-Path $stagingRoot "autocad-2024.lisp-command-scan.json"
}
if ([string]::IsNullOrWhiteSpace($RuntimeJson)) {
    $RuntimeJson = Join-Path $stagingRoot "autocad-2024.lisp-command-runtime.json"
}

Assert-AutoCadOutputIsolation -InventoryId $LispInventoryId -OutputDir $LispOutputDir
Assert-AutoCadOutputIsolation -InventoryId $CommandInventoryId -OutputDir $CommandOutputDir
if ($ScanOutput -like "*thcad-v24*" -or $RuntimeJson -like "*thcad-v24*") {
    throw "AutoCAD LISP/command scan refused THCAD output path."
}

$hostInfo = Confirm-AutoCad2024Host
$trees = Get-AutoCad2024LispSourceTrees -HostInfo $hostInfo

if (-not $SkipRuntimeProbe) {
    $probePath = Join-Path $probeDirectory "ProbeAutoCad2024LispRuntime.ps1"
    $probeText = Join-Path $probeDirectory ".tmp-lisp-runtime.txt"
    $probeJsonPath = & (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") `
        -NoProfile -ExecutionPolicy Bypass -File $probePath `
        -OutputPath $probeText `
        -TimeoutSeconds $TimeoutSeconds
    if ($LASTEXITCODE -ne 0) {
        throw "ProbeAutoCad2024LispRuntime.ps1 failed with exit code $LASTEXITCODE"
    }
    $probeJsonPath = ([string]$probeJsonPath).Trim()
    if (-not (Test-Path -LiteralPath $probeJsonPath)) {
        throw "LISP runtime probe did not write JSON: $probeJsonPath"
    }
    $runtimeRaw = [IO.File]::ReadAllText($probeJsonPath)
    $runtimeObject = $runtimeRaw | ConvertFrom-Json
    if (-not $runtimeObject.host) {
        throw "LISP runtime probe did not attach to an AutoCAD session."
    }
    if ([string]$runtimeObject.host -notmatch "(?i)autocad" -or [string]$runtimeObject.host -match "(?i)thcad|bricscad") {
        throw "LISP runtime probe attached to the wrong host: $($runtimeObject.host)"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeJson) | Out-Null
    [IO.File]::WriteAllText($RuntimeJson, $runtimeRaw, [Text.UTF8Encoding]::new($false))
    Write-Host "Runtime probe attached: $($runtimeObject.host) / $($runtimeObject.version)"
}
elseif (-not (Test-Path -LiteralPath $RuntimeJson)) {
    throw "SkipRuntimeProbe requires an existing runtime JSON: $RuntimeJson"
}

New-Item -ItemType Directory -Force -Path $LispOutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $CommandOutputDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ScanOutput) | Out-Null

$atomizer = Join-Path $repoRoot "data\pipelines\cad_capabilities\lisp_command_atoms.py"
$pythonArgs = @(
    $atomizer,
    "--runtime-json", $RuntimeJson,
    "--lisp-output-dir", $LispOutputDir,
    "--command-output-dir", $CommandOutputDir,
    "--scan-output", $ScanOutput,
    "--observed-host-id", "autocad-2024",
    "--lisp-inventory-id", $LispInventoryId,
    "--command-inventory-id", $CommandInventoryId,
    "--captured-at", $CapturedAt,
    "--require-runtime"
)
foreach ($tree in $trees) {
    $pythonArgs += @("--source-tree", "$($tree.prefix)=$($tree.path)")
}

$firstLisp = Join-Path $LispOutputDir ".emit1"
$firstCommand = Join-Path $CommandOutputDir ".emit1"
$secondLisp = Join-Path $LispOutputDir ".emit2"
$secondCommand = Join-Path $CommandOutputDir ".emit2"
New-Item -ItemType Directory -Force -Path $firstLisp, $firstCommand, $secondLisp, $secondCommand | Out-Null

$firstArgs = @($pythonArgs)
$firstArgs[[array]::IndexOf($firstArgs, $LispOutputDir)] = $firstLisp
$firstArgs[[array]::IndexOf($firstArgs, $CommandOutputDir)] = $firstCommand
Invoke-PythonAtomizer -RepoRoot $repoRoot -PythonArgs $firstArgs

$secondArgs = @(
    $atomizer,
    "--scan", $ScanOutput,
    "--lisp-output-dir", $secondLisp,
    "--command-output-dir", $secondCommand,
    "--captured-at", $CapturedAt,
    "--require-runtime"
)
Invoke-PythonAtomizer -RepoRoot $repoRoot -PythonArgs $secondArgs

foreach ($pair in @(
        @{ first = (Join-Path $firstLisp "capability-atoms.jsonl"); second = (Join-Path $secondLisp "capability-atoms.jsonl"); destDir = $LispOutputDir },
        @{ first = (Join-Path $firstCommand "capability-atoms.jsonl"); second = (Join-Path $secondCommand "capability-atoms.jsonl"); destDir = $CommandOutputDir }
    )) {
    $firstHash = (Get-FileHash -LiteralPath $pair.first -Algorithm SHA256).Hash.ToLowerInvariant()
    $secondHash = (Get-FileHash -LiteralPath $pair.second -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($firstHash -ne $secondHash) {
        throw "Two-export identity failed for $($pair.destDir): $firstHash vs $secondHash"
    }
    Copy-Item -LiteralPath $pair.first -Destination (Join-Path $pair.destDir "capability-atoms.jsonl") -Force
}
Copy-Item -LiteralPath (Join-Path $firstLisp "inventory-manifest.json") -Destination (Join-Path $LispOutputDir "inventory-manifest.json") -Force
Copy-Item -LiteralPath (Join-Path $firstCommand "inventory-manifest.json") -Destination (Join-Path $CommandOutputDir "inventory-manifest.json") -Force
Write-Host "Wrote $LispOutputDir"
Write-Host "Wrote $CommandOutputDir"
Write-Host "Wrote $ScanOutput"
