param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
$analyzerSource = Join-Path $scriptRoot "BodyCenterlineAnalyzer.cs"
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}

if ($null -eq ("Shb.Cad.Core.BodyCenterlineAnalyzer" -as [type])) {
    Add-Type -Path $analyzerSource
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message expected=$Expected actual=$Actual"
    }
}

function Assert-True {
    param([bool]$Actual, [string]$Message)
    if (-not $Actual) {
        throw "$Message expected=true actual=false"
    }
}

function Assert-Near {
    param([double]$Expected, [double]$Actual, [double]$Tolerance, [string]$Message)
    if ([Math]::Abs($Expected - $Actual) -gt $Tolerance) {
        throw "$Message expected=$Expected actual=$Actual tolerance=$Tolerance"
    }
}

function Assert-Contains {
    param([string]$ExpectedSubstring, [string]$Actual, [string]$Message)
    if (-not $Actual.Contains($ExpectedSubstring)) {
        throw "$Message missing=[$ExpectedSubstring]"
    }
}

function Get-PlainText {
    param($Record)
    if ($Record.text -is [string]) {
        return [string]$Record.text
    }
    if ($null -ne $Record.text -and $null -ne $Record.text.plain) {
        return [string]$Record.text.plain
    }
    return ""
}

function Find-SystemNear {
    param($Document, [double]$X, [double]$Y, [double]$Tolerance)
    return @($Document.AxisSystemCandidates | Where-Object {
        [Math]::Abs($_.CenterX - $X) -le $Tolerance -and
        [Math]::Abs($_.CenterY - $Y) -le $Tolerance
    })
}

$expected = [ordered]@{
    "5TBC.384.A110050.1_1"   = @{ Bounds = @(0, 0, 16120, 11480); Mentions = 0; Centers = @("3837.0,6590.9") }
    "5TBC.384.A110050.2_1"   = @{ Bounds = @(0, 0, 16120, 11480); Mentions = 2; Centers = @("4061.8,9240.9", "4061.8,4022.8") }
    "5TBC.426.A110050.1_1"   = @{ Bounds = @(0, 0, 20150, 14350); Mentions = 0; Centers = @("7784.4,10934.3") }
    "5TBC.457.A110050.1_1"   = @{ Bounds = @(0, 0, 20150, 14350); Mentions = 0; Centers = @("6032.7,4290.1") }
    "5TBC.709.A110050.1_1"   = @{ Bounds = @(0, 0, 20150, 14350); Mentions = 2; Centers = @("4710.0,3881.8") }
    "5TBC.709.A110050.1_2"   = @{ Bounds = @(0, 0, 20150, 14350); Mentions = 0; Centers = @() }
    "8TBC.312.A110050.101_1" = @{ Bounds = @(0, 0, 7800, 5740);   Mentions = 0; Centers = @("3794.4,3450.1") }
}

$documents = @{}
$rows = @()
foreach ($drawingId in $expected.Keys) {
    $drawingDir = Join-Path $ExtractionRoot $drawingId
    $tablesPath = Join-Path $drawingDir "tables.json"
    $entitiesPath = Join-Path $drawingDir "entities.jsonl"
    if (-not (Test-Path -LiteralPath $tablesPath) -or
        -not (Test-Path -LiteralPath $entitiesPath)) {
        throw "Missing extraction for $drawingId"
    }

    $spec = $expected[$drawingId]
    $bounds = $spec.Bounds
    $frames = [System.Collections.Generic.List[Shb.Cad.Core.BodyCenterlineFrameBounds]]::new()
    $frames.Add([Shb.Cad.Core.BodyCenterlineFrameBounds]::new(
        "drawing-area-frame-1",
        $bounds[0],
        $bounds[1],
        $bounds[2],
        $bounds[3]))

    $tables = Get-Content -LiteralPath $tablesPath -Raw | ConvertFrom-Json
    $layers = [System.Collections.Generic.List[Shb.Cad.Core.BodyCenterlineLayerObservation]]::new()
    foreach ($layer in $tables.layers) {
        $layers.Add([Shb.Cad.Core.BodyCenterlineLayerObservation]::new(
            [string]$layer.name,
            [string]$layer.handle,
            [string]$layer.linetype))
    }

    $lines = [System.Collections.Generic.List[Shb.Cad.Core.BodyCenterlineLineObservation]]::new()
    $texts = [System.Collections.Generic.List[Shb.Cad.Core.BodyCenterlineTextObservation]]::new()
    foreach ($jsonLine in Get-Content -LiteralPath $entitiesPath) {
        $isLine = $jsonLine -like '*"managed_type":"Line"*'
        $isText = $jsonLine -like '*"managed_type":"DBText"*' -or
            $jsonLine -like '*"managed_type":"MText"*'
        if (-not $isLine -and -not $isText) {
            continue
        }
        $record = $jsonLine | ConvertFrom-Json
        if ($isLine -and $null -ne $record.geometry.start -and $null -ne $record.geometry.end) {
            $lines.Add([Shb.Cad.Core.BodyCenterlineLineObservation]::new(
                [string]$record.handle,
                [string]$record.layer,
                [string]$record.owner_scope,
                [string]$record.owner_block_name,
                [double]$record.geometry.start[0],
                [double]$record.geometry.start[1],
                [double]$record.geometry.end[0],
                [double]$record.geometry.end[1]))
        }
        elseif ($isText -and $null -ne $record.bbox) {
            $texts.Add([Shb.Cad.Core.BodyCenterlineTextObservation]::new(
                [string]$record.handle,
                [string]$record.layer,
                [string]$record.owner_scope,
                (Get-PlainText $record),
                [double]$record.bbox.min[0],
                [double]$record.bbox.min[1],
                [double]$record.bbox.max[0],
                [double]$record.bbox.max[1]))
        }
    }

    $document = [Shb.Cad.Core.BodyCenterlineAnalyzer]::Analyze(
        $drawingId,
        $frames,
        $layers,
        $lines,
        $texts,
        $null)
    $documents[$drawingId] = $document

    Assert-Equal 1 $document.FrameCount "$drawingId frame count"
    Assert-Equal $false $document.HasExplicitModelEvidence "$drawingId explicit model evidence"
    Assert-Equal $spec.Mentions $document.TextMentions.Count "$drawingId body-centerline mentions"
    Assert-True ($document.AxisCandidates.Count -gt 0) "$drawingId has centerline geometry candidates"
    foreach ($centerText in $spec.Centers) {
        $center = $centerText.Split(',')
        $centerX = [double]::Parse($center[0], [Globalization.CultureInfo]::InvariantCulture)
        $centerY = [double]::Parse($center[1], [Globalization.CultureInfo]::InvariantCulture)
        $nearbySystems = Find-SystemNear $document $centerX $centerY 1.0
        if ($nearbySystems.Count -eq 0) {
            $availableCenters = @($document.AxisSystemCandidates | ForEach-Object {
                "{0:0.0},{1:0.0}" -f $_.CenterX, $_.CenterY
            }) -join "; "
            throw "$drawingId missing axis system near $centerX,$centerY; available=[$availableCenters]"
        }
    }
    if ($drawingId -eq "5TBC.709.A110050.1_2") {
        Assert-Equal 0 $document.AxisSystemCandidates.Count "$drawingId standalone axes only"
    }

    $json = $document.ToMap() | ConvertTo-Json -Depth 20 -Compress
    Assert-Contains '"analysis_type":"body_centerline"' $json "$drawingId JSON"
    Assert-Contains '"status":"geometric_candidates_only"' $json "$drawingId JSON status"
    $markdown = $document.ToMarkdown()
    Assert-Contains '# 器身中心线分析' $markdown "$drawingId Markdown heading"
    Assert-Contains '不能自动盖章为器身中心线' $markdown "$drawingId Markdown warning"

    $rows += [pscustomobject]@{
        Drawing = $drawingId
        CenterlineLayers = $document.LayerEvidence.Count
        TextMentions = $document.TextMentions.Count
        Axes = $document.AxisCandidates.Count
        Systems = $document.AxisSystemCandidates.Count
        TopSystemCenter = if ($document.AxisSystemCandidates.Count -gt 0) {
            "{0:0.0},{1:0.0}" -f $document.AxisSystemCandidates[0].CenterX,
                $document.AxisSystemCandidates[0].CenterY
        }
        else { "-" }
    }
}

$upper384 = $documents["5TBC.384.A110050.1_1"]
$explicitLayer = @($upper384.LayerEvidence | Where-Object { $_.Layer.Name -eq "4-器身中心线" })
Assert-Equal 1 $explicitLayer.Count "upper 384 explicit layer evidence"
Assert-Equal 0 $explicitLayer[0].ModelSpaceLineCount "upper 384 explicit layer model-space lines"
Assert-Equal 7 $explicitLayer[0].BlockDefinitionLineCount "upper 384 explicit layer block-definition lines"

# Synthetic regression: merge overlapping fragments, form one orthogonal axis
# system, attach explicit text evidence, and expose deterministic symmetry math.
$syntheticFrames = [System.Collections.Generic.List[Shb.Cad.Core.BodyCenterlineFrameBounds]]::new()
$syntheticFrames.Add([Shb.Cad.Core.BodyCenterlineFrameBounds]::new("frame", 0, 0, 1000, 800))
$syntheticLayers = [System.Collections.Generic.List[Shb.Cad.Core.BodyCenterlineLayerObservation]]::new()
$syntheticLayers.Add([Shb.Cad.Core.BodyCenterlineLayerObservation]::new("中心线", "L1", "CENTER"))
$syntheticLines = [System.Collections.Generic.List[Shb.Cad.Core.BodyCenterlineLineObservation]]::new()
$syntheticLines.Add([Shb.Cad.Core.BodyCenterlineLineObservation]::new("h", "中心线", "model_space", "*Model_Space", 100, 400, 900, 400))
$syntheticLines.Add([Shb.Cad.Core.BodyCenterlineLineObservation]::new("v1", "中心线", "model_space", "*Model_Space", 500, 100, 500, 500))
$syntheticLines.Add([Shb.Cad.Core.BodyCenterlineLineObservation]::new("v2", "中心线", "model_space", "*Model_Space", 500, 490, 500, 700))
$syntheticTexts = [System.Collections.Generic.List[Shb.Cad.Core.BodyCenterlineTextObservation]]::new()
$syntheticTexts.Add([Shb.Cad.Core.BodyCenterlineTextObservation]::new("text", "文字", "model_space", "器身中心线", 510, 410, 550, 430))
$synthetic = [Shb.Cad.Core.BodyCenterlineAnalyzer]::Analyze(
    "synthetic",
    $syntheticFrames,
    $syntheticLayers,
    $syntheticLines,
    $syntheticTexts,
    $null)
Assert-Equal 2 $synthetic.AxisCandidates.Count "synthetic merged axes"
Assert-Equal 1 $synthetic.AxisSystemCandidates.Count "synthetic orthogonal system"
Assert-Equal $true $synthetic.HasExplicitModelEvidence "synthetic nearby explicit text"
Assert-Near 500 $synthetic.AxisSystemCandidates[0].CenterX 0.000001 "synthetic center x"
Assert-Near 400 $synthetic.AxisSystemCandidates[0].CenterY 0.000001 "synthetic center y"
$vertical = @($synthetic.AxisCandidates | Where-Object { [Math]::Abs($_.OrientationDegrees - 90) -lt 0.001 })[0]
Assert-Equal 2 $vertical.SourceHandles.Count "synthetic merged source handles"
Assert-Near -100 $vertical.SignedDistance(600, 400) 0.000001 "synthetic signed distance"
$reflected = $vertical.ReflectPoint(600, 400)
Assert-Near 400 $reflected[0] 0.000001 "synthetic reflected x"
Assert-Near 400 $reflected[1] 0.000001 "synthetic reflected y"

$rows | Format-Table -AutoSize
Write-Host "PASS: seven drawings yield evidence-preserving centerline candidates; no generic candidate is falsely certified; symmetry operations verified."
