$ErrorActionPreference = 'Stop'

$files = @(
    (Join-Path $PSScriptRoot '../09-dimension-topology/DimensionTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../12-planar-topology-kernel/PlanarTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../14-representation-correspondence/RepresentationCorrespondenceAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../15-representation-identity-resolution/RepresentationIdentityResolver.cs'),
    (Join-Path $PSScriptRoot '../16-manufacturing-profile-features/ManufacturingProfileAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../17-mechanical-interface-adjacency/MechanicalInterfaceAdjacencyAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'DimensionGeometryBindingAnalyzer.cs')
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
        throw "ASSERT NEAR failed: $Message; expected=[$Expected], actual=[$Actual], tolerance=[$Tolerance]"
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

$drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-dimension-geometry-binding')
$drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
    'OUTLINE',
    [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'white', 7, $null, $null, $null),
    'Continuous', 25, $false, $false)) | Out-Null
$drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
    'DIM',
    [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'cyan', 4, $null, $null, $null),
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

$dimensionObservations = [System.Collections.Generic.List[Shb.Cad.Core.DimensionTopologyObservation]]::new()
function Add-Dimension(
    [string]$Handle,
    [double]$X1,
    [double]$Y1,
    [double]$X2,
    [double]$Y2,
    [double]$Measurement,
    [string]$Text,
    [bool]$Placed = $true,
    [double]$LinearFactor = [double]::NaN) {
    $observation = [Shb.Cad.Core.DimensionTopologyObservation]::new(
        $Handle, 'AcDbRotatedDimension', 'RotatedDimension', 'DIM', 'model_space', '*MODEL_SPACE')
    $observation.SetMeasurement($Measurement, $Text, 'TEST_DIM') | Out-Null
    if (-not [double]::IsNaN($LinearFactor)) {
        $observation.SetLinearMeasurementFactor($LinearFactor) | Out-Null
    }
    $observation.SetAxisAngle(0.0) | Out-Null
    $observation.SetXLine1Point($X1, $Y1) | Out-Null
    $observation.SetXLine2Point($X2, $Y2) | Out-Null
    $observation.SetDimensionLinePoint($X2, ([Math]::Min($Y1, $Y2) - 10)) | Out-Null
    $dimensionObservations.Add($observation)
    if ($Placed) {
        $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
            $Handle, 'AcDbRotatedDimension', 'RotatedDimension', 'dimension', 'DIM', $true)
        $root.AddEntity($entity) | Out-Null
        $roles[$Handle] = 'annotation_dimension'
    }
}

# A real 100 x 50 profile, two close parallel edges for a deliberate equal-distance
# endpoint ambiguity, and dimensions covering exact, overridden, reference, unbound,
# ambiguous, and unplaced cases.
Add-Path 'OUTER' @(@(0,0), @(100,0), @(100,50), @(0,50)) $true
Add-Path 'NEAR_LEFT' @(@(40,10), @(40,20)) $false
Add-Path 'NEAR_RIGHT' @(@(40.04,10), @(40.04,20)) $false
Add-Dimension 'D_EXACT' 0 0 100 0 100 ''
Add-Dimension 'D_OVERRIDE' 0 0 100 0 100 '{99}{}{}{}'
Add-Dimension 'D_REFERENCE' 0 50 100 50 100 '{(<>)}{}{}{}'
Add-Dimension 'D_UNBOUND' -10 -10 -5 -10 5 ''
Add-Dimension 'D_AMBIGUOUS' 40.02 15 100 15 59.98 ''
Add-Dimension 'D_UNPLACED' 0 0 100 0 100 '' $false
Add-Dimension 'D_SCALE_1' 0 0 100 0 100 '{50}{}{}{}'
Add-Dimension 'D_SCALE_2' 0 0 100 0 100 '{50}{}{}{}'
Add-Dimension 'D_SCALE_3' 0 0 100 0 100 '{50}{}{}{}'
Add-Dimension 'D_DIMLFAC' 0 0 100 0 100 '' $true 0.5

$drawing.AddDefinition($root) | Out-Null
$instances = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing, $roles)
$topologyConfig = [Shb.Cad.Core.PlanarTopologyConfig]::new()
$topologyConfig.SnapTolerance = 0.0001
$topologyConfig.GridSize = 0.00001
$topology = [Shb.Cad.Core.PlanarTopologyAnalyzer]::Analyze($instances, $topologyConfig)
$regionConfig = [Shb.Cad.Core.EngineeringViewRegionConfig]::new()
$regionConfig.ExplicitClusterGap = 1.0
$frame = [Shb.Cad.Core.ViewRegionFrameObservation]::new(
    'FRAME', -20, -20, 120, 70, [string[]]@())
$regions = [Shb.Cad.Core.EngineeringViewRegionAnalyzer]::Analyze(
    $instances, $topology, $frame, $null, $null, $regionConfig)
$correspondence = [Shb.Cad.Core.RepresentationCorrespondenceAnalyzer]::Analyze($regions, $topology)
$identity = [Shb.Cad.Core.RepresentationIdentityResolver]::Analyze($regions, $correspondence)
$manufacturing = [Shb.Cad.Core.ManufacturingProfileAnalyzer]::Analyze($regions, $topology, $identity)
$interfaces = [Shb.Cad.Core.MechanicalInterfaceAdjacencyAnalyzer]::Analyze(
    $regions, $topology, $identity, $manufacturing)
$dimensions = [Shb.Cad.Core.DimensionTopologyAnalyzer]::Analyze(
    $drawing.DrawingId,
    $dimensionObservations,
    [System.Collections.Generic.List[Shb.Cad.Core.DimensionReferenceAxisObservation]]::new())
$config = [Shb.Cad.Core.DimensionGeometryBindingConfig]::new()
$config.EndpointToleranceRatio = 0.001
$config.CandidateTieToleranceRatio = 0.01
$result = [Shb.Cad.Core.DimensionGeometryBindingAnalyzer]::Analyze(
    $dimensions, $instances, $regions, $topology, $manufacturing, $interfaces, $config)

Assert-Equal 10 $result.InputDimensionCount 'all 09 dimension definitions retained'
Assert-Equal 9 $result.InputPlacementCount 'nine visible model-space occurrences are expanded'
Assert-Equal 1 $result.UnplacedSourceDimensionHandles.Count 'unused source definition is explicit'
Assert-True ($result.UniqueBindingCount -ge 3) 'exact, override, and reference spans bind uniquely'
Assert-Equal 1 @($result.Bindings | Where-Object DimensionHandle -eq 'D_UNBOUND' |
    Where-Object Status -eq 'unbound').Count 'far definition points remain unbound'
Assert-Equal 1 @($result.Bindings | Where-Object DimensionHandle -eq 'D_AMBIGUOUS' |
    Where-Object Status -eq 'bound_ambiguous').Count 'equal-distance geometry is not chosen arbitrarily'
Assert-Equal 1 @($result.Bindings | Where-Object DimensionHandle -eq 'D_UNPLACED' |
    Where-Object Status -eq 'unplaced_source_definition').Count 'uninstantiated block definition is not treated as drawing geometry'

$exact = @($result.Bindings | Where-Object DimensionHandle -eq 'D_EXACT')[0]
Assert-Equal 'bound_unique' $exact.Status 'exact profile width has two unique anchors'
Assert-Near 100 ([double]$exact.Comparison.SourceUnitGeometrySpanMinimum) 0.0001 'snapped geometry width'
Assert-Equal 'within_configured_numeric_tolerance' `
    $exact.Comparison.PrimaryComparisonStatus 'matching value remains a numeric screening pass'
Assert-Equal 'intra_profile_span_candidate' $exact.LinkKind 'both anchors trace to one profile candidate'

$override = @($result.Bindings | Where-Object DimensionHandle -eq 'D_OVERRIDE')[0]
Assert-Equal 'numeric_text_override' $override.Comparison.DisplayOverrideStatus 'formatted numeric override parsed'
Assert-Near 99 ([double]$override.Comparison.EffectiveDisplayedValue) 0.0001 'displayed override preserved separately'
Assert-Equal 'within_configured_numeric_tolerance' `
    $override.Comparison.EntityMeasurementComparisonStatus 'entity measurement still matches structural geometry'
Assert-Equal 'outside_configured_numeric_tolerance_candidate' `
    $override.Comparison.DisplayedValueComparisonStatus 'displayed 99 versus structural 100 is a review candidate'

$reference = @($result.Bindings | Where-Object DimensionHandle -eq 'D_REFERENCE')[0]
Assert-True $reference.IsReferenceDimensionCandidate 'parenthesized measurement remains reference candidate'
Assert-Equal 'measurement_placeholder' $reference.Comparison.DisplayOverrideStatus `
    'placeholder uses entity measurement without inventing an override'

$hypothesis = @($result.DisplayScaleHypotheses)[0]
Assert-Equal 1 $result.DisplayScaleHypotheses.Count 'one repeated non-unit display scale is inferred'
Assert-Near 2 ([double]$hypothesis.GeometryToDisplayScale) 0.0001 `
    'three independent overrides support geometry/display ratio two'
Assert-Equal 3 $hypothesis.SupportCount 'scale hypothesis support is explicit'
Assert-True ($result.ScaleExplainedOutsideCandidateCount -ge 3) `
    'raw display residuals are retained but explained by a repeated scale candidate'
foreach ($binding in @($result.Bindings | Where-Object DimensionHandle -like 'D_SCALE_*')) {
    Assert-Equal $hypothesis.Id $binding.DisplayScaleHypothesisId `
        'scale evidence is attached to each supporting dimension'
    Assert-Equal 'within_inferred_scale_numeric_tolerance_candidate' `
        $binding.ScaleNormalizedComparisonStatus `
        'scale-normalized comparison is a candidate, not a defect assertion'
}

$factor = @($result.Bindings | Where-Object DimensionHandle -eq 'D_DIMLFAC')[0]
Assert-True $factor.HasAuthoredLinearMeasurementFactor 'authored DIMLFAC survives 09 into 18'
Assert-Near 0.5 ([double]$factor.AuthoredLinearMeasurementFactor) 0.0000001 `
    'authored linear measurement factor is preserved'
Assert-Near 50 ([double]$factor.Comparison.EffectiveDisplayedValue) 0.0001 `
    'implicit displayed value applies DIMLFAC'
Assert-Equal 'source_dimension_unit_geometry_times_authored_dimlfac' `
    $factor.Comparison.DisplayGeometryComparisonBasis `
    'display comparison scales structural geometry by authored DIMLFAC'
Assert-Equal 'within_configured_numeric_tolerance' `
    $factor.Comparison.DisplayedValueComparisonStatus `
    'intentional DIMLFAC does not become an outside-tolerance candidate'

$edge = @($dimensions.Edges | Where-Object Handle -eq 'D_EXACT')[0]
$scaled = [Shb.Cad.Core.DimensionGeometryBindingAnalyzer]::CreatePlacement(
    $edge,
    'scaled-occurrence',
    'DEF',
    'SCALED',
    [string[]]@('root:ROOT','ref:SCALE'),
    [Shb.Cad.Core.InstanceAffineTransformObservation]::new(
        2,0,0,10,
        0,2,0,20,
        0,0,1,0),
    $true,
    'computed')
Assert-Near 2 $scaled.AxisScale 0.0000001 'dimension axis scale comes from the instance transform'
Assert-Near 10 $scaled.XLine1X 0.0000001 'first definition point is expanded into world coordinates'
Assert-Near 210 $scaled.XLine2X 0.0000001 'second definition point is expanded into world coordinates'

$map = $result.ToMap()
Assert-Equal 'read_only_no_entities_modified' $map['mutation_status'] 'source drawing stays unchanged'
Assert-Equal 'proximity_to_12_topology_not_native_dimension_associativity_proof' `
    $map['semantic_contract']['attachment'] 'proximity is not promoted to native associativity'
Assert-Equal 'configured_screening_candidate_not_acceptance_or_defect_proof' `
    $map['semantic_contract']['numeric_residual'] 'residual is not promoted to defect proof'

$limitedConfig = [Shb.Cad.Core.DimensionGeometryBindingConfig]::new()
$limitedConfig.MaximumPlacementCount = 1
$limited = [Shb.Cad.Core.DimensionGeometryBindingAnalyzer]::Analyze(
    $dimensions, $instances, $regions, $topology, $manufacturing, $interfaces, $limitedConfig)
Assert-Equal 'unsupported_partial' $limited.Status 'placement budget truncation propagates status'
Assert-Equal 1 $limited.ProcessedPlacementCount 'placement limit is deterministic'
Assert-Equal 1 @($limited.Diagnostics | Where-Object Code -eq 'DIMENSION_PLACEMENT_LIMIT_REACHED').Count `
    'placement limit diagnostic is explicit'

# Optional validation over saved-fact replay artifacts.
$outRoot = Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad-11-12'
$regressionFiles = @()
if (Test-Path $outRoot) {
    $regressionFiles = @(Get-ChildItem $outRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'dimension-geometry-binding-replay.json' } |
        Where-Object { Test-Path $_ })
}
foreach ($file in $regressionFiles) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    Assert-Equal $json.input_dimension_count `
        ($json.unplaced_source_dimension_count +
            @($json.bindings | Where-Object status -ne 'unplaced_source_definition' |
                Select-Object -ExpandProperty dimension_handle -Unique).Count) `
        "placed/unplaced dimension source accounting: $file"
    Assert-Equal 'read_only_no_entities_modified' $json.mutation_status "read-only replay: $file"
    Assert-Equal 'proximity_to_12_topology_not_native_dimension_associativity_proof' `
        $json.semantic_contract.attachment "no associativity overclaim: $file"
    Assert-Equal 'configured_screening_candidate_not_acceptance_or_defect_proof' `
        $json.semantic_contract.numeric_residual "no defect overclaim: $file"
}

Write-Host "PASS 18 dimension-geometry-binding; optional saved-fact regressions=$($regressionFiles.Count)"
