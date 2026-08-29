param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
$sources = @(
    (Join-Path $scriptRoot "CenterlineIdentifier.cs"),
    (Join-Path $scriptRoot "CenterlineShapeClassifier.cs"))
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}

if ($null -eq ("Shb.Cad.Core.CenterlineIdentifier" -as [type])) {
    Add-Type -Path $sources
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

function Get-CenterlineLeaderText {
    param($Record)
    foreach ($part in @($Record.custom.explode)) {
        $candidate = if ($null -ne $part.plain) {
            [string]$part.plain
        }
        elseif ($null -ne $part.string) {
            [string]$part.string
        }
        else { "" }
        if ($candidate.Contains("中心线")) {
            return $candidate
        }
    }
    return ""
}

function Get-LeaderVertices {
    param($Record)
    $vertices = @($Record.geometry.vertices)
    if ($vertices.Count -ge 2) {
        return @($vertices[0], $vertices[$vertices.Count - 1])
    }
    $first = $Record.custom.properties.FirstVertex
    $last = $Record.custom.properties.LastVertex
    if ($null -ne $first -and $null -ne $last) {
        return @($first, $last)
    }
    return @()
}

function New-CenterlinePrimitive {
    param($Record)
    $common = @(
        [string]$Record.handle,
        [string]$Record.layer,
        [string]$Record.linetype,
        [string]$Record.owner_scope,
        [string]$Record.owner_block_name)
    switch ([string]$Record.geometry.kind) {
        "line" {
            return [Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateLine(
                $common[0], $common[1], $common[2], $common[3], $common[4],
                [double]$Record.geometry.start[0],
                [double]$Record.geometry.start[1],
                [double]$Record.geometry.end[0],
                [double]$Record.geometry.end[1])
        }
        "arc" {
            return [Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateArc(
                $common[0], $common[1], $common[2], $common[3], $common[4],
                [double]$Record.geometry.center[0],
                [double]$Record.geometry.center[1],
                [double]$Record.geometry.radius,
                [double]$Record.geometry.start_angle,
                [double]$Record.geometry.end_angle)
        }
        "circle" {
            return [Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateCircle(
                $common[0], $common[1], $common[2], $common[3], $common[4],
                [double]$Record.geometry.center[0],
                [double]$Record.geometry.center[1],
                [double]$Record.geometry.radius)
        }
        "lwpolyline" {
            $vertices = [System.Collections.Generic.List[Shb.Cad.Core.CenterlineVertexObservation]]::new()
            foreach ($vertex in @($Record.geometry.vertices)) {
                $vertices.Add([Shb.Cad.Core.CenterlineVertexObservation]::new(
                    [double]$vertex.point[0],
                    [double]$vertex.point[1],
                    [double]$vertex.bulge))
            }
            return [Shb.Cad.Core.CenterlinePrimitiveObservation]::CreatePolyline(
                $common[0], $common[1], $common[2], $common[3], $common[4],
                [bool]$Record.geometry.closed,
                $vertices)
        }
        "spline" {
            $points = [System.Collections.Generic.List[Shb.Cad.Core.CenterlinePointObservation]]::new()
            foreach ($point in @($Record.geometry.control_points)) {
                $points.Add([Shb.Cad.Core.CenterlinePointObservation]::new(
                    [double]$point[0],
                    [double]$point[1]))
            }
            return [Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateSpline(
                $common[0], $common[1], $common[2], $common[3], $common[4],
                [bool]$Record.geometry.closed,
                $points)
        }
        default { return $null }
    }
}

$expected = [ordered]@{
    "5TBC.384.A110050.1_1"   = @{ Total = 1484; Line = 1412; Arc = 16; Circle = 43; Polyline = 13; Spline = 0; Labels = 11 }
    "5TBC.384.A110050.2_1"   = @{ Total = 124;  Line = 122;  Arc = 1;  Circle = 1;  Polyline = 0;  Spline = 0; Labels = 6 }
    "5TBC.426.A110050.1_1"   = @{ Total = 753;  Line = 704;  Arc = 10; Circle = 37; Polyline = 2;  Spline = 0; Labels = 3 }
    "5TBC.457.A110050.1_1"   = @{ Total = 618;  Line = 575;  Arc = 24; Circle = 7;  Polyline = 12; Spline = 0; Labels = 3 }
    "5TBC.709.A110050.1_1"   = @{ Total = 634;  Line = 584;  Arc = 17; Circle = 19; Polyline = 13; Spline = 1; Labels = 2 }
    "5TBC.709.A110050.1_2"   = @{ Total = 108;  Line = 107;  Arc = 0;  Circle = 1;  Polyline = 0;  Spline = 0; Labels = 3 }
    "8TBC.312.A110050.101_1" = @{ Total = 127;  Line = 123;  Arc = 0;  Circle = 4;  Polyline = 0;  Spline = 0; Labels = 1 }
}

$documents = @{}
$rows = @()
$totalStyle = 0
$totalLabels = 0
$totalShapes = 0
$totalIntersections = 0
$totalHorizontal = 0
$totalVertical = 0
$totalAngled = 0
$shapeTypeTotals = @{}
$intersectionTypeTotals = @{}
$intersectionGeometryTotals = @{}
foreach ($drawingId in $expected.Keys) {
    $drawingDir = Join-Path $ExtractionRoot $drawingId
    $tablesPath = Join-Path $drawingDir "tables.json"
    $entitiesPath = Join-Path $drawingDir "entities.jsonl"
    if (-not (Test-Path -LiteralPath $tablesPath) -or
        -not (Test-Path -LiteralPath $entitiesPath)) {
        throw "Missing extraction for $drawingId"
    }

    $tables = Get-Content -LiteralPath $tablesPath -Raw | ConvertFrom-Json
    $layers = [System.Collections.Generic.List[Shb.Cad.Core.CenterlineLayerObservation]]::new()
    foreach ($layer in $tables.layers) {
        $layers.Add([Shb.Cad.Core.CenterlineLayerObservation]::new(
            [string]$layer.name,
            [string]$layer.handle,
            [string]$layer.linetype))
    }

    $primitives = [System.Collections.Generic.List[Shb.Cad.Core.CenterlinePrimitiveObservation]]::new()
    $leaders = [System.Collections.Generic.List[Shb.Cad.Core.CenterlineLabelLeaderObservation]]::new()
    $leaderCount = 0
    foreach ($jsonLine in Get-Content -LiteralPath $entitiesPath) {
        $isGeometry = $jsonLine -like '*"managed_type":"Line"*' -or
            $jsonLine -like '*"managed_type":"Arc"*' -or
            $jsonLine -like '*"managed_type":"Circle"*' -or
            $jsonLine -like '*"managed_type":"Polyline"*' -or
            $jsonLine -like '*"managed_type":"Spline"*'
        $isCenterlineLeader = $jsonLine -like '*"managed_type":"Leader"*' -and
            $jsonLine -like '*中心线*'
        if (-not $isGeometry -and -not $isCenterlineLeader) {
            continue
        }
        $record = $jsonLine | ConvertFrom-Json
        if ($isGeometry) {
            $primitive = New-CenterlinePrimitive $record
            if ($null -ne $primitive) {
                $primitives.Add($primitive)
            }
        }
        elseif ($isCenterlineLeader) {
            $leaderText = Get-CenterlineLeaderText $record
            $vertices = @(Get-LeaderVertices $record)
            if ([string]::IsNullOrEmpty($leaderText) -or $vertices.Count -lt 2) {
                continue
            }
            $leaders.Add([Shb.Cad.Core.CenterlineLabelLeaderObservation]::new(
                [string]$record.handle,
                [string]$record.owner_scope,
                [string]$record.owner_block_name,
                $leaderText,
                [double]$vertices[0][0],
                [double]$vertices[0][1],
                [double]$vertices[1][0],
                [double]$vertices[1][1]))
            $leaderCount++
        }
    }

    $byText = [Shb.Cad.Core.CenterlineIdentifier]::FindByText(
        $layers, $primitives, $leaders, $null)
    $byStyle = [Shb.Cad.Core.CenterlineIdentifier]::FindByStyle(
        $layers, $primitives, $null)
    $document = [Shb.Cad.Core.CenterlineIdentifier]::Identify(
        $drawingId, $layers, $primitives, $leaders, $null)
    $documents[$drawingId] = $document

    $spec = $expected[$drawingId]
    Assert-Equal $spec.Total $byStyle.Count "$drawingId styled center geometry"
    Assert-Equal $spec.Line $document.GeometryKindCount("line") "$drawingId lines"
    Assert-Equal $spec.Arc $document.GeometryKindCount("arc") "$drawingId arcs"
    Assert-Equal $spec.Circle $document.GeometryKindCount("circle") "$drawingId circles"
    Assert-Equal $spec.Polyline $document.GeometryKindCount("polyline") "$drawingId polylines"
    Assert-Equal $spec.Spline $document.GeometryKindCount("spline") "$drawingId splines"
    Assert-Equal $spec.Labels $leaderCount "$drawingId centerline labels"
    Assert-Equal ($byStyle.Count + $byText.Count - $document.BothMatchedCount) `
        $document.Centerlines.Count "$drawingId union arithmetic"
    Assert-True ($document.Shapes.Count -gt 0) "$drawingId shapes"
    Assert-True ($document.Intersections.Count -gt 0) "$drawingId intersections"
    foreach ($centerline in $document.Centerlines) {
        Assert-True ($centerline.ShapeIds.Count -gt 0) "$drawingId shape link $($centerline.Handle)"
    }
    foreach ($intersection in $document.Intersections) {
        Assert-True ($intersection.PrimitiveHandles.Count -ge 2) "$drawingId intersection participants"
        Assert-True (-not [double]::IsNaN($intersection.X)) "$drawingId intersection x"
        Assert-True (-not [double]::IsNaN($intersection.Y)) "$drawingId intersection y"
    }

    $json = $document.ToMap() | ConvertTo-Json -Depth 30 -Compress
    Assert-Contains '"analysis_type":"centerline_identification"' $json "$drawingId JSON"
    Assert-Contains '"identifier_version":"3"' $json "$drawingId JSON version"
    Assert-Contains '"straight_direction_counts":' $json "$drawingId JSON directions"
    Assert-Contains '"intersections":' $json "$drawingId JSON intersections"
    Assert-Contains '"shapes":' $json "$drawingId JSON shapes"
    Assert-Contains '"symmetry_evaluation_status":"not_evaluated"' $json `
        "$drawingId JSON symmetry boundary"
    Assert-Contains '"labeled_reference_axis_relations":' $json `
        "$drawingId JSON labeled reference-axis relations"
    $markdown = $document.ToMarkdown()
    Assert-Contains '# 中心线与中心几何识别' $markdown "$drawingId Markdown heading"
    Assert-Contains '## 中心几何交点（视觉锚点）' $markdown "$drawingId Markdown intersections"
    Assert-Contains '## 具名平行参考轴关系' $markdown `
        "$drawingId Markdown labeled reference-axis relations"

    $rows += [pscustomobject]@{
        Drawing = $drawingId
        Labels = $leaderCount
        Text = $byText.Count
        Geometries = $document.Centerlines.Count
        H = $document.HorizontalLineCount
        V = $document.VerticalLineCount
        Angled = $document.AngledLineCount
        Shapes = $document.Shapes.Count
        Intersections = $document.Intersections.Count
    }
    $totalStyle += $byStyle.Count
    $totalLabels += $leaderCount
    $totalShapes += $document.Shapes.Count
    $totalIntersections += $document.Intersections.Count
    $totalHorizontal += $document.HorizontalLineCount
    $totalVertical += $document.VerticalLineCount
    $totalAngled += $document.AngledLineCount
    foreach ($shape in $document.Shapes) {
        if (-not $shapeTypeTotals.ContainsKey($shape.ShapeType)) {
            $shapeTypeTotals[$shape.ShapeType] = 0
        }
        $shapeTypeTotals[$shape.ShapeType]++
    }
    foreach ($intersection in $document.Intersections) {
        if (-not $intersectionTypeTotals.ContainsKey($intersection.IntersectionType)) {
            $intersectionTypeTotals[$intersection.IntersectionType] = 0
        }
        $intersectionTypeTotals[$intersection.IntersectionType]++
        $geometryKey = @($intersection.GeometryKinds | Sort-Object) -join "+"
        if (-not $intersectionGeometryTotals.ContainsKey($geometryKey)) {
            $intersectionGeometryTotals[$geometryKey] = 0
        }
        $intersectionGeometryTotals[$geometryKey]++
    }
}

Assert-Equal 3848 $totalStyle "seven drawings styled center-geometry total"
Assert-Equal 29 $totalLabels "seven drawings centerline-label total"
Assert-Equal 1243 $totalHorizontal "seven drawings horizontal lines"
Assert-Equal 1641 $totalVertical "seven drawings vertical lines"
Assert-Equal 743 $totalAngled "seven drawings angled lines"
Assert-Equal 3412 $totalShapes "seven drawings center shapes"
Assert-Equal 2059 $totalIntersections "seven drawings intersection anchors"
Assert-Equal 26 $shapeTypeTotals["u_polyline_path"] "seven drawings U paths"
Assert-Equal 14 $shapeTypeTotals["rounded_bend_path"] "seven drawings rounded bends"
Assert-Equal 112 $shapeTypeTotals["circular_reference"] "seven drawings circular references"
Assert-Equal 783 $intersectionTypeTotals["multiway"] "seven drawings multiway anchors"

# The user's screenshot remains an exact label-to-Line binding after curved geometry is added.
$upper = $documents["5TBC.384.A110050.1_1"]
$body = @($upper.Centerlines | Where-Object {
    $_.Handle -eq "4B297" -and
    @($_.LabelBindings | Where-Object LeaderHandle -eq "37783").Count -eq 1
})
$tank = @($upper.Centerlines | Where-Object {
    $_.Handle -eq "36AA8" -and
    @($_.LabelBindings | Where-Object LeaderHandle -eq "377B2").Count -eq 1
})
Assert-Equal 1 $body.Count "screenshot body centerline binding"
Assert-Equal 1 $tank.Count "screenshot tank centerline binding"
Assert-True $body[0].MatchedByStyle "screenshot body style path"
Assert-True $tank[0].MatchedByStyle "screenshot tank style path"
$bodyBinding = @($body[0].LabelBindings | Where-Object LeaderHandle -eq "37783")[0]
$tankBinding = @($tank[0].LabelBindings | Where-Object LeaderHandle -eq "377B2")[0]
Assert-Near 30 ($bodyBinding.GeometryPointY - $tankBinding.GeometryPointY) 0.000001 `
    "screenshot body/tank 30 offset"
$bodyTankRelations = @($upper.FindLabeledReferenceAxisRelations() | Where-Object {
    $_.FromHandle -eq "36AA8" -and $_.ToHandle -eq "4B297"
})
Assert-Equal 1 $bodyTankRelations.Count "screenshot body/tank reference-axis relation"
Assert-Equal "parallel_offset" $bodyTankRelations[0].AlignmentStatus `
    "screenshot body/tank alignment status"
Assert-Equal "not_evaluated" $bodyTankRelations[0].SymmetryEvaluationStatus `
    "screenshot body/tank symmetry status"
Assert-Near 30 $bodyTankRelations[0].SignedNormalOffset 0.000001 `
    "screenshot tank-to-body signed normal offset"
Assert-Near 5656 $bodyTankRelations[0].TangentOverlap 0.000001 `
    "screenshot body/tank tangent overlap"

# Synthetic geometry: horizontal, vertical and angled axes meet at one visual anchor;
# a line crosses a circle twice; Line + quarter Arc + Line forms one rounded path;
# an open four-vertex Polyline is recognized as a U path.
$syntheticLayers = [System.Collections.Generic.List[Shb.Cad.Core.CenterlineLayerObservation]]::new()
$syntheticLayers.Add([Shb.Cad.Core.CenterlineLayerObservation]::new("中心线", "L1", "CENTER"))
$syntheticPrimitives = [System.Collections.Generic.List[Shb.Cad.Core.CenterlinePrimitiveObservation]]::new()
$syntheticPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateLine(
    "H", "中心线", "ByLayer", "model_space", "*Model_Space", -30, 0, 30, 0))
$syntheticPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateLine(
    "V", "中心线", "ByLayer", "model_space", "*Model_Space", 0, -10, 0, 10))
$syntheticPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateLine(
    "A", "中心线", "ByLayer", "model_space", "*Model_Space", -10, -10, 10, 10))
$syntheticPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateCircle(
    "C", "中心线", "ByLayer", "model_space", "*Model_Space", 20, 0, 5))
$syntheticPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateArc(
    "Q", "中心线", "ByLayer", "model_space", "*Model_Space", 50, 0, 10, 0, [Math]::PI / 2))
$syntheticPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateLine(
    "L1", "中心线", "ByLayer", "model_space", "*Model_Space", 50, 10, 40, 10))
$syntheticPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateLine(
    "L2", "中心线", "ByLayer", "model_space", "*Model_Space", 60, 0, 60, -10))
$uVertices = [System.Collections.Generic.List[Shb.Cad.Core.CenterlineVertexObservation]]::new()
$uVertices.Add([Shb.Cad.Core.CenterlineVertexObservation]::new(-5, 30, 0))
$uVertices.Add([Shb.Cad.Core.CenterlineVertexObservation]::new(-5, 20, 0))
$uVertices.Add([Shb.Cad.Core.CenterlineVertexObservation]::new(5, 20, 0))
$uVertices.Add([Shb.Cad.Core.CenterlineVertexObservation]::new(5, 30, 0))
$syntheticPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreatePolyline(
    "U", "中心线", "ByLayer", "model_space", "*Model_Space", $false, $uVertices))
$syntheticLeaders = [System.Collections.Generic.List[Shb.Cad.Core.CenterlineLabelLeaderObservation]]::new()
$syntheticLeaders.Add([Shb.Cad.Core.CenterlineLabelLeaderObservation]::new(
    "LB1", "model_space", "*Model_Space", "器身中心线", 1, 0, 2, 2))
$syntheticLeaders.Add([Shb.Cad.Core.CenterlineLabelLeaderObservation]::new(
    "LB2", "model_space", "*Model_Space", "分布圆中心线", 20, 5, 22, 7))
$synthetic = [Shb.Cad.Core.CenterlineIdentifier]::Identify(
    "synthetic", $syntheticLayers, $syntheticPrimitives, $syntheticLeaders, $null)
Assert-Equal 8 $synthetic.Centerlines.Count "synthetic center geometries"
Assert-Equal 2 $synthetic.HorizontalLineCount "synthetic horizontal"
Assert-Equal 2 $synthetic.VerticalLineCount "synthetic vertical"
Assert-Equal 1 $synthetic.AngledLineCount "synthetic angled"
$angled = @($synthetic.Centerlines | Where-Object Handle -eq "A")[0]
Assert-Near 45 $angled.OrientationDegrees 0.000001 "synthetic angled orientation"
Assert-Equal "angled" $angled.DirectionClass "synthetic angled class"
Assert-Equal 1 $synthetic.FindShapesByType("rounded_bend_path").Count `
    "synthetic rounded Line-Arc-Line path"
Assert-Equal 1 $synthetic.FindShapesByType("u_polyline_path").Count `
    "synthetic U polyline path"
$origin = @($synthetic.FindIntersectionsNear(
    "model_space", "*Model_Space", 0, 0, 0.01))
Assert-Equal 1 $origin.Count "synthetic clustered origin intersection"
Assert-Equal "multiway" $origin[0].IntersectionType "synthetic multiway type"
Assert-Equal 3 $origin[0].PrimitiveHandles.Count "synthetic multiway handles"
$circleCrossings = @($synthetic.Intersections | Where-Object {
    $_.PrimitiveHandles.Contains("C") -and $_.PrimitiveHandles.Contains("H")
})
Assert-Equal 2 $circleCrossings.Count "synthetic line-circle intersections"
$roundedJoins = @($synthetic.Intersections | Where-Object {
    $_.PrimitiveHandles.Contains("Q") -and
    ($_.PrimitiveHandles.Contains("L1") -or $_.PrimitiveHandles.Contains("L2"))
})
Assert-Equal 2 $roundedJoins.Count "synthetic rounded-path joins"
foreach ($join in $roundedJoins) {
    Assert-Equal "tangent_join" $join.IntersectionType "synthetic rounded-path tangent type"
}
$window = $origin[0].Around(2, 3)
Assert-Near -2 $window.MinX 0.000001 "synthetic neighborhood min x"
Assert-Near 3 $window.MaxY 0.000001 "synthetic neighborhood max y"
$circle = @($synthetic.Centerlines | Where-Object Handle -eq "C")[0]
Assert-Near 5 $circle.RadialDistance(30, 0) 0.000001 "synthetic radial distance"
Assert-Near 90 $circle.PolarAngleDegrees(20, 5) 0.000001 "synthetic polar angle"

# Exact radial intersections in separate coordinate spaces: two circles meet twice;
# two upper semicircular arcs retain only their common upper point.
$radialPrimitives = [System.Collections.Generic.List[Shb.Cad.Core.CenterlinePrimitiveObservation]]::new()
$radialPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateCircle(
    "C1", "中心线", "ByLayer", "block_definition", "CirclePair", 0, 0, 5))
$radialPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateCircle(
    "C2", "中心线", "ByLayer", "block_definition", "CirclePair", 6, 0, 5))
$radialPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateArc(
    "R1", "中心线", "ByLayer", "block_definition", "ArcPair", 0, 0, 5, 0, [Math]::PI))
$radialPrimitives.Add([Shb.Cad.Core.CenterlinePrimitiveObservation]::CreateArc(
    "R2", "中心线", "ByLayer", "block_definition", "ArcPair", 6, 0, 5, 0, [Math]::PI))
$noLeaders = [System.Collections.Generic.List[Shb.Cad.Core.CenterlineLabelLeaderObservation]]::new()
$radialSynthetic = [Shb.Cad.Core.CenterlineIdentifier]::Identify(
    "radial-synthetic", $syntheticLayers, $radialPrimitives, $noLeaders, $null)
$circlePair = @($radialSynthetic.Intersections | Where-Object OwnerBlockName -eq "CirclePair")
$arcPair = @($radialSynthetic.Intersections | Where-Object OwnerBlockName -eq "ArcPair")
Assert-Equal 2 $circlePair.Count "synthetic circle-circle intersections"
Assert-Equal 1 $arcPair.Count "synthetic arc-arc filtered intersection"
Assert-Near 3 $arcPair[0].X 0.000001 "synthetic arc-arc x"
Assert-Near 4 $arcPair[0].Y 0.000001 "synthetic arc-arc y"

$rows | Format-Table -AutoSize
Write-Host "SHAPE TYPES"
$shapeTypeTotals.GetEnumerator() | Sort-Object Name | Format-Table -AutoSize
Write-Host "INTERSECTION TYPES"
$intersectionTypeTotals.GetEnumerator() | Sort-Object Name | Format-Table -AutoSize
Write-Host "INTERSECTION GEOMETRY SETS"
$intersectionGeometryTotals.GetEnumerator() | Sort-Object Name | Format-Table -AutoSize
Write-Host "TOTAL shapes=$totalShapes intersections=$totalIntersections horizontal=$totalHorizontal vertical=$totalVertical angled=$totalAngled"
Write-Host "PASS: center geometry, labeled reference-axis offsets, explicit symmetry boundary, intersections, and neighborhoods verified."
