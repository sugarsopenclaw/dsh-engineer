[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [string]$BridgeRoot,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9-]{1,100}$')]
    [string]$RequestId,
    [string]$ExpectedDocument,
    [string]$FrameId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $PSCommandPath,
        '-BridgeRoot', $BridgeRoot,
        '-RequestId', $RequestId
    )
    if ($ExpectedDocument) { $arguments += @('-ExpectedDocument', $ExpectedDocument) }
    if ($FrameId) { $arguments += @('-FrameId', $FrameId) }
    & $windowsPowerShell @arguments
    exit $LASTEXITCODE
}

Add-Type -AssemblyName System.Drawing

if (-not ('Shenbian.ThcadPlotWindowProcess' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;

namespace Shenbian {
    public static class ThcadPlotWindowProcess {
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    }
}
'@
}

function Throw-StableError([string]$Code, [string]$Message) {
    throw "$Code`: $Message"
}

function Resolve-Inside([string]$Root, [string]$RelativePath) {
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $resolved = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $RelativePath))
    if (-not $resolved.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Throw-StableError 'PATH_OUTSIDE_BRIDGE_ROOT' 'Analysis path escaped the bridge root.'
    }
    return $resolved
}

function Get-RelativePath([string]$Root, [string]$Target) {
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $rootUri = [Uri]::new($resolvedRoot)
    $targetUri = [Uri]::new([IO.Path]::GetFullPath($Target))
    return [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($targetUri).ToString()).Replace('/', [IO.Path]::DirectorySeparatorChar)
}

function Wait-ThcadQuiescent($Application, [int]$Seconds = 10) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $state = $Application.GetAcadState()
        try {
            if ([bool]$state.IsQuiescent) { return }
        } finally {
            if ($null -ne $state -and [Runtime.InteropServices.Marshal]::IsComObject($state)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($state)
            }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    Throw-StableError 'THCAD_BUSY' "THCAD did not become quiescent within $Seconds seconds."
}

function Inspect-Png([string]$Path) {
    $bitmap = [Drawing.Bitmap]::new($Path)
    try {
        if ($bitmap.Width -lt 32 -or $bitmap.Height -lt 32 -or $bitmap.Width -gt 4096 -or $bitmap.Height -gt 4096) {
            Throw-StableError 'PLOT_IMAGE_INVALID' 'The plotted PNG dimensions are outside the supported range.'
        }
        $corners = @(
            $bitmap.GetPixel(0, 0),
            $bitmap.GetPixel($bitmap.Width - 1, 0),
            $bitmap.GetPixel(0, $bitmap.Height - 1),
            $bitmap.GetPixel($bitmap.Width - 1, $bitmap.Height - 1)
        )
        $backgroundR = [int][Math]::Round(($corners | Measure-Object -Property R -Average).Average)
        $backgroundG = [int][Math]::Round(($corners | Measure-Object -Property G -Average).Average)
        $backgroundB = [int][Math]::Round(($corners | Measure-Object -Property B -Average).Average)
        $step = [Math]::Max(1, [int][Math]::Ceiling([Math]::Sqrt((([double]$bitmap.Width * $bitmap.Height) / 250000.0))))
        [int64]$sampled = 0
        [int64]$ink = 0
        $minX = $bitmap.Width
        $minY = $bitmap.Height
        $maxX = -1
        $maxY = -1
        for ($y = 0; $y -lt $bitmap.Height; $y += $step) {
            for ($x = 0; $x -lt $bitmap.Width; $x += $step) {
                $color = $bitmap.GetPixel($x, $y)
                $sampled++
                $distance = [Math]::Abs([int]$color.R - $backgroundR) + [Math]::Abs([int]$color.G - $backgroundG) + [Math]::Abs([int]$color.B - $backgroundB)
                if ($distance -le 36) { continue }
                $ink++
                $minX = [Math]::Min($minX, $x)
                $minY = [Math]::Min($minY, $y)
                $maxX = [Math]::Max($maxX, $x)
                $maxY = [Math]::Max($maxY, $y)
            }
        }
        $inkRatio = if ($sampled -gt 0) { [double]$ink / $sampled } else { 0.0 }
        if ($inkRatio -lt 0.00015 -or $maxX -lt $minX -or $maxY -lt $minY) {
            Throw-StableError 'PLOT_EMPTY' ("The plotted PNG contains no measurable drawing ink (ratio={0:N6})." -f $inkRatio)
        }
        return [ordered]@{
            width = $bitmap.Width
            height = $bitmap.Height
            pixel_count = [int64]$bitmap.Width * $bitmap.Height
            ink_ratio = [Math]::Round($inkRatio, 6)
            content_bbox = @($minX, $minY, $maxX, $maxY)
        }
    } finally {
        $bitmap.Dispose()
    }
}

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $digest = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $digest.Dispose()
        $stream.Dispose()
    }
}

$resolvedRoot = [IO.Path]::GetFullPath($BridgeRoot)
$statePath = Join-Path $resolvedRoot 'state\current-analysis.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    Throw-StableError 'ANALYSIS_MISSING' 'Run THCAD 01-20 analysis before plotting a frame overview.'
}
$analysis = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
$artifactRelative = [string]$analysis.artifacts.'2'
if (-not $artifactRelative) { Throw-StableError 'FRAME_ANALYSIS_MISSING' 'Capability 02 artifact is missing.' }
$framePath = Resolve-Inside $resolvedRoot $artifactRelative
$frameResult = Get-Content -LiteralPath $framePath -Raw -Encoding UTF8 | ConvertFrom-Json
$selectedId = $FrameId
if (-not $selectedId -and @($frameResult.outermost_frame_ids).Count -gt 0) {
    $selectedId = [string]@($frameResult.outermost_frame_ids)[0]
}
$frame = @($frameResult.frames) | Where-Object { -not $selectedId -or $_.id -ieq $selectedId } | Select-Object -First 1
if ($null -eq $frame) { Throw-StableError 'FRAME_NOT_FOUND' "Capability 02 frame was not found: $selectedId" }

$minX = [double]$frame.min[0]
$minY = [double]$frame.min[1]
$maxX = [double]$frame.max[0]
$maxY = [double]$frame.max[1]
$width = $maxX - $minX
$height = $maxY - $minY
if ($width -le 0 -or $height -le 0) { Throw-StableError 'FRAME_INVALID' 'Capability 02 frame has non-positive bounds.' }
$aspect = [Math]::Max($width, $height) / [Math]::Min($width, $height)
if ($aspect -gt 8) { Throw-StableError 'FRAME_INVALID' 'Capability 02 frame is an implausible sheet strip.' }
$paddingX = $width * 0.005
$paddingY = $height * 0.005
$plotMin = @(($minX - $paddingX), ($minY - $paddingY))
$plotMax = @(($maxX + $paddingX), ($maxY + $paddingY))

$application = $null
$document = $null
$originalLayout = $null
$originalLayoutName = $null
$originalVariables = [ordered]@{}
$modelViewCenter = $null
$modelViewSize = $null
$dbmodGuardActive = $false
$warnings = [Collections.Generic.List[string]]::new()
$restoreFailures = [Collections.Generic.List[string]]::new()
$result = $null
$primaryError = $null

try {
    try {
        $application = [Runtime.InteropServices.Marshal]::GetActiveObject('BricscadApp.AcadApplication')
    } catch {
        Throw-StableError 'THCAD_NOT_RUNNING' 'No active BricscadApp.AcadApplication instance exists.'
    }
    [uint32]$hostProcessId = 0
    [void][Shenbian.ThcadPlotWindowProcess]::GetWindowThreadProcessId([IntPtr][int64]$application.HWND, [ref]$hostProcessId)
    $hostProcess = Get-Process -Id $hostProcessId -ErrorAction Stop
    if ($hostProcess.ProcessName -ine 'thcad') {
        Throw-StableError 'WRONG_CAD_HOST' "Expected thcad.exe, got $($hostProcess.ProcessName)."
    }
    $document = $application.ActiveDocument
    if ($null -eq $document) { Throw-StableError 'NO_ACTIVE_DOCUMENT' 'THCAD has no active document.' }
    $documentName = [string]$document.Name
    $shortName = [IO.Path]::GetFileName($documentName)
    if ($ExpectedDocument -and $ExpectedDocument -ine $shortName -and $ExpectedDocument -ine $documentName) {
        Throw-StableError 'DOCUMENT_CHANGED' "Active document is $shortName, expected $([IO.Path]::GetFileName($ExpectedDocument))."
    }
    if ([string]$analysis.document_name -ine $shortName) {
        Throw-StableError 'ANALYSIS_STALE' 'Capability 02 artifact belongs to another drawing.'
    }
    Wait-ThcadQuiescent $application
    $dbmodBefore = [int]$document.GetVariable('DBMOD')
    if ([int]$analysis.dbmod_after -ne $dbmodBefore) {
        Throw-StableError 'ANALYSIS_STALE' "Active DBMOD=$dbmodBefore differs from analyzed DBMOD=$($analysis.dbmod_after)."
    }

    $originalLayout = $document.ActiveLayout
    $originalLayoutName = [string]$originalLayout.Name
    foreach ($variable in @('TILEMODE')) {
        try { $originalVariables[$variable] = $document.GetVariable($variable) } catch { $originalVariables[$variable] = $null }
    }
    $document.SendCommand("(acad-push-dbmod)`r")
    Wait-ThcadQuiescent $application
    $dbmodGuardActive = $true

    $document.SetVariable('TILEMODE', 1)
    $modelViewCenter = @($document.GetVariable('VIEWCTR'))
    $modelViewSize = [double]$document.GetVariable('VIEWSIZE')
    $application.ZoomWindow(
        [double[]]@($plotMin[0], $plotMin[1], 0.0),
        [double[]]@($plotMax[0], $plotMax[1], 0.0))

    $outputDirectory = Join-Path $resolvedRoot "visual\$RequestId"
    [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
    $requestedPath = Join-Path $outputDirectory 'frame-overview.png'
    if (Test-Path -LiteralPath $requestedPath) { Remove-Item -LiteralPath $requestedPath -Force }
    $lispPath = $requestedPath.Replace('\', '/')
    $document.SendCommand("(command `"_pngout`" `"$lispPath`")`r")
    Wait-ThcadQuiescent $application 30
    $fileDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $requestedPath -PathType Leaf)) {
        if ([DateTime]::UtcNow -ge $fileDeadline) {
            Throw-StableError 'PLOT_EMPTY' 'THCAD PNGOUT did not generate an output file.'
        }
        Start-Sleep -Milliseconds 100
    }
    $metrics = Inspect-Png $requestedPath
    $file = Get-Item -LiteralPath $requestedPath
    $result = [ordered]@{
        document_name = $shortName
        analysis_id = [string]$analysis.analysis_id
        source_capability = 2
        frame_id = [string]$frame.id
        frame_bbox = @($minX, $minY, $maxX, $maxY)
        plot_bbox = @($plotMin[0], $plotMin[1], $plotMax[0], $plotMax[1])
        image_ref = Get-RelativePath $resolvedRoot $requestedPath
        media_type = 'image/png'
        bytes = $file.Length
        sha256 = Get-Sha256 $requestedPath
        width = $metrics.width
        height = $metrics.height
        pixel_count = $metrics.pixel_count
        ink_ratio = $metrics.ink_ratio
        content_bbox = $metrics.content_bbox
        capture_strategy = 'thcad_pngout_frame_window'
        color_mode = 'current_model_space_display'
        dbmod_before = $dbmodBefore
        dbmod_after = $null
        dwg_modified = $false
        warnings = $warnings.ToArray()
    }
} catch {
    $primaryError = $_
} finally {
    if ($null -ne $document -and $null -ne $modelViewCenter -and $null -ne $modelViewSize) {
        try {
            $application.ZoomCenter(
                [double[]]@([double]$modelViewCenter[0], [double]$modelViewCenter[1], 0.0),
                [double]$modelViewSize)
        } catch {
            $restoreFailures.Add('model view')
        }
    }
    foreach ($variable in @('TILEMODE')) {
        $value = $originalVariables[$variable]
        if ($null -eq $value -or $null -eq $document) { continue }
        try { $document.SetVariable($variable, $value) } catch { $restoreFailures.Add($variable) }
    }
    if ($null -ne $document -and $originalLayoutName -and $originalVariables['TILEMODE'] -eq 0) {
        try { $document.ActiveLayout = $document.Layouts.Item($originalLayoutName) } catch { $restoreFailures.Add('active layout') }
    }
    if ($dbmodGuardActive -and $null -ne $document) {
        try {
            $document.SendCommand("(acad-pop-dbmod)`r")
            Wait-ThcadQuiescent $application
            $dbmodGuardActive = $false
        } catch {
            $restoreFailures.Add('DBMOD guard')
        }
    }
    if ($null -ne $document -and $null -ne $result) {
        try {
            $restoredDbmod = [int]$document.GetVariable('DBMOD')
            $result.dbmod_after = $restoredDbmod
            $result.dwg_modified = $restoredDbmod -ne $result.dbmod_before
            if ($result.dwg_modified) { $restoreFailures.Add("DBMOD expected $($result.dbmod_before), got $restoredDbmod") }
        } catch {
            $restoreFailures.Add('DBMOD verification')
        }
    }
    foreach ($comObject in @($originalLayout, $document, $application)) {
        if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) } catch { }
        }
    }
}

if ($null -ne $primaryError) {
    if ($restoreFailures.Count -gt 0) {
        throw "$($primaryError.Exception.Message) | VIEW_RESTORE_FAILED: $($restoreFailures -join ', ')"
    }
    throw $primaryError
}
if ($restoreFailures.Count -gt 0) {
    Throw-StableError 'VIEW_RESTORE_FAILED' ($restoreFailures -join ', ')
}
if ($null -eq $result) { Throw-StableError 'PLOT_FAILED' 'THCAD plot returned no result.' }
[Console]::Out.Write(($result | ConvertTo-Json -Depth 10 -Compress))
