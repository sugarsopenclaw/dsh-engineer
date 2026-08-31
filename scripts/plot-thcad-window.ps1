[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][string]$BridgeRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9-]{1,100}$')][string]$RequestId,
    [Parameter(Mandatory = $true)][string]$ExpectedDocument,
    [Parameter(Mandatory = $true)][string]$ExpectedAnalysisId,
    [Parameter(Mandatory = $true)][int]$ExpectedDbmod,
    [Parameter(Mandatory = $true)][double]$MinX,
    [Parameter(Mandatory = $true)][double]$MinY,
    [Parameter(Mandatory = $true)][double]$MaxX,
    [Parameter(Mandatory = $true)][double]$MaxY
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -BridgeRoot $BridgeRoot -RequestId $RequestId -ExpectedDocument $ExpectedDocument `
        -ExpectedAnalysisId $ExpectedAnalysisId -ExpectedDbmod $ExpectedDbmod `
        -MinX $MinX -MinY $MinY -MaxX $MaxX -MaxY $MaxY
    exit $LASTEXITCODE
}

if (-not ('Shenbian.ThcadDetailPlotProcess' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace Shenbian {
    public static class ThcadDetailPlotProcess {
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    }
}
'@
}

function Throw-StableError([string]$Code, [string]$Message) {
    throw "$Code`: $Message"
}

function Wait-ThcadQuiescent($Application, [int]$Seconds = 30) {
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

function Get-PropertyOrNull($Object, [string]$Name) {
    try { return $Object.$Name } catch { return $null }
}

function Get-LayoutState($Layout) {
    $state = [ordered]@{}
    foreach ($name in @(
        'ConfigName', 'CanonicalMediaName', 'PlotType', 'UseStandardScale',
        'StandardScale', 'CenterPlot', 'PlotRotation', 'PlotWithLineweights',
        'PlotWithPlotStyles', 'StyleSheet'
    )) { $state[$name] = Get-PropertyOrNull $Layout $name }
    return $state
}

function Convert-WcsWindowToDcs($Document, [double[]]$Bounds) {
    $corners = @(
        [double[]]@($Bounds[0], $Bounds[1], 0.0),
        [double[]]@($Bounds[0], $Bounds[3], 0.0),
        [double[]]@($Bounds[2], $Bounds[1], 0.0),
        [double[]]@($Bounds[2], $Bounds[3], 0.0)
    )
    $translated = foreach ($corner in $corners) {
        $point = @($Document.Utility.TranslateCoordinates($corner, 0, 2, $false))
        [pscustomobject]@{ x = [double]$point[0]; y = [double]$point[1] }
    }
    return [double[]]@(
        [double](($translated | Measure-Object -Property x -Minimum).Minimum),
        [double](($translated | Measure-Object -Property y -Minimum).Minimum),
        [double](($translated | Measure-Object -Property x -Maximum).Maximum),
        [double](($translated | Measure-Object -Property y -Maximum).Maximum)
    )
}

function Resolve-GeneratedPdf([string]$RequestedPath) {
    foreach ($candidate in @(
        $RequestedPath,
        "$RequestedPath.pdf",
        [IO.Path]::ChangeExtension($RequestedPath, '.pdf')
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $item = Get-Item -LiteralPath $candidate
            if ($item.Length -gt 2048) { return $item.FullName }
        }
    }
    return $null
}

function Get-RelativePath([string]$Root, [string]$Target) {
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $rootUri = [Uri]::new($resolvedRoot)
    $targetUri = [Uri]::new([IO.Path]::GetFullPath($Target))
    return [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($targetUri).ToString()).Replace('/', [IO.Path]::DirectorySeparatorChar)
}

function Restore-LayoutState($Layout, $State, [Collections.Generic.List[string]]$Failures) {
    foreach ($name in @(
        'ConfigName', 'CanonicalMediaName', 'PlotType', 'UseStandardScale',
        'StandardScale', 'CenterPlot', 'PlotRotation', 'PlotWithLineweights',
        'PlotWithPlotStyles', 'StyleSheet'
    )) {
        $value = $State[$name]
        if ($null -eq $value) { continue }
        try {
            $Layout.$name = $value
            if ($name -eq 'ConfigName') { $Layout.RefreshPlotDeviceInfo() }
        } catch { $Failures.Add("model_layout.$name") }
    }
}

function Invoke-RawLayoutIdentityRestore(
    $Document,
    $Application,
    [string]$ConfigName,
    [string]$MediaName
) {
    $safeConfig = $ConfigName.Replace('\', '\\').Replace('"', '\"')
    $safeMedia = $MediaName.Replace('\', '\\').Replace('"', '\"')
    $lisp = '(progn (setq shb-ld (dictsearch (namedobjdict) "ACAD_LAYOUT")) (setq shb-lay (cdr (assoc -1 (dictsearch (cdr (assoc -1 shb-ld)) "Model")))) (setq shb-ed (entget shb-lay)) (if (and shb-lay (assoc 2 shb-ed) (assoc 4 shb-ed)) (progn (setq shb-ed (subst (cons 2 "' + $safeConfig + '") (assoc 2 shb-ed) shb-ed)) (setq shb-ed (subst (cons 4 "' + $safeMedia + '") (assoc 4 shb-ed) shb-ed)) (entmod shb-ed) (entupd shb-lay))) (princ))'
    $Document.SendCommand("$lisp`r")
    Wait-ThcadQuiescent $Application
}

$bounds = [double[]]@($MinX, $MinY, $MaxX, $MaxY)
if ($MaxX -le $MinX -or $MaxY -le $MinY) {
    Throw-StableError 'INVALID_PLOT_BOUNDS' 'The world-coordinate plot window must have positive width and height.'
}
$resolvedRoot = [IO.Path]::GetFullPath($BridgeRoot)
$statePath = Join-Path $resolvedRoot 'state\current-analysis.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    Throw-StableError 'ANALYSIS_MISSING' 'Run THCAD 01-20 analysis before plotting a detail window.'
}
$analysis = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$analysis.analysis_id -ne $ExpectedAnalysisId) {
    Throw-StableError 'ANALYSIS_STALE' 'The current analysis generation changed before detail plotting.'
}

$application = $null
$document = $null
$originalLayout = $null
$modelLayout = $null
$originalVariables = [ordered]@{}
$originalPrinterPath = $null
$modelLayoutState = $null
$dbmodGuard = $false
$restoreFailures = [Collections.Generic.List[string]]::new()
$primaryError = $null
$result = $null

try {
    try { $application = [Runtime.InteropServices.Marshal]::GetActiveObject('BricscadApp.AcadApplication') }
    catch { Throw-StableError 'THCAD_NOT_RUNNING' 'No active BricscadApp.AcadApplication instance exists.' }
    [uint32]$processId = 0
    [void][Shenbian.ThcadDetailPlotProcess]::GetWindowThreadProcessId([IntPtr][int64]$application.HWND, [ref]$processId)
    $process = Get-Process -Id $processId -ErrorAction Stop
    if ($process.ProcessName -ine 'thcad') { Throw-StableError 'WRONG_CAD_HOST' "Expected thcad.exe, got $($process.ProcessName)." }
    $document = $application.ActiveDocument
    if ($null -eq $document) { Throw-StableError 'NO_ACTIVE_DOCUMENT' 'THCAD has no active document.' }
    $documentName = [IO.Path]::GetFileName([string]$document.Name)
    if ($documentName -ine [IO.Path]::GetFileName($ExpectedDocument)) {
        Throw-StableError 'DOCUMENT_CHANGED' "Active document is $documentName."
    }
    Wait-ThcadQuiescent $application
    $dbmodBefore = [int]$document.GetVariable('DBMOD')
    if ($dbmodBefore -ne $ExpectedDbmod -or [int]$analysis.dbmod_after -ne $dbmodBefore) {
        Throw-StableError 'ANALYSIS_STALE' "Active DBMOD=$dbmodBefore does not match the requested analysis."
    }

    foreach ($name in @('TILEMODE', 'BACKGROUNDPLOT', 'VIEWCTR', 'VIEWSIZE')) {
        $originalVariables[$name] = $document.GetVariable($name)
    }
    $originalLayout = $document.ActiveLayout
    $originalLayoutName = [string]$originalLayout.Name
    $originalPrinterPath = [string]$application.Preferences.Files.PrinterConfigPath

    $document.SendCommand("(acad-push-dbmod)`r")
    Wait-ThcadQuiescent $application
    $dbmodGuard = $true
    $document.SetVariable('TILEMODE', 1)
    $document.SetVariable('BACKGROUNDPLOT', 0)
    $modelLayout = $document.ActiveLayout
    $modelLayoutState = Get-LayoutState $modelLayout

    $plotterRoot = 'D:\THSOFT\THCAD V24_Mechanical2D\BCAD\Plotters'
    $configuredRoots = @($originalPrinterPath -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($configuredRoots -notcontains $plotterRoot) {
        $application.Preferences.Files.PrinterConfigPath = (($configuredRoots + $plotterRoot) -join ';')
    }
    $modelLayout.RefreshPlotDeviceInfo()
    $modelLayout.ConfigName = 'DWG To PDF2.pc3'
    $modelLayout.RefreshPlotDeviceInfo()
    $modelLayout.CanonicalMediaName = 'ISO_full_bleed_A4_(210.00_x_297.00_MM)'
    $modelLayout.UseStandardScale = $true
    $modelLayout.StandardScale = 0
    $modelLayout.CenterPlot = $true
    $modelLayout.PlotRotation = 0
    $modelLayout.PlotWithLineweights = $true
    $modelLayout.PlotWithPlotStyles = $false

    $displayBounds = Convert-WcsWindowToDcs $document $bounds
    $modelLayout.SetWindowToPlot(
        [double[]]@($displayBounds[0], $displayBounds[1]),
        [double[]]@($displayBounds[2], $displayBounds[3]))
    $modelLayout.PlotType = 4
    $outputDirectory = Join-Path $resolvedRoot "visual-detail\$RequestId"
    [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
    $requestedPath = Join-Path $outputDirectory 'component-full.shbpdf'
    foreach ($candidate in @($requestedPath, "$requestedPath.pdf", [IO.Path]::ChangeExtension($requestedPath, '.pdf'))) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { Remove-Item -LiteralPath $candidate -Force }
    }
    $plotResult = $document.Plot.PlotToFile($requestedPath)
    Wait-ThcadQuiescent $application 60
    $pdfPath = Resolve-GeneratedPdf $requestedPath
    if ($plotResult -eq $false -or -not $pdfPath) {
        Throw-StableError 'PLOT_EMPTY' 'THCAD window plot did not generate a usable PDF.'
    }
    $file = Get-Item -LiteralPath $pdfPath
    $result = [ordered]@{
        document_name = $documentName
        analysis_id = [string]$analysis.analysis_id
        source_capabilities = @(4, 8, 11, 13)
        world_bbox = @($bounds)
        display_bbox = @($displayBounds)
        pdf_ref = Get-RelativePath $resolvedRoot $pdfPath
        pdf_bytes = [int64]$file.Length
        capture_strategy = 'thcad_plot_set_window_to_plot_without_view_change'
        plot_device = 'DWG To PDF2.pc3'
        media = 'ISO_full_bleed_A4_(210.00_x_297.00_MM)'
        dbmod_before = $dbmodBefore
        dbmod_after = $null
        view_center_before = @($originalVariables.VIEWCTR | ForEach-Object { [double]$_ })
        view_size_before = [double]$originalVariables.VIEWSIZE
        view_center_after = $null
        view_size_after = $null
        dwg_modified = $null
        view_changed = $null
        restore_failures = $null
    }
} catch { $primaryError = $_ }
finally {
    if ($null -ne $modelLayout -and $null -ne $modelLayoutState) {
        Restore-LayoutState $modelLayout $modelLayoutState $restoreFailures
        if ($restoreFailures.Contains('model_layout.ConfigName') -or $restoreFailures.Contains('model_layout.CanonicalMediaName')) {
            try {
                Invoke-RawLayoutIdentityRestore `
                    $document $application `
                    ([string]$modelLayoutState.ConfigName) `
                    ([string]$modelLayoutState.CanonicalMediaName)
                if ([string]$document.ActiveLayout.ConfigName -eq [string]$modelLayoutState.ConfigName) {
                    [void]$restoreFailures.Remove('model_layout.ConfigName')
                }
                if ([string]$document.ActiveLayout.CanonicalMediaName -eq [string]$modelLayoutState.CanonicalMediaName) {
                    [void]$restoreFailures.Remove('model_layout.CanonicalMediaName')
                }
            } catch { }
        }
    }
    if ($null -ne $application -and $null -ne $originalPrinterPath) {
        try { $application.Preferences.Files.PrinterConfigPath = $originalPrinterPath }
        catch { $restoreFailures.Add('PrinterConfigPath') }
    }
    if ($null -ne $document) {
        foreach ($name in @('BACKGROUNDPLOT', 'TILEMODE')) {
            try { $document.SetVariable($name, $originalVariables[$name]) }
            catch { $restoreFailures.Add($name) }
        }
        if ([int]$originalVariables.TILEMODE -eq 0 -and $originalLayoutName) {
            try { $document.ActiveLayout = $document.Layouts.Item($originalLayoutName) }
            catch { $restoreFailures.Add('active layout') }
        }
    }
    if ($dbmodGuard -and $null -ne $document) {
        try {
            $document.SendCommand("(acad-pop-dbmod)`r")
            Wait-ThcadQuiescent $application
            $dbmodGuard = $false
        } catch { $restoreFailures.Add('DBMOD guard') }
    }
    if ($null -ne $result -and $null -ne $document) {
        try {
            $viewCenterAfter = @($document.GetVariable('VIEWCTR') | ForEach-Object { [double]$_ })
            $viewSizeAfter = [double]$document.GetVariable('VIEWSIZE')
            $dbmodAfter = [int]$document.GetVariable('DBMOD')
            $result.dbmod_after = $dbmodAfter
            $result.view_center_after = $viewCenterAfter
            $result.view_size_after = $viewSizeAfter
            $result.dwg_modified = $dbmodAfter -ne $result.dbmod_before
            $result.view_changed = ($viewCenterAfter -join '|') -ne ($result.view_center_before -join '|') -or $viewSizeAfter -ne $result.view_size_before
            $result.restore_failures = $restoreFailures.ToArray()
            if ($result.dwg_modified) { $restoreFailures.Add("DBMOD expected $($result.dbmod_before), got $dbmodAfter") }
            if ($result.view_changed) { $restoreFailures.Add('model view') }
        } catch { $restoreFailures.Add('state verification') }
    }
    foreach ($comObject in @($modelLayout, $originalLayout, $document, $application)) {
        if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) } catch { }
        }
    }
}

if ($null -ne $primaryError) {
    if ($restoreFailures.Count -gt 0) { throw "$($primaryError.Exception.Message) | RESTORE_FAILED: $($restoreFailures -join ', ')" }
    throw $primaryError
}
if ($restoreFailures.Count -gt 0) { Throw-StableError 'RESTORE_FAILED' ($restoreFailures -join ', ') }
if ($null -eq $result) { Throw-StableError 'PLOT_FAILED' 'THCAD plot returned no result.' }
[Console]::Out.Write(($result | ConvertTo-Json -Depth 10 -Compress))
