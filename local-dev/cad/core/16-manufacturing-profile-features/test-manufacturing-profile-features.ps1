$ErrorActionPreference = 'Stop'

$files = @(
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../12-planar-topology-kernel/PlanarTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../14-representation-correspondence/RepresentationCorrespondenceAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../15-representation-identity-resolution/RepresentationIdentityResolver.cs'),
    (Join-Path $PSScriptRoot 'ManufacturingProfileAnalyzer.cs')
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

function New-PointList([object[]]$Coordinates) {
    $result = [System.Collections.Generic.List[Shb.Cad.Core.InstancePoint3Observation]]::new()
    foreach ($coordinate in $Coordinates) {
        $result.Add([Shb.Cad.Core.InstancePoint3Observation]::new(
            [double]$coordinate[0], [double]$coordinate[1], 0))
    }
    return ,$result
}

function New-CircleCoordinates([double]$CenterX, [double]$CenterY, [double]$Radius, [int]$Count) {
    $result = @()
    for ($index = 0; $index -lt $Count; $index++) {
        $angle = 2 * [Math]::PI * $index / $Count
        $x = $CenterX + $Radius * [Math]::Cos($angle)
        $y = $CenterY + $Radius * [Math]::Sin($angle)
        $result += ,@($x, $y)
    }
    return ,$result
}

$drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-manufacturing-profiles')
$drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
    'OUTLINE',
    [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'white', 7, $null, $null, $null),
    'Continuous', 25, $false, $false)) | Out-Null
$root = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
    'ROOT', '*MODEL_SPACE', 'model_space', $true, $false, $false)
$roles = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)

function Add-Path([string]$Handle, [object[]]$Points, [bool]$Closed, [string]$Quality = 'exact_linear_polyline') {
    $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
        $Handle, 'AcDbPolyline', 'Polyline', 'path', 'OUTLINE', $true)
    $entity.SetPath((New-PointList $Points), $Closed, $Quality) | Out-Null
    $root.AddEntity($entity) | Out-Null
    $roles[$Handle] = 'visible_contour'
}

# One view: outer enclosure, two equal circular inner loops, one densely sampled
# circle, two rectangular inner loops and a disconnected open U chain. Geometry alone must not rename
# the inner loops to holes or the outer loop to a manufactured material edge.
Add-Path 'OUTER' @(@(0,0), @(30,0), @(30,20), @(0,20)) $true
Add-Path 'CIRCLE_1' (New-CircleCoordinates 8 10 2 24) $true 'adaptive_circle_tessellation'
Add-Path 'CIRCLE_2' (New-CircleCoordinates 14 10 2 24) $true 'adaptive_circle_tessellation'
Add-Path 'CIRCLE_DENSE' (New-CircleCoordinates 5 4 1 144) $true 'adaptive_circle_tessellation'
Add-Path 'RECT_INNER' @(@(20,8), @(26,8), @(26,12), @(20,12)) $true
Add-Path 'RECT_ROTATED' @(
    @(21.9019238,1.6339746), @(27.0980762,4.6339746),
    @(26.0980762,6.3660254), @(20.9019238,3.3660254)) $true
Add-Path 'OPEN_U' @(@(2,3), @(2,6), @(4,6)) $false

$drawing.AddDefinition($root) | Out-Null
$instances = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing, $roles)
$topologyConfig = [Shb.Cad.Core.PlanarTopologyConfig]::new()
$topologyConfig.SnapTolerance = 0.001
$topologyConfig.GridSize = 0.0001
$topology = [Shb.Cad.Core.PlanarTopologyAnalyzer]::Analyze($instances, $topologyConfig)
$regionConfig = [Shb.Cad.Core.EngineeringViewRegionConfig]::new()
$regionConfig.ExplicitClusterGap = 0.25
$frame = [Shb.Cad.Core.ViewRegionFrameObservation]::new(
    'FRAME', -2, -2, 32, 22, [string[]]@())
$regions = [Shb.Cad.Core.EngineeringViewRegionAnalyzer]::Analyze(
    $instances, $topology, $frame, $null, $null, $regionConfig)
$correspondence = [Shb.Cad.Core.RepresentationCorrespondenceAnalyzer]::Analyze(
    $regions, $topology)
$identity = [Shb.Cad.Core.RepresentationIdentityResolver]::Analyze(
    $regions, $correspondence)
$result = [Shb.Cad.Core.ManufacturingProfileAnalyzer]::Analyze(
    $regions, $topology, $identity)

Assert-Equal 1 $regions.EngineeringViewCandidateCount 'one engineering view contains all nested components'
Assert-Equal 1 $identity.PhysicalObjectClusters.Count 'one conservative object summary target'
Assert-True ($result.Profiles.Count -ge 6) 'outer and five nested closed profiles retained'
Assert-Equal 5 $result.VoidBoundaries.Count 'DCEL hierarchy exposes five nested boundaries'
Assert-Equal 3 $result.CircularVoidBoundaryCount 'sparse and dense circular boundaries are sampling-invariant'
Assert-True (@($result.VoidBoundaries | Where-Object ShapeClass -eq 'rectangular_closed_profile').Count -ge 2) `
    'axis-aligned and rotated rectangles remain rectangular shape candidates'
Assert-True (@($result.Profiles | Where-Object { $_.ParentProfileIds.Count -gt 0 }).Count -ge 5) `
    'inner profile records link back to their enclosing profile'
Assert-True (@($result.Adjacencies | Where-Object RelationType -eq 'contains_nested_boundary').Count -ge 5) `
    'nested topology becomes explicit profile adjacency'
Assert-Equal 1 $result.RepeatedFeatureGroups.Count 'equal circles form one repeated geometry group'
$repeat = $result.RepeatedFeatureGroups[0]
Assert-Equal 2 $repeat.FeatureIds.Count 'repeated group contains both circular boundaries'
Assert-True ($repeat.Alignment -eq 'local_x_row' -or $repeat.Alignment -eq 'local_y_column' -or `
    $repeat.Alignment -eq 'pair_spacing_only') `
    'equal circle pair retains an axis row or conservative pair-spacing fact'
Assert-Equal 1 $repeat.ConsecutiveSpacings.Count 'two aligned circles produce one spacing fact'
Assert-True ($result.OpenBoundaries.Count -ge 1) 'disconnected open U chain remains visible'
Assert-True (@($result.OpenBoundaries | Where-Object Kind -eq 'open_chain_candidate').Count -ge 1) `
    'two-endpoint non-branch component is an open-chain candidate'
Assert-Equal 1 $result.ObjectSummaries.Count 'identity cluster receives one non-fused feature summary'
Assert-True ($result.ObjectSummaries[0].ProfileIds.Count -ge 6) 'object summary links view-scoped profiles'
Assert-Equal 'read_only_no_entities_modified' $result.ToMap()['mutation_status'] 'read-only contract'
Assert-Equal 'profile_candidate_not_manufactured_material_proof' `
    $result.ToMap()['semantic_contract']['bounded_dcel_face'] `
    'bounded face does not become manufactured material truth'
Assert-Equal 'void_or_nested_part_candidate_not_through_hole_proof' `
    $result.ToMap()['semantic_contract']['nested_boundary'] `
    'circular nested boundary is not called a proven through hole'

# Budget truncation is explicit and cannot support a clean review conclusion.
$limitedConfig = [Shb.Cad.Core.ManufacturingProfileConfig]::new()
$limitedConfig.MaximumFaceCandidateCount = 2
$limited = [Shb.Cad.Core.ManufacturingProfileAnalyzer]::Analyze(
    $regions, $topology, $identity, $limitedConfig)
Assert-Equal 'unsupported_partial' $limited.Status 'face budget truncation changes document status'
Assert-Equal 2 $limited.Profiles.Count 'face limit is enforced'
Assert-Equal 1 @($limited.Diagnostics | Where-Object Code -eq 'FACE_CANDIDATE_LIMIT_REACHED').Count `
    'face limit diagnostic is explicit'

# Optional regression over saved-fact replay artifacts.
$outRoot = Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad-11-12'
$regressionFiles = @()
if (Test-Path $outRoot) {
    $regressionFiles = @(Get-ChildItem $outRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'manufacturing-profile-features-replay.json' } |
        Where-Object { Test-Path $_ })
}
foreach ($file in $regressionFiles) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    Assert-True ($json.assigned_profile_count -le $json.input_face_count) "assigned faces bounded by input: $file"
    Assert-Equal $json.input_face_count ($json.assigned_profile_count + $json.unassigned_face_count) `
        "assigned/unassigned face accounting: $file"
    Assert-Equal 'read_only_no_entities_modified' $json.mutation_status "read-only replay: $file"
    Assert-Equal 'profile_candidate_not_manufactured_material_proof' `
        $json.semantic_contract.bounded_dcel_face "no material overclaim: $file"
    Assert-Equal 'void_or_nested_part_candidate_not_through_hole_proof' `
        $json.semantic_contract.nested_boundary "no hole overclaim: $file"
}

Write-Host "PASS 16 manufacturing-profile-features; optional saved-fact regressions=$($regressionFiles.Count)"
