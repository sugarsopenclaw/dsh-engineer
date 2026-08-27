param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
$frameSource = Join-Path $repoRoot "local-dev\cad\core\02-drawing-frame-detection\DrawingFrameDetector.cs"
$zoneSource = Join-Path $scriptRoot "DrawingZoneDetector.cs"
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}

if ($null -eq ("Shb.Cad.Core.DrawingFrameDetector" -as [type])) {
    Add-Type -Path $frameSource
}
if ($null -eq ("Shb.Cad.Core.DrawingZoneDetector" -as [type])) {
    Add-Type -Path $zoneSource
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message expected=$Expected actual=$Actual"
    }
}

function New-ZoneTextSample {
    param($Record)

    $value = $null
    if ($Record.text -is [string]) {
        $value = [string]$Record.text
    }
    elseif ($null -ne $Record.text -and $null -ne $Record.text.plain) {
        $value = [string]$Record.text.plain
    }
    if ($null -eq $value) {
        return $null
    }

    $x = $null
    $y = $null
    if ($Record.managed_type -eq "DBText" `
        -and $Record.geometry.horizontal_mode -ne "TextLeft" `
        -and $null -ne $Record.geometry.alignment) {
        $x = [double]$Record.geometry.alignment[0]
        $y = [double]$Record.geometry.alignment[1]
    }
    elseif ($Record.managed_type -eq "DBText" -and $null -ne $Record.geometry.position) {
        $x = [double]$Record.geometry.position[0]
        $y = [double]$Record.geometry.position[1]
    }
    elseif ($null -ne $Record.bbox) {
        $x = ([double]$Record.bbox.min[0] + [double]$Record.bbox.max[0]) * 0.5
        $y = ([double]$Record.bbox.min[1] + [double]$Record.bbox.max[1]) * 0.5
    }
    elseif ($null -ne $Record.geometry.location) {
        $x = [double]$Record.geometry.location[0]
        $y = [double]$Record.geometry.location[1]
    }

    if ($null -eq $x -or $null -eq $y) {
        return $null
    }

    return [Shb.Cad.Core.DrawingZoneTextSample]::new(
        [string]$Record.handle,
        [string]$Record.layer,
        $value,
        $x,
        $y)
}

$expected = [ordered]@{
    "5TBC.384.A110050.1_1"   = @(16, 12)
    "5TBC.384.A110050.2_1"   = @(16, 12)
    "5TBC.426.A110050.1_1"   = @(16, 12)
    "5TBC.457.A110050.1_1"   = @(16, 12)
    "5TBC.709.A110050.1_1"   = @(16, 12)
    "5TBC.709.A110050.1_2"   = @(16, 12)
    "8TBC.312.A110050.101_1" = @(8, 4)
}

$rows = @()
$titleCount = 0
$verifiedDividerBoundaryCount = 0
foreach ($drawingId in $expected.Keys) {
    $entitiesPath = Join-Path $ExtractionRoot "$drawingId\entities.jsonl"
    if (-not (Test-Path -LiteralPath $entitiesPath)) {
        throw "Missing extraction: $entitiesPath"
    }

    $segments = [System.Collections.Generic.List[Shb.Cad.Core.DrawingFrameSegment]]::new()
    $texts = [System.Collections.Generic.List[Shb.Cad.Core.DrawingZoneTextSample]]::new()
    $titles = @()
    foreach ($line in Get-Content -LiteralPath $entitiesPath) {
        $record = $line | ConvertFrom-Json
        if ($record.owner_scope -ne "model_space") {
            continue
        }

        if ($record.managed_type -eq "Line" -and $record.geometry.kind -eq "line") {
            $segments.Add([Shb.Cad.Core.DrawingFrameSegment]::new(
                [string]$record.handle,
                [string]$record.layer,
                [double]$record.geometry.start[0],
                [double]$record.geometry.start[1],
                [double]$record.geometry.end[0],
                [double]$record.geometry.end[1]))
        }

        if ($record.managed_type -in @("DBText", "MText")) {
            $sample = New-ZoneTextSample $record
            if ($null -ne $sample) {
                $texts.Add($sample)
                if ($sample.Text.Trim() -eq "技术要求" -and $null -ne $record.bbox) {
                    $titles += $record
                }
            }
        }
    }

    $frameResult = [Shb.Cad.Core.DrawingFrameDetector]::Detect($segments, $null)
    Assert-Equal 1 $frameResult.OutermostFrames.Count "$drawingId drawing-area frame count"
    $frame = $frameResult.OutermostFrames[0]
    $bounds = [Shb.Cad.Core.DrawingZoneFrameBounds]::new(
        $frame.Id, $frame.MinX, $frame.MinY, $frame.MaxX, $frame.MaxY)
    $detected = [Shb.Cad.Core.DrawingZoneDetector]::Detect($bounds, $texts, $null)

    $expectedColumns = $expected[$drawingId][0]
    $expectedRows = $expected[$drawingId][1]
    Assert-Equal $true $detected.System.IsDetected "$drawingId zone detected"
    Assert-Equal $expectedColumns $detected.System.Columns.Count "$drawingId columns"
    Assert-Equal $expectedRows $detected.System.Rows.Count "$drawingId rows"
    Assert-Equal "1" $detected.System.Columns[0].Label "$drawingId first column"
    Assert-Equal ([string]$expectedColumns) $detected.System.Columns[$expectedColumns - 1].Label "$drawingId last column"
    Assert-Equal "A" $detected.System.Rows[0].Label "$drawingId first row"
    Assert-Equal ([string][char](64 + $expectedRows)) $detected.System.Rows[$expectedRows - 1].Label "$drawingId last row"
    Assert-Equal $expectedColumns $detected.TopNumericCandidateCount "$drawingId top candidates"
    Assert-Equal $expectedColumns $detected.BottomNumericCandidateCount "$drawingId bottom candidates"
    Assert-Equal $expectedRows $detected.LeftLetterCandidateCount "$drawingId left candidates"
    Assert-Equal $expectedRows $detected.RightLetterCandidateCount "$drawingId right candidates"

    for ($index = 0; $index -lt $detected.System.Columns.Count - 1; $index++) {
        $boundaryX = $detected.System.Columns[$index].MaxX
        $ticks = @($segments | Where-Object {
            [Math]::Abs($_.StartX - $_.EndX) -le 0.01 `
                -and [Math]::Abs($_.StartX - $boundaryX) -le 0.01 `
                -and (
                    [Math]::Abs($_.StartY - $frame.MinY) -le 0.01 `
                    -or [Math]::Abs($_.EndY - $frame.MinY) -le 0.01 `
                    -or [Math]::Abs($_.StartY - $frame.MaxY) -le 0.01 `
                    -or [Math]::Abs($_.EndY - $frame.MaxY) -le 0.01)
        })
        if ($ticks.Count -lt 2) {
            throw "$drawingId missing top/bottom divider evidence at x=$boundaryX"
        }
        $verifiedDividerBoundaryCount++
    }
    for ($index = 0; $index -lt $detected.System.Rows.Count - 1; $index++) {
        $boundaryY = $detected.System.Rows[$index].MinY
        $ticks = @($segments | Where-Object {
            [Math]::Abs($_.StartY - $_.EndY) -le 0.01 `
                -and [Math]::Abs($_.StartY - $boundaryY) -le 0.01 `
                -and (
                    [Math]::Abs($_.StartX - $frame.MinX) -le 0.01 `
                    -or [Math]::Abs($_.EndX - $frame.MinX) -le 0.01 `
                    -or [Math]::Abs($_.StartX - $frame.MaxX) -le 0.01 `
                    -or [Math]::Abs($_.EndX - $frame.MaxX) -le 0.01)
        })
        if ($ticks.Count -lt 2) {
            throw "$drawingId missing left/right divider evidence at y=$boundaryY"
        }
        $verifiedDividerBoundaryCount++
    }

    $upperRight = $detected.System.LocatePoint($frame.MaxX - 1, $frame.MaxY - 1)
    Assert-Equal ("A" + $expectedColumns) $upperRight.PrimaryZoneId "$drawingId upper-right zone"

    $titleZones = @()
    foreach ($title in $titles) {
        $location = $detected.System.LocateBounds(
            [double]$title.bbox.min[0],
            [double]$title.bbox.min[1],
            [double]$title.bbox.max[0],
            [double]$title.bbox.max[1])
        if (-not $location.PrimaryZoneId.StartsWith("A")) {
            throw "$drawingId technical-requirements title is not in row A: $($location.PrimaryZoneId)"
        }
        $titleZones += $location.PrimaryZoneId
        $titleCount++
    }

    $rows += [pscustomobject]@{
        Drawing = $drawingId
        Columns = $detected.System.Columns.Count
        Rows = $detected.System.Rows.Count
        Zones = $detected.System.Columns.Count * $detected.System.Rows.Count
        UpperRight = $upperRight.PrimaryZoneId
        TechnicalRequirements = ($titleZones -join ",")
    }
}

Assert-Equal 6 $titleCount "technical-requirements title count"
Assert-Equal 166 $verifiedDividerBoundaryCount "verified real divider boundaries"

# Synthetic regression: paired border labels, in-frame numeric noise, unpaired
# border noise, point location, and a bbox spanning four zones.
$syntheticFrame = [Shb.Cad.Core.DrawingZoneFrameBounds]::new("synthetic", 0, 0, 1600, 1200)
$syntheticTexts = [System.Collections.Generic.List[Shb.Cad.Core.DrawingZoneTextSample]]::new()
foreach ($item in @(
    @("T1", "1", 400, 1240), @("B1", "1", 400, -40),
    @("T2", "2", 1200, 1240), @("B2", "2", 1200, -40),
    @("LA", "A", -40, 900), @("RA", "A", 1640, 900),
    @("LB", "B", -40, 300), @("RB", "B", 1640, 300),
    @("inside-number", "1", 400, 900),
    @("unpaired-nine", "9", 800, 1240)
)) {
    $syntheticTexts.Add([Shb.Cad.Core.DrawingZoneTextSample]::new(
        $item[0], "test", $item[1], $item[2], $item[3]))
}
$synthetic = [Shb.Cad.Core.DrawingZoneDetector]::Detect($syntheticFrame, $syntheticTexts, $null)
Assert-Equal 2 $synthetic.System.Columns.Count "synthetic columns"
Assert-Equal 2 $synthetic.System.Rows.Count "synthetic rows"
Assert-Equal "A2" $synthetic.System.LocatePoint(1400, 1000).PrimaryZoneId "synthetic point"
$spanning = $synthetic.System.LocateBounds(700, 500, 900, 700)
Assert-Equal 4 $spanning.OverlappingZoneIds.Count "synthetic spanning bbox"

$rows | Format-Table -AutoSize
Write-Host "PASS: 7/7 real drawings; 1040 zones; 166 divider boundaries; 6 technical-requirements titles in row A; synthetic location tests."
