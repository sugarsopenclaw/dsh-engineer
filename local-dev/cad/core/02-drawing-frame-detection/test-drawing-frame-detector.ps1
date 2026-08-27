param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
$detectorSource = Join-Path $scriptRoot "DrawingFrameDetector.cs"
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}

Add-Type -Path $detectorSource

function New-FrameSegment {
    param(
        [string]$Handle,
        [string]$Layer,
        [double]$StartX,
        [double]$StartY,
        [double]$EndX,
        [double]$EndY
    )

    return [Shb.Cad.Core.DrawingFrameSegment]::new(
        $Handle,
        $Layer,
        $StartX,
        $StartY,
        $EndX,
        $EndY)
}

function Add-Rectangle {
    param(
        $Segments,
        [string]$Prefix,
        [string]$Layer,
        [double]$MinX,
        [double]$MinY,
        [double]$MaxX,
        [double]$MaxY
    )

    $Segments.Add((New-FrameSegment "$Prefix-L" $Layer $MinX $MinY $MinX $MaxY))
    $Segments.Add((New-FrameSegment "$Prefix-R" $Layer $MaxX $MinY $MaxX $MaxY))
    $Segments.Add((New-FrameSegment "$Prefix-B" $Layer $MinX $MinY $MaxX $MinY))
    $Segments.Add((New-FrameSegment "$Prefix-T" $Layer $MinX $MaxY $MaxX $MaxY))
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message expected=$Expected actual=$Actual"
    }
}

$expectedBounds = @{
    "5TBC.384.A110050.1_1"   = @(0, 0, 16120, 11480)
    "5TBC.384.A110050.2_1"   = @(0, 0, 16120, 11480)
    "5TBC.426.A110050.1_1"   = @(0, 0, 20150, 14350)
    "5TBC.457.A110050.1_1"   = @(0, 0, 20150, 14350)
    "5TBC.709.A110050.1_1"   = @(0, 0, 20150, 14350)
    "5TBC.709.A110050.1_2"   = @(0, 0, 20150, 14350)
    "8TBC.312.A110050.101_1" = @(0, 0, 7800, 5740)
}

$realDrawingRows = @()
foreach ($drawingId in ($expectedBounds.Keys | Sort-Object)) {
    $entitiesPath = Join-Path $ExtractionRoot "$drawingId\entities.jsonl"
    if (-not (Test-Path -LiteralPath $entitiesPath)) {
        throw "Missing extraction: $entitiesPath"
    }

    $segments = [System.Collections.Generic.List[Shb.Cad.Core.DrawingFrameSegment]]::new()
    Get-Content -LiteralPath $entitiesPath | Where-Object {
        $_ -like '*"owner_scope":"model_space"*' -and $_ -like '*"runtime_class":"AcDbLine"*'
    } | ForEach-Object {
        $entity = $_ | ConvertFrom-Json
        $start = $entity.geometry.start
        $end = $entity.geometry.end
        if ($null -ne $start -and $null -ne $end) {
            $segments.Add((New-FrameSegment `
                ([string]$entity.handle) `
                ([string]$entity.layer) `
                ([double]$start[0]) `
                ([double]$start[1]) `
                ([double]$end[0]) `
                ([double]$end[1])))
        }
    }

    $detected = [Shb.Cad.Core.DrawingFrameDetector]::Detect($segments, $null)
    Assert-Equal 4 $detected.EligibleLayerLineCount "$drawingId eligible frame lines"
    Assert-Equal 1 $detected.Candidates.Count "$drawingId candidate frames"
    Assert-Equal 1 $detected.OutermostFrames.Count "$drawingId outermost frames"

    $frame = $detected.OutermostFrames[0]
    $expected = $expectedBounds[$drawingId]
    Assert-Equal $expected[0] $frame.MinX "$drawingId minX"
    Assert-Equal $expected[1] $frame.MinY "$drawingId minY"
    Assert-Equal $expected[2] $frame.MaxX "$drawingId maxX"
    Assert-Equal $expected[3] $frame.MaxY "$drawingId maxY"

    $realDrawingRows += [pscustomobject]@{
        Drawing = $drawingId
        SourceLines = $detected.SourceLineCount
        FrameLines = $detected.EligibleLayerLineCount
        Bounds = "{0},{1} -> {2},{3}" -f $frame.MinX, $frame.MinY, $frame.MaxX, $frame.MaxY
        Handles = "{0},{1},{2},{3}" -f `
            $frame.Left.Handle, $frame.Right.Handle, $frame.Bottom.Handle, $frame.Top.Handle
    }
}

# Synthetic regression: two disjoint outer frames, one nested frame, one
# diagonal on the correct layer, and a complete rectangle on the wrong layer.
$synthetic = [System.Collections.Generic.List[Shb.Cad.Core.DrawingFrameSegment]]::new()
Add-Rectangle $synthetic "outer" "图框层" 0 0 100 80
Add-Rectangle $synthetic "inner" "图框层" 10 10 90 70
Add-Rectangle $synthetic "second" "图框层" 200 0 260 50
$synthetic.Add((New-FrameSegment "noise-diagonal" "图框层" 0 0 10 10))
Add-Rectangle $synthetic "wrong-layer" "辅助层" 300 0 340 40
$syntheticResult = [Shb.Cad.Core.DrawingFrameDetector]::Detect($synthetic, $null)
Assert-Equal 3 $syntheticResult.Candidates.Count "synthetic candidate frames"
Assert-Equal 2 $syntheticResult.OutermostFrames.Count "synthetic outermost frames"
Assert-Equal 1 $syntheticResult.RejectedNonAxisAlignedCount "synthetic diagonal rejection"
$nested = @($syntheticResult.Candidates | Where-Object { $_.Width -eq 80 -and $_.Height -eq 60 })
Assert-Equal 1 $nested.Count "synthetic nested frame"
Assert-Equal $false $nested[0].IsOutermost "synthetic nested classification"

# Current v1 limitation is deliberate and machine-readable: a side split into
# two collinear line entities is not yet joined into one frame edge.
$splitSide = [System.Collections.Generic.List[Shb.Cad.Core.DrawingFrameSegment]]::new()
$splitSide.Add((New-FrameSegment "L1" "图框层" 0 0 0 40))
$splitSide.Add((New-FrameSegment "L2" "图框层" 0 40 0 80))
$splitSide.Add((New-FrameSegment "R" "图框层" 100 0 100 80))
$splitSide.Add((New-FrameSegment "B" "图框层" 0 0 100 0))
$splitSide.Add((New-FrameSegment "T" "图框层" 0 80 100 80))
$splitResult = [Shb.Cad.Core.DrawingFrameDetector]::Detect($splitSide, $null)
Assert-Equal 0 $splitResult.Candidates.Count "split-side v1 limitation"

$realDrawingRows | Format-Table -AutoSize
Write-Host "PASS: 7/7 real drawings; multi-frame, nested, noise, wrong-layer, and split-side regressions."
