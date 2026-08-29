$ErrorActionPreference = 'Stop'

$files = @(
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../12-planar-topology-kernel/PlanarTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../14-representation-correspondence/RepresentationCorrespondenceAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'RepresentationIdentityResolver.cs')
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

$drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-representation-identity')
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

# A/B are projection-aligned; A/C are the same normalized topology after rotation.
Add-Path 'A_BOX' @(@(0,0), @(10,0), @(10,6), @(0,6)) $true
Add-Path 'A_MID' @(@(0,3), @(10,3)) $false
Add-Path 'B_BOX' @(@(20,0), @(26,0), @(26,6), @(20,6)) $true
Add-Path 'B_MID' @(@(20,3), @(26,3)) $false
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
$correspondence = [Shb.Cad.Core.RepresentationCorrespondenceAnalyzer]::Analyze(
    $regions, $topology)

$regionA = $regions.Regions | Where-Object { [Math]::Abs($_.MinX - 0) -lt 0.001 } | Select-Object -First 1
$regionB = $regions.Regions | Where-Object { [Math]::Abs($_.MinX - 20) -lt 0.001 } | Select-Object -First 1
$regionC = $regions.Regions | Where-Object { [Math]::Abs($_.MinX - 34) -lt 0.001 } | Select-Object -First 1
Assert-True ($null -ne $regionA -and $null -ne $regionB -and $null -ne $regionC) `
    'synthetic engineering representations resolved'

# 14 alone can form possible/type groups, but never a resolved multi-representation object.
$baseline = [Shb.Cad.Core.RepresentationIdentityResolver]::Analyze(
    $regions, $correspondence)
Assert-Equal 'computed' $baseline.Status 'geometry-only identity skeleton is computed'
Assert-Equal 3 $baseline.Representations.Count 'one representation per engineering region'
Assert-Equal 3 $baseline.PhysicalObjectClusters.Count 'geometry-only path keeps three singleton clusters'
Assert-Equal 0 @($baseline.PhysicalObjectClusters | Where-Object {
    $_.RepresentationIds.Count -gt 1
}).Count '14 never merges physical objects'
Assert-Equal 0 $baseline.SupportedObjectAssertionCount '14 emits no supported object identity'
Assert-True ($baseline.SameObjectPossibleGroups.Count -ge 1) `
    'projection alignment survives as an unmerged candidate group'
Assert-True ($baseline.TypeCandidateGroups.Count -ge 1) `
    'same invariant signature survives in a separate type candidate group'

$additional = [System.Collections.Generic.List[Shb.Cad.Core.IdentityRepresentationObservation]]::new()
$additional.Add([Shb.Cad.Core.IdentityRepresentationObservation]::new(
    'SCHEDULE-A', 'schedule_record', 'bom_row', 'BOM-1', '',
    [string[]]@('row A'), [string[]]@('bom-row:A')))
$additional.Add([Shb.Cad.Core.IdentityRepresentationObservation]::new(
    'SCHEDULE-CONFLICT', 'schedule_record', 'bom_row', 'BOM-1', '',
    [string[]]@('row conflict'), [string[]]@('bom-row:conflict')))
$additional.Add([Shb.Cad.Core.IdentityRepresentationObservation]::new(
    'SCHEDULE-BLOCKED', 'schedule_record', 'bom_row', 'BOM-1', '',
    [string[]]@('row blocked'), [string[]]@('bom-row:blocked')))

$evidence = [System.Collections.Generic.List[Shb.Cad.Core.RepresentationIdentityEvidenceObservation]]::new()
function Add-Evidence(
    [string]$Id,
    [string]$Left,
    [string]$Right,
    [string]$EdgeType,
    [string]$SourceKind) {
    $evidence.Add([Shb.Cad.Core.RepresentationIdentityEvidenceObservation]::new(
        $Id, $Left, $Right, $EdgeType, 'supported', 'explicit_authored_mapping',
        $SourceKind, [string[]]@('authored-map:' + $Id), 'synthetic independent evidence'))
}

Add-Evidence 'merge-ab' $regionA.Id $regionB.Id 'same_object_supported' 'explicit_authored_mapping'
Add-Evidence 'merge-bc' $regionB.Id $regionC.Id 'same_object_supported' 'explicit_authored_mapping'
Add-Evidence 'different-ac' $regionA.Id $regionC.Id 'different_object_proven' 'explicit_authored_separation'
Add-Evidence 'possible-ac' $regionA.Id $regionC.Id 'same_object_possible' 'review_candidate'
Add-Evidence 'schedule-a' 'SCHEDULE-A' $regionA.Id 'same_object_supported' 'explicit_bom_mapping'
Add-Evidence 'schedule-conflict-a' 'SCHEDULE-CONFLICT' $regionA.Id 'same_object_supported' 'explicit_bom_mapping'
Add-Evidence 'schedule-conflict-c' 'SCHEDULE-CONFLICT' $regionC.Id 'same_object_supported' 'explicit_bom_mapping'
Add-Evidence 'schedule-blocked-a' 'SCHEDULE-BLOCKED' $regionA.Id 'same_object_supported' 'explicit_bom_mapping'
Add-Evidence 'schedule-blocked-b' 'SCHEDULE-BLOCKED' $regionB.Id 'different_object_proven' 'explicit_authored_separation'

$result = [Shb.Cad.Core.RepresentationIdentityResolver]::Analyze(
    $regions, $correspondence, $additional, $evidence)
Assert-Equal 'conflicted' $result.Status 'hard negative blocks an otherwise supported transitive merge'
Assert-Equal 6 $result.Representations.Count 'engineering and schedule representations coexist'
Assert-Equal 2 $result.PhysicalObjectClusters.Count 'A/B merge while C remains separate'
Assert-Equal 1 @($result.PhysicalObjectClusters | Where-Object {
    $_.RepresentationIds.Count -eq 2
}).Count 'exactly one supported physical merge'
Assert-Equal 1 $result.BlockedMerges.Count 'B/C merge is blocked through the A/C constraint'
Assert-Equal 2 $result.DifferentObjectConstraintCount 'physical and schedule hard negatives retained'

$mergedCluster = $result.PhysicalObjectClusters | Where-Object {
    $_.RepresentationIds.Contains($regionA.Id)
} | Select-Object -First 1
Assert-True ($mergedCluster.RepresentationIds.Contains($regionB.Id)) `
    'accepted A/B evidence joins both representations'
Assert-True (-not $mergedCluster.RepresentationIds.Contains($regionC.Id)) `
    'transitive forbidden pair prevents C from entering the A/B cluster'
Assert-True ($mergedCluster.AttachedScheduleRecordIds.Contains('SCHEDULE-A')) `
    'schedule row attaches only after all strong links resolve to one physical cluster'

$scheduleA = $result.ScheduleResolutions | Where-Object ScheduleRecordId -eq 'SCHEDULE-A'
$scheduleConflict = $result.ScheduleResolutions | Where-Object ScheduleRecordId -eq 'SCHEDULE-CONFLICT'
$scheduleBlocked = $result.ScheduleResolutions | Where-Object ScheduleRecordId -eq 'SCHEDULE-BLOCKED'
Assert-Equal 'resolved_to_single_physical_cluster' $scheduleA.Status `
    'single-cluster schedule link resolves'
Assert-Equal 'conflicting_physical_targets' $scheduleConflict.Status `
    'multi-cluster schedule row remains unattached'
Assert-Equal 'blocked_by_different_object_constraint' $scheduleBlocked.Status `
    'schedule row cannot bypass a hard negative against another member of the target cluster'
Assert-True ($result.SameObjectPossibleGroups.Count -ge 1) `
    'possible identity remains visible after hard-resolution pass'
Assert-True (@($result.SameObjectPossibleGroups | Where-Object {
    $_.ConflictingConstraintIds.Count -gt 0
}).Count -ge 1) 'candidate group exposes its hard-negative conflict'
Assert-Equal 'read_only_no_entities_modified' $result.ToMap()['mutation_status'] 'read-only contract'

# A geometry/projection source cannot smuggle itself in as strong identity evidence.
$invalidEvidence = [System.Collections.Generic.List[Shb.Cad.Core.RepresentationIdentityEvidenceObservation]]::new()
$invalidEvidence.Add([Shb.Cad.Core.RepresentationIdentityEvidenceObservation]::new(
    'invalid-geometry-merge', $regionA.Id, $regionC.Id, 'same_object_supported',
    'supported', 'high_geometry_similarity', 'geometry_repetition',
    [string[]]@('relation:synthetic'), 'must be downgraded'))
$guarded = [Shb.Cad.Core.RepresentationIdentityResolver]::Analyze(
    $regions, $correspondence, $null, $invalidEvidence)
Assert-Equal 'unsupported_partial' $guarded.Status 'non-independent merge source is diagnosed'
Assert-Equal 0 $guarded.SupportedObjectAssertionCount 'non-independent evidence is never merge eligible'
Assert-Equal 0 @($guarded.PhysicalObjectClusters | Where-Object {
    $_.RepresentationIds.Count -gt 1
}).Count 'invalid strong evidence cannot merge'
Assert-Equal 1 @($guarded.Diagnostics | Where-Object Code -eq 'NON_INDEPENDENT_IDENTITY_SUPPORT').Count `
    'identity-source guard is explicit'

# Optional regression over saved-fact replay artifacts.
$outRoot = Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad-11-12'
$regressionFiles = @()
if (Test-Path $outRoot) {
    $regressionFiles = @(Get-ChildItem $outRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'representation-identity-resolution-replay.json' } |
        Where-Object { Test-Path $_ })
}
foreach ($file in $regressionFiles) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    Assert-Equal 0 $json.same_object_supported_assertion_count `
        "saved 13/14 facts contain no independent object identity: $file"
    Assert-Equal 0 $json.merged_physical_object_cluster_count `
        "no geometry-only object merge in replay: $file"
    Assert-Equal $json.physical_representation_count $json.physical_object_cluster_count `
        "one conservative singleton per physical representation: $file"
    Assert-Equal 0 $json.blocked_merge_count "no unsupported merge to block: $file"
    Assert-Equal 'read_only_no_entities_modified' $json.mutation_status "read-only replay: $file"
}

Write-Host "PASS 15 representation-identity-resolution; optional saved-fact regressions=$($regressionFiles.Count)"
