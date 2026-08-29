$ErrorActionPreference = 'Stop'

$coreRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$coreFiles = @(
    (Join-Path $coreRoot '19-semantic-drawing-diff/SemanticDrawingDiffAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'CrossDrawingInterfaceGraphModels.cs'),
    (Join-Path $PSScriptRoot 'CrossDrawingProjectInputBuilder.cs'),
    (Join-Path $PSScriptRoot 'CrossDrawingInterfaceGraphAnalyzer.cs')
)
Add-Type -Path $coreFiles

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERT TRUE FAILED: $Message" }
}

function Assert-Equal($Expected, $Actual, [string]$Message) {
    if ($Expected -ne $Actual) {
        throw "ASSERT EQUAL FAILED: $Message; expected=[$Expected] actual=[$Actual]"
    }
}

function New-Drawing(
    [string]$Snapshot,
    [string]$Number,
    [string]$Sheet = '1',
    [string]$Revision = 'A'
) {
    $drawing = [Shb.Cad.Core.CrossDrawingDrawingObservation]::new(
        $Snapshot, $Snapshot, $Number)
    $drawing.SetTitle("Drawing $Number", $Revision, 'production', $Sheet, '1', 'TX') | Out-Null
    $drawing.SetSource("$Snapshot.dwg", 'computed', $false) | Out-Null
    $drawing.SetUnitContext('Millimeters', 'Metric', $false, 'synthetic-unverified') | Out-Null
    return $drawing
}

function New-Interface(
    [string]$Id,
    [double]$Width,
    [double]$Height,
    [double]$AuthoredDimension
) {
    $value = [Shb.Cad.Core.CrossDrawingInterfaceObservation]::new(
        $Id, $Id, 'interface_feature',
        'circular_nested_interface_feature_candidate',
        'circular_closed_profile',
        'topology_nested_boundary_supported')
    $value.SetBounds(0, 0, $Width, $Height) | Out-Null
    $value.SetLocalFrame(0.1, 0.2, 0, 10, 'median_topology_edge_length') | Out-Null
    $value.AddMetric('oriented_width', $Width) | Out-Null
    $value.AddMetric('oriented_height', $Height) | Out-Null
    $value.AddMetric('area', ([Math]::PI * $Width * $Height / 4)) | Out-Null
    $value.AddBoundDimensionValue(
        'supported:authored_displayed_dimension:DiameterDimension',
        $AuthoredDimension) | Out-Null
    $value.AddSourceId("source-$Id") | Out-Null
    return $value
}

$parent = New-Drawing 'snapshot-parent' 'D-100'
$sourceInterface = New-Interface 'SRC-I' 100 100 100
$parent.AddInterface($sourceInterface) | Out-Null

$supportedReference = [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
    'REF-200', 'D-200', 'authored_bom_part_number', 'BOM-1')
$supportedReference.SetBomContext('1', 'Matching flange', '1') | Out-Null
$supportedReference.AddAssociatedInterface('SRC-I', 'supported') | Out-Null
$parent.AddComponentReference($supportedReference) | Out-Null

$conflictedReference = [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
    'REF-300', 'D-300', 'authored_bom_part_number', 'BOM-2')
$conflictedReference.SetBomContext('2', 'Changed flange', '1') | Out-Null
$conflictedReference.AddAssociatedInterface('SRC-I', 'supported') | Out-Null
$parent.AddComponentReference($conflictedReference) | Out-Null

$missingReference = [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
    'REF-404', '5TBC.404.A1', 'authored_bom_part_number', 'BOM-3')
$parent.AddComponentReference($missingReference) | Out-Null

$textReference = [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
    'REF-TEXT', 'D-200', 'authored_text_reference', 'NOTE-1')
$textReference.SetSourceText('See D-200 for detail') | Out-Null
$parent.AddComponentReference($textReference) | Out-Null

$multiSheetReference = [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
    'REF-500', 'D-500', 'authored_bom_part_number', 'BOM-4')
$parent.AddComponentReference($multiSheetReference) | Out-Null

$duplicateVersionReference = [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
    'REF-600', 'D-600', 'authored_bom_part_number', 'BOM-5')
$parent.AddComponentReference($duplicateVersionReference) | Out-Null

$matching = New-Drawing 'snapshot-200' 'D-200'
$matching.AddInterface((New-Interface 'TGT-I-200' 100.5 99.5 100)) | Out-Null
$conflicted = New-Drawing 'snapshot-300' 'D-300'
$conflicted.AddInterface((New-Interface 'TGT-I-300' 100 100 120)) | Out-Null
$sheet1 = New-Drawing 'snapshot-500-1' 'D-500' '1'
$sheet2 = New-Drawing 'snapshot-500-2' 'D-500' '2'
$versionA = New-Drawing 'snapshot-600-a' 'D-600' '1' 'A'
$versionB = New-Drawing 'snapshot-600-b' 'D-600' '1' 'B'

$drawingSet = [System.Collections.Generic.List[Shb.Cad.Core.CrossDrawingDrawingObservation]]::new()
foreach ($drawingValue in @(
    $parent, $matching, $conflicted, $sheet1, $sheet2, $versionA, $versionB)) {
    $drawingSet.Add($drawingValue)
}
$graph = [Shb.Cad.Core.CrossDrawingInterfaceGraphAnalyzer]::Analyze($drawingSet)

Assert-Equal 'conflicted' $graph.Status 'authored interface dimension conflict propagates'
Assert-True (@($graph.IdentityAssertions | Where-Object {
    $_.IdentityType -eq 'interface_to_interface' -and $_.Status -eq 'supported'
}).Count -eq 1) 'supported interface identity requires reference + explicit context + signature'
Assert-True (@($graph.IdentityAssertions | Where-Object {
    $_.IdentityType -eq 'interface_to_interface' -and $_.Status -eq 'conflicted'
}).Count -eq 1) 'authored dimension conflict preserved'
Assert-True (@($graph.Relations | Where-Object {
    $_.RelationType -eq 'drawing_ref' -and $_.SourceId -eq 'REF-TEXT' -and $_.Status -eq 'possible'
}).Count -eq 1) 'text reference does not become supported identity'
Assert-Equal 2 (@($graph.Relations | Where-Object {
    $_.RelationType -eq 'drawing_ref' -and $_.SourceId -eq 'REF-500' -and $_.Status -eq 'supported'
}).Count) 'distinct sheets are one supported drawing set, not duplicate versions'
Assert-Equal 2 (@($graph.Relations | Where-Object {
    $_.RelationType -eq 'drawing_ref' -and $_.SourceId -eq 'REF-600' -and $_.Status -eq 'possible'
}).Count) 'same sheet multiple revisions stays unresolved'
Assert-True (@($graph.Audits | Where-Object {
    $_.Code -eq 'MULTIPLE_REVISIONS_FOR_DRAWING_SHEET'
}).Count -eq 1) 'version ambiguity audit'
Assert-True (@($graph.Audits | Where-Object {
    $_.Code -eq 'REFERENCED_DRAWING_NOT_IN_SUPPLIED_SET_CANDIDATE'
}).Count -eq 1) ("missing means absent from supplied set only; actual=" +
    (($graph.Audits | ForEach-Object Code) -join ','))
Assert-True (@($graph.Audits | Where-Object {
    $_.Code -eq 'CROSS_DRAWING_INTERFACE_METRIC_CONFLICT_CANDIDATE'
}).Count -eq 1) 'conflict candidate is auditable'

# The snapshot adapter preserves BOM pointer evidence, local view coordinates,
# interface signatures and uniquely bound authored dimensions.
$identity = [Shb.Cad.Core.SemanticDrawingIdentityObservation]::new('snapshot-input')
$identity.SetDrawingNumber('D-700', 'synthetic-title') | Out-Null
$identity.SetSheet('1', '1', 'synthetic-title') | Out-Null
$snapshot = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
    'snapshot-input', $identity, 'computed')

$region = [Shb.Cad.Core.SemanticDrawingElementObservation]::new(
    'REGION-E', 'engineering_region', 'engineering_view_candidate', 'REGION-RAW', 'view')
$region.SetBounds(0, 0, 200, 100) | Out-Null
$region.AddGeometryMetric('local_frame_origin_x', 100) | Out-Null
$region.AddGeometryMetric('local_frame_origin_y', 50) | Out-Null
$region.AddGeometryMetric('local_frame_axis_x_x', 1) | Out-Null
$region.AddGeometryMetric('local_frame_axis_x_y', 0) | Out-Null
$region.AddGeometryMetric('local_frame_axis_y_x', 0) | Out-Null
$region.AddGeometryMetric('local_frame_axis_y_y', 1) | Out-Null
$region.AddGeometryMetric('local_frame_scale', 10) | Out-Null
$region.AddSemanticValue('local_frame_scale_source', 'median_topology_edge_length') | Out-Null
$region.AddSourceId('REGION-RAW') | Out-Null
[void]$snapshot.AddElement($region, 100)

$feature = [Shb.Cad.Core.SemanticDrawingElementObservation]::new(
    'FEATURE-E', 'interface_feature',
    'circular_nested_interface_feature_candidate', 'FEATURE-RAW', 'circular')
$feature.SetBounds(145, 45, 155, 55) | Out-Null
$feature.SetEvidenceStatus('topology_nested_boundary_supported') | Out-Null
$feature.SetGeometrySignature('circle-10') | Out-Null
$feature.AddSemanticValue('shape_class', 'circular_closed_profile') | Out-Null
$feature.AddGeometryMetric('oriented_width', 10) | Out-Null
$feature.AddGeometryMetric('oriented_height', 10) | Out-Null
$feature.AddGeometryMetric('orientation_degrees', 0) | Out-Null
$feature.AddAssociation('region_id', 'REGION-RAW') | Out-Null
$feature.AddSourceId('FEATURE-RAW') | Out-Null
[void]$snapshot.AddElement($feature, 100)

$dimension = [Shb.Cad.Core.SemanticDrawingElementObservation]::new(
    'DIM-E', 'dimension_binding', 'DiameterDimension', 'DIM-RAW', 'diameter')
$dimension.AddSemanticValue('status', 'bound_unique') | Out-Null
$dimension.AddSemanticNumber('effective_displayed_value', 10) | Out-Null
$dimension.AddAssociation('interface_feature_id', 'FEATURE-RAW') | Out-Null
[void]$snapshot.AddElement($dimension, 100)

$bom = [Shb.Cad.Core.SemanticDrawingElementObservation]::new(
    'BOM-E', 'bom_row', 'mechanical_bom_row', 'BOM-RAW', 'bom')
$bom.AddSemanticValue('part_number', 'D-800.A.1') | Out-Null
$bom.AddSemanticValue('name', 'Part') | Out-Null
$bom.AddSemanticNumber('item_number', 8) | Out-Null
$bom.AddAssociation('item_annotation_point_world', '150,50') | Out-Null
[void]$snapshot.AddElement($bom, 100)

$observation = [Shb.Cad.Core.CrossDrawingProjectInputBuilder]::FromSemanticSnapshot($snapshot)
Assert-Equal 1 $observation.Interfaces.Count 'snapshot interface projection'
Assert-True $observation.Interfaces[0].HasLocalFrame 'region local frame projected'
Assert-True ([Math]::Abs($observation.Interfaces[0].LocalX - 5) -lt 0.000001) 'local X'
Assert-Equal 1 $observation.Interfaces[0].BoundDimensionValues.Count 'bound authored dimension projected'
Assert-Equal 1 $observation.ComponentReferences.Count 'BOM component reference projected'
Assert-True $observation.ComponentReferences[0].HasPointer 'BOM sequence leader endpoint projected'

$map = $graph.ToMap()
Assert-Equal 'cross_drawing_interface_graph' $map.analysis_type 'map contract'
Assert-Equal 'read_only_no_dwg_or_source_artifacts_modified' $map.mutation_status 'read-only contract'
Assert-True ($graph.ToMarkdown().Contains('跨图工程接口')) 'markdown summary'

Write-Host ('PASS 20 cross-drawing graph: drawings={0} refs={1} interfaces={2} identities={3} comparisons={4} audits={5} status={6}' -f
    $graph.Drawings.Count,
    $graph.ComponentReferenceCount,
    $graph.InterfaceReferenceCount,
    $graph.IdentityAssertions.Count,
    $graph.InterfaceComparisons.Count,
    $graph.Audits.Count,
    $graph.Status)
