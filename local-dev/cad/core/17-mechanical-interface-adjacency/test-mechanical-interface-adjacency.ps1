$ErrorActionPreference = 'Stop'

$files = @(
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../12-planar-topology-kernel/PlanarTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../14-representation-correspondence/RepresentationCorrespondenceAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../15-representation-identity-resolution/RepresentationIdentityResolver.cs'),
    (Join-Path $PSScriptRoot '../16-manufacturing-profile-features/ManufacturingProfileAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'MechanicalInterfaceAdjacencyAnalyzer.cs')
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

function New-CircleCoordinates([double]$CenterX, [double]$CenterY, [double]$Radius, [int]$Count = 48) {
    $result = @()
    for ($index = 0; $index -lt $Count; $index++) {
        $angle = 2 * [Math]::PI * $index / $Count
        $x = $CenterX + $Radius * [Math]::Cos($angle)
        $y = $CenterY + $Radius * [Math]::Sin($angle)
        $result += ,@($x, $y)
    }
    return ,$result
}

$drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-mechanical-interface-adjacency')
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

# One projected assembly view:
# - a duplicate divider creates multi-source coincident shared-boundary evidence;
# - two nested concentric circles create a 2D coaxial stack candidate;
# - two equal circles create a repeated interface pattern candidate;
# - one open line endpoint stops 0.02 from the enclosing profile boundary.
# None of these facts is allowed to become a proven fit, fastener, contact, or defect.
Add-Path 'OUTER' @(@(0,0), @(40,0), @(40,30), @(0,30)) $true
Add-Path 'DIVIDE' @(@(20,0), @(20,30)) $false
Add-Path 'DIVIDE_DUPLICATE' @(@(20,0), @(20,30)) $false
Add-Path 'CONCENTRIC_OUTER' (New-CircleCoordinates 10 15 4) $true 'adaptive_circle_tessellation'
Add-Path 'CONCENTRIC_INNER' (New-CircleCoordinates 10 15 2) $true 'adaptive_circle_tessellation'
Add-Path 'REPEAT_1' (New-CircleCoordinates 27 10 1.5) $true 'adaptive_circle_tessellation'
Add-Path 'REPEAT_2' (New-CircleCoordinates 33 10 1.5) $true 'adaptive_circle_tessellation'
Add-Path 'OPEN_NEAR_BOUNDARY' @(@(0.02,5), @(5,5)) $false

$drawing.AddDefinition($root) | Out-Null
$instances = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing, $roles)
$topologyConfig = [Shb.Cad.Core.PlanarTopologyConfig]::new()
$topologyConfig.SnapTolerance = 0.001
$topologyConfig.GridSize = 0.0001
$topology = [Shb.Cad.Core.PlanarTopologyAnalyzer]::Analyze($instances, $topologyConfig)
$regionConfig = [Shb.Cad.Core.EngineeringViewRegionConfig]::new()
$regionConfig.ExplicitClusterGap = 0.25
$frame = [Shb.Cad.Core.ViewRegionFrameObservation]::new(
    'FRAME', -20, -20, 80, 80, [string[]]@())
$regions = [Shb.Cad.Core.EngineeringViewRegionAnalyzer]::Analyze(
    $instances, $topology, $frame, $null, $null, $regionConfig)
$correspondence = [Shb.Cad.Core.RepresentationCorrespondenceAnalyzer]::Analyze($regions, $topology)
$identity = [Shb.Cad.Core.RepresentationIdentityResolver]::Analyze($regions, $correspondence)
$manufacturing = [Shb.Cad.Core.ManufacturingProfileAnalyzer]::Analyze($regions, $topology, $identity)
$config = [Shb.Cad.Core.MechanicalInterfaceAdjacencyConfig]::new()
$config.TerminalBoundaryToleranceRatio = 0.001
$result = [Shb.Cad.Core.MechanicalInterfaceAdjacencyAnalyzer]::Analyze(
    $regions, $topology, $identity, $manufacturing, $config)

Assert-Equal 1 $regions.EngineeringViewCandidateCount 'all projected evidence stays in one engineering view'
Assert-Equal $manufacturing.VoidBoundaries.Count $result.Features.Count 'every retained nested boundary becomes one interface feature candidate'
Assert-True ($result.Features.Count -ge 4) 'concentric and repeated circular features retained'
Assert-True ($result.CircularFeatureCount -ge 4) 'all four circles remain circular feature candidates'
Assert-Equal 1 $result.CoaxialPatternCount 'direct nested concentric pair forms one projected coaxial stack'
Assert-Equal 1 $result.RepeatedPatternCount 'equal sibling circles retain one repeat pattern'
Assert-True ($result.CoincidentBoundaryCount -ge 1) 'duplicate divider strengthens one shared boundary with multi-source evidence'
Assert-True ($result.TerminalApproachCount -ge 1) 'nearby open endpoint retains measured profile-boundary gap'
Assert-Equal 1 $result.ObjectSummaries.Count 'one identity cluster receives one non-fused interface summary'
Assert-True ($result.ObjectSummaries[0].FeatureIds.Count -ge 4) 'object summary indexes view-scoped features'

$map = $result.ToMap()
Assert-Equal 'read_only_no_entities_modified' $map['mutation_status'] 'source drawing stays unchanged'
Assert-Equal 'candidate_not_hole_port_or_mating_feature_proof' `
    $map['semantic_contract']['nested_feature'] 'nested circle is not called a proven hole or port'
Assert-Equal '2d_concentric_geometry_not_3d_axis_fit_or_tolerance_proof' `
    $map['semantic_contract']['coaxial_pattern'] '2D concentricity does not prove a 3D fit'
Assert-Equal 'dcel_face_adjacency_not_physical_contact_proof' `
    $map['semantic_contract']['shared_boundary'] 'DCEL adjacency is not physical contact'
Assert-Equal 'near_endpoint_not_connection_gap_or_defect_proof' `
    $map['semantic_contract']['terminal_approach'] 'near endpoint is neither connection nor defect proof'

$limitedConfig = [Shb.Cad.Core.MechanicalInterfaceAdjacencyConfig]::new()
$limitedConfig.MaximumFeatureCount = 2
$limited = [Shb.Cad.Core.MechanicalInterfaceAdjacencyAnalyzer]::Analyze(
    $regions, $topology, $identity, $manufacturing, $limitedConfig)
Assert-Equal 'unsupported_partial' $limited.Status 'feature budget truncation propagates status'
Assert-Equal 2 $limited.Features.Count 'feature limit is enforced'
Assert-Equal 1 @($limited.Diagnostics | Where-Object Code -eq 'INTERFACE_FEATURE_LIMIT_REACHED').Count `
    'feature limit diagnostic is explicit'

# Optional validation over saved-fact replay artifacts.
$outRoot = Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad-11-12'
$regressionFiles = @()
if (Test-Path $outRoot) {
    $regressionFiles = @(Get-ChildItem $outRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'mechanical-interface-adjacency-replay.json' } |
        Where-Object { Test-Path $_ })
}
foreach ($file in $regressionFiles) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    Assert-Equal $json.input_feature_candidate_count `
        ($json.interface_feature_candidate_count + $json.unresolved_feature_candidate_count) `
        "interface feature accounting: $file"
    Assert-Equal 'read_only_no_entities_modified' $json.mutation_status "read-only replay: $file"
    Assert-Equal 'candidate_not_hole_port_or_mating_feature_proof' `
        $json.semantic_contract.nested_feature "no hole/port overclaim: $file"
    Assert-Equal 'dcel_face_adjacency_not_physical_contact_proof' `
        $json.semantic_contract.shared_boundary "no physical-contact overclaim: $file"
}

Write-Host "PASS 17 mechanical-interface-adjacency; optional saved-fact regressions=$($regressionFiles.Count)"
