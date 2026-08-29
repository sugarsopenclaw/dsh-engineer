$ErrorActionPreference = 'Stop'

$files = @(
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../12-planar-topology-kernel/PlanarTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'RepresentationCorrespondenceAnalyzer.cs')
)
Add-Type -Path $files

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERT TRUE failed: $Message" }
}

function Assert-Equal($Expected, $Actual, [string]$Message) {
    if ($Expected -ne $Actual) {
        throw "ASSERT EQUAL failed: $Message; expected=[$Expected], actual=[$Actual]"
    }
}

function Assert-Near([double]$Expected, [double]$Actual, [double]$Tolerance, [string]$Message) {
    if ([Math]::Abs($Expected - $Actual) -gt $Tolerance) {
        throw "ASSERT NEAR failed: $Message; expected=[$Expected], actual=[$Actual]"
    }
}

function New-PointList([object[]]$Coordinates) {
    $result = [System.Collections.Generic.List[Shb.Cad.Core.InstancePoint3Observation]]::new()
    foreach ($coordinate in $Coordinates) {
        $result.Add([Shb.Cad.Core.InstancePoint3Observation]::new(
            [double]$coordinate[0], [double]$coordinate[1], 0))
    }
    return ,$result
}

$drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-representation-correspondence')
$drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
    'OUTLINE',
    [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'white', 7, $null, $null, $null),
    'Continuous', 25, $false, $false)) | Out-Null
$root = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
    'ROOT', '*MODEL_SPACE', 'model_space', $true, $false, $false)
$roles = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)

function Add-Path([string]$Handle, [object[]]$Points, [bool]$Closed) {
    $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
        $Handle, 'AcDbPolyline', 'Polyline', 'path', 'OUTLINE', $true)
    $entity.SetPath((New-PointList $Points), $Closed, 'exact_linear_polyline') | Out-Null
    $root.AddEntity($entity) | Out-Null
    $roles[$Handle] = 'visible_contour'
}

# Region A and B are side-by-side and share Y stations 0, 3, 6.
Add-Path 'A_BOX' @(@(0,0), @(10,0), @(10,6), @(0,6)) $true
Add-Path 'A_MID' @(@(0,3), @(10,3)) $false
Add-Path 'B_BOX' @(@(20,0), @(26,0), @(26,6), @(20,6)) $true
Add-Path 'B_MID' @(@(20,3), @(26,3)) $false

# Region C is A rotated 90 degrees and translated. It has the same invariant
# topology signature, but is deliberately not in a projection-aligned row/column.
Add-Path 'C_BOX' @(@(34,20), @(40,20), @(40,30), @(34,30)) $true
Add-Path 'C_MID' @(@(37,20), @(37,30)) $false

$drawing.AddDefinition($root) | Out-Null
$instances = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing, $roles)
$topologyConfig = [Shb.Cad.Core.PlanarTopologyConfig]::new()
$topologyConfig.SnapTolerance = 0.001
$topologyConfig.GridSize = 0.0001
$topology = [Shb.Cad.Core.PlanarTopologyAnalyzer]::Analyze($instances, $topologyConfig)
$regionConfig = [Shb.Cad.Core.EngineeringViewRegionConfig]::new()
$regionConfig.ExplicitClusterGap = 0.25
$frame = [Shb.Cad.Core.ViewRegionFrameObservation]::new(
    'FRAME', -2, -2, 45, 35, [string[]]@())
$regions = [Shb.Cad.Core.EngineeringViewRegionAnalyzer]::Analyze(
    $instances, $topology, $frame, $null, $null, $regionConfig)
$result = [Shb.Cad.Core.RepresentationCorrespondenceAnalyzer]::Analyze($regions, $topology)

Assert-Equal 'computed' $result.Status 'complete topology evidence produces computed document'
Assert-Equal 3 $result.InputRegionCount 'three engineering regions analyzed'
Assert-Equal 3 $result.EvaluatedPairCount 'all region pairs evaluated'
Assert-Equal 3 $result.RegionSignatures.Count 'one invariant signature record per region'
Assert-Equal 1 $result.RepeatedFamilies.Count 'rotated A/C form one exact repeated family'

$regionA = $regions.Regions | Where-Object { [Math]::Abs($_.MinX - 0) -lt 0.001 } | Select-Object -First 1
$regionB = $regions.Regions | Where-Object { [Math]::Abs($_.MinX - 20) -lt 0.001 } | Select-Object -First 1
$regionC = $regions.Regions | Where-Object { [Math]::Abs($_.MinX - 34) -lt 0.001 } | Select-Object -First 1
Assert-True ($null -ne $regionA -and $null -ne $regionB -and $null -ne $regionC) `
    'synthetic region identities resolved by their evidence bounds'

$signatureA = $result.RegionSignatures | Where-Object RegionId -eq $regionA.Id | Select-Object -First 1
$signatureC = $result.RegionSignatures | Where-Object RegionId -eq $regionC.Id | Select-Object -First 1
Assert-Equal $signatureA.SignatureId $signatureC.SignatureId `
    'invariant signature survives translation and 90-degree rotation'

$repeated = @($result.Relations | Where-Object {
    $_.Kind -eq 'repeated_geometry_candidate' -and
    (($_.LeftRegionId -eq $regionA.Id -and $_.RightRegionId -eq $regionC.Id) -or
     ($_.LeftRegionId -eq $regionC.Id -and $_.RightRegionId -eq $regionA.Id))
})
Assert-Equal 1 $repeated.Count 'A/C exact repeated-geometry relation retained'
Assert-Equal 'same_type_candidate_only' $repeated[0].IdentityInference `
    'repeat evidence stops at same-type candidate'
Assert-Equal 'not_supported_by_geometry_repetition' $repeated[0].SameObjectInference `
    'repeat evidence never asserts same object'

$projection = @($result.Relations | Where-Object {
    $_.Kind -eq 'orthographic_projection_candidate' -and
    (($_.LeftRegionId -eq $regionA.Id -and $_.RightRegionId -eq $regionB.Id) -or
     ($_.LeftRegionId -eq $regionB.Id -and $_.RightRegionId -eq $regionA.Id))
})
Assert-Equal 1 $projection.Count 'A/B projection relation retained'
Assert-Equal 'supported_geometry_relation' $projection[0].Status 'A/B strong station alignment'
Assert-Equal 'horizontal' $projection[0].LayoutAxis 'side-by-side layout'
Assert-Equal 'world_y' $projection[0].SharedProjectionAxis 'side-by-side views share Y stations'
Assert-Equal 3 $projection[0].MatchedStationCount 'Y stations 0, 3, 6 match'
Assert-Near 1 $projection[0].LeftCoverage 0.000001 'all A Y feature stations matched'
Assert-Near 1 $projection[0].RightCoverage 0.000001 'all B Y feature stations matched'
Assert-Equal 'same_object_possible' $projection[0].IdentityInference `
    'strong projection is possibility, not object identity proof'
Assert-Equal 'possible_not_proven' $projection[0].SameObjectInference `
    'same-object boundary is explicit'

Assert-Equal 0 @($result.Relations | Where-Object {
    $_.SameObjectInference -eq 'same_object_supported' -or
    $_.IdentityInference -eq 'same_object_supported'
}).Count 'no geometry-only path emits supported same-object identity'
Assert-Equal 0 @($result.Relations | Where-Object {
    $_.Kind -eq 'orthographic_projection_candidate' -and
    ($_.LeftRegionId -eq $regionC.Id -or $_.RightRegionId -eq $regionC.Id)
}).Count 'spatially offset repeated geometry is not a projection candidate'
Assert-Equal 'read_only_no_entities_modified' $result.ToMap()['mutation_status'] 'read-only contract'

# Optional regression over saved-fact replay artifacts.
$outRoot = Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad-11-12'
$regressionFiles = @()
if (Test-Path $outRoot) {
    $regressionFiles = @(Get-ChildItem $outRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'representation-correspondence-replay.json' } |
        Where-Object { Test-Path $_ })
}
foreach ($file in $regressionFiles) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    $signatureCount = @($json.region_signatures).Count
    Assert-Equal (($signatureCount * ($signatureCount - 1)) / 2) $json.evaluated_pair_count `
        "all view pairs evaluated below budget: $file"
    Assert-Equal 0 @($json.relations | Where-Object {
        $_.same_object_inference -eq 'same_object_supported' -or
        $_.identity_inference -eq 'same_object_supported'
    }).Count "geometry-only identity guard: $file"
    foreach ($relation in @($json.relations | Where-Object {
        $_.relation_kind -eq 'orthographic_projection_candidate' -and
        $_.status -eq 'supported_geometry_relation'
    })) {
        Assert-True ($relation.matched_station_count -ge 3) "supported relation station count: $file"
        Assert-True ($relation.left_station_coverage -ge 0.6) "supported left coverage: $file"
        Assert-True ($relation.right_station_coverage -ge 0.6) "supported right coverage: $file"
        Assert-Equal 'possible_not_proven' $relation.same_object_inference `
            "supported projection still does not prove identity: $file"
    }
    Assert-Equal 'read_only_no_entities_modified' $json.mutation_status "read-only replay: $file"
}

Write-Host "PASS 14 representation-correspondence; optional saved-fact regressions=$($regressionFiles.Count)"
