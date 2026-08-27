# Capture the entities currently preselected in the running THCAD document.
# COM is used only to attach/trigger and preserve object handles; entity data is
# read by SHBEXTRACTSELECTED inside THCAD through the .NET API.
param(
    [string]$Configuration = "Debug",
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

# Marshal.GetActiveObject is available in Windows PowerShell 5.1 but not in the
# .NET runtime used by PowerShell 7. Relaunch this script in 5.1 when needed.
if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -Configuration $Configuration -TimeoutSeconds $TimeoutSeconds
    exit $LASTEXITCODE
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dllPath = Join-Path $root "ThcadExtractor\bin\x64\$Configuration\Shb.Thcad.Extractor.dll"
$dllForCad = $dllPath.Replace("\", "/")
$selectionRoot = Join-Path $root "out-thcad-selection"
$latestPath = Join-Path $selectionRoot "_latest-selection.json"
$pluginLogPath = Join-Path $root "out-thcad\_plugin-loaded.txt"

if (-not (Test-Path -LiteralPath $dllPath)) {
    throw "DLL not found: $dllPath"
}

function Wait-ThcadIdle {
    param($Document, [datetime]$Deadline)

    Start-Sleep -Milliseconds 250
    while ((Get-Date) -lt $Deadline) {
        try {
            if ([string]$Document.GetVariable("CMDNAMES") -eq "") {
                return
            }
        }
        catch {
            # THCAD may reject COM calls briefly while a command is transitioning.
        }
        Start-Sleep -Milliseconds 100
    }

    throw "Timed out waiting for THCAD to become idle."
}

function Test-PluginLoadedInCurrentProcess {
    param([datetime]$ProcessStartUtc)

    if (-not (Test-Path -LiteralPath $pluginLogPath)) {
        return $false
    }

    foreach ($line in @(Get-Content -LiteralPath $pluginLogPath -Tail 30)) {
        $token = ($line -split " ", 2)[0]
        $loadedAt = [datetime]::MinValue
        if ([datetime]::TryParse(
            $token,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AdjustToUniversal,
            [ref]$loadedAt)) {
            if ($loadedAt.ToUniversalTime() -ge $ProcessStartUtc) {
                return $true
            }
        }
    }

    return $false
}

$app = [Runtime.InteropServices.Marshal]::GetActiveObject("BricscadApp.AcadApplication")
$doc = $app.ActiveDocument
if ($null -eq $doc) {
    throw "THCAD has no active document."
}

$pickfirst = $doc.PickfirstSelectionSet
$handles = @()
for ($index = 0; $index -lt [int]$pickfirst.Count; $index++) {
    $handles += [string]$pickfirst.Item($index).Handle
}
if ($handles.Count -eq 0) {
    throw "No preselected entities. Box-select entities in THCAD first."
}

Write-Host ("THCAD: {0} | drawing: {1} | selected: {2}" -f $app.Name, $doc.Name, $handles.Count)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$thcadProcess = Get-Process -Name "thcad" -ErrorAction SilentlyContinue |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
$processStartUtc = if ($null -ne $thcadProcess) {
    $thcadProcess.StartTime.ToUniversalTime()
}
else {
    [datetime]::UtcNow
}

if (-not (Test-PluginLoadedInCurrentProcess -ProcessStartUtc $processStartUtc)) {
    $doc.SendCommand("(command `"_NETLOAD`" `"$dllForCad`")`n")
    Wait-ThcadIdle -Document $doc -Deadline $deadline
}

# NETLOAD clears Pickfirst in THCAD. Restore precisely the handles captured
# above before dispatching the .NET command.
$quotedHandles = ($handles | ForEach-Object { "`"$_`"" }) -join " "
$restoreLisp = "(progn (setq shb_ss (ssadd)) (foreach shb_h '($quotedHandles) " +
    "(if (setq shb_e (handent shb_h)) (ssadd shb_e shb_ss))) " +
    "(sssetfirst nil shb_ss) (princ))`n"
$doc.SendCommand($restoreLisp)
Wait-ThcadIdle -Document $doc -Deadline $deadline

$restoredCount = [int]$doc.PickfirstSelectionSet.Count
if ($restoredCount -ne $handles.Count) {
    throw "Selection restore mismatch: expected $($handles.Count), got $restoredCount."
}

$captureStartedUtc = [datetime]::UtcNow
$doc.SendCommand("SHBEXTRACTSELECTED`n")
Wait-ThcadIdle -Document $doc -Deadline $deadline

$latest = $null
while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $latestPath) {
        try {
            $candidate = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json
            $completedAt = [datetime]$candidate.completed_at
            if ($completedAt.ToUniversalTime() -ge $captureStartedUtc.AddSeconds(-1)) {
                $latest = $candidate
                break
            }
        }
        catch {
            # Atomic replacement can briefly race the read; retry.
        }
    }
    Start-Sleep -Milliseconds 100
}

if ($null -eq $latest) {
    throw "Timed out waiting for $latestPath"
}
if ([int]$latest.requested_count -ne $handles.Count -or [int]$latest.failed_count -ne 0) {
    throw "Capture incomplete: requested=$($latest.requested_count), serialized=$($latest.serialized_count), failed=$($latest.failed_count)."
}

Write-Host ("Captured: {0} entities, 0 failed" -f $latest.serialized_count)
Write-Host ("Report: {0}" -f $latest.report_path)
