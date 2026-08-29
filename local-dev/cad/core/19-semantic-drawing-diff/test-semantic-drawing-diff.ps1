$ErrorActionPreference = 'Stop'

$coreRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$coreFiles = @(
    (Join-Path $coreRoot '04-mechanical-bom-knowledge/MechanicalBomKnowledgeBuilder.cs'),
    (Join-Path $coreRoot '05-technical-requirements-extraction/TechnicalRequirementsExtractor.cs'),
    (Join-Path $coreRoot '08-annotation-identification/AnnotationIdentifier.cs'),
    (Join-Path $coreRoot '09-dimension-topology/DimensionTopologyAnalyzer.cs'),
    (Join-Path $coreRoot '11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $coreRoot '12-planar-topology-kernel/PlanarTopologyAnalyzer.cs'),
    (Join-Path $coreRoot '13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs'),
    (Join-Path $coreRoot '14-representation-correspondence/RepresentationCorrespondenceAnalyzer.cs'),
    (Join-Path $coreRoot '15-representation-identity-resolution/RepresentationIdentityResolver.cs'),
    (Join-Path $coreRoot '16-manufacturing-profile-features/ManufacturingProfileAnalyzer.cs'),
    (Join-Path $coreRoot '17-mechanical-interface-adjacency/MechanicalInterfaceAdjacencyAnalyzer.cs'),
    (Join-Path $coreRoot '18-dimension-geometry-binding/DimensionGeometryBindingAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'SemanticDrawingDiffAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'SemanticDrawingSnapshotBuilder.cs')
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

function New-Identity([string]$DrawingNumber, [string]$Revision) {
    $identity = [Shb.Cad.Core.SemanticDrawingIdentityObservation]::new('sample-drawing')
    $identity.SetDrawingNumber($DrawingNumber, 'synthetic-title') | Out-Null
    $identity.SetSheet('1', '1', 'synthetic-title') | Out-Null
    $identity.SetRevision($Revision, 'synthetic-title') | Out-Null
    return $identity
}

function New-Element(
    [string]$Id,
    [string]$Domain,
    [string]$Kind,
    [string]$StableKey,
    [string]$MatchSignature,
    [double]$X,
    [double]$Y,
    [string]$GeometrySignature
) {
    $element = [Shb.Cad.Core.SemanticDrawingElementObservation]::new(
        $Id, $Domain, $Kind, $StableKey, $MatchSignature)
    $element.SetBounds($X - 1, $Y - 1, $X + 1, $Y + 1) | Out-Null
    $element.SetGeometrySignature($GeometrySignature) | Out-Null
    return $element
}

$baseline = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
    'baseline', (New-Identity 'D-100' 'A'), 'computed')
$current = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
    'current', (New-Identity 'D-100' 'B'), 'computed')
$maximum = 1000

# Three unchanged stable anchors establish one sheet translation (+100, +50).
foreach ($definition in @(
    @('g1', 'K1', 0.0, 0.0),
    @('g3', 'K3', 20.0, 0.0),
    @('g6', 'K6', 40.0, 0.0)
)) {
    $left = New-Element $definition[0] 'geometry_occurrence' 'line' $definition[1] 'line|open' $definition[2] $definition[3] 'same-line'
    $right = New-Element ("new-" + $definition[0]) 'geometry_occurrence' 'line' $definition[1] 'line|open' ($definition[2] + 100) ($definition[3] + 50) 'same-line'
    if ($definition[0] -eq 'g3') {
        $left.AddStyleValue('color', 'white') | Out-Null
        $right.AddStyleValue('color', 'yellow') | Out-Null
    }
    if ($definition[0] -eq 'g6') {
        $left.AddAssociation('physical_object_cluster_id', 'object-a') | Out-Null
        $right.AddAssociation('physical_object_cluster_id', 'object-b') | Out-Null
        $right.SetEvidenceStatus('ambiguous') | Out-Null
    }
    [void]$baseline.AddElement($left, $maximum)
    [void]$current.AddElement($right, $maximum)
}

$geometryBefore = New-Element 'g2' 'geometry_occurrence' 'polyline' 'K2' 'polyline|closed' 10 10 'profile-old'
$geometryBefore.AddGeometryMetric('area', 100) | Out-Null
$geometryAfter = New-Element 'new-g2' 'geometry_occurrence' 'polyline' 'K2' 'polyline|closed' 110 60 'profile-new'
$geometryAfter.AddGeometryMetric('area', 120) | Out-Null
[void]$baseline.AddElement($geometryBefore, $maximum)
[void]$current.AddElement($geometryAfter, $maximum)

$removed = New-Element 'g4' 'geometry_occurrence' 'line' 'K4' 'removed-only' 60 0 'removed'
$added = New-Element 'g5' 'geometry_occurrence' 'line' 'K5' 'added-only' 170 50 'added'
[void]$baseline.AddElement($removed, $maximum)
[void]$current.AddElement($added, $maximum)

# Handle/id churn is recovered by unique structure + aligned position.
$fallbackBefore = New-Element 'old-handle' 'annotation' 'leader_note' 'OLD-HANDLE' 'leader-note-structure' 50 20 'leader'
$fallbackAfter = New-Element 'new-handle' 'annotation' 'leader_note' 'NEW-HANDLE' 'leader-note-structure' 150 70 'leader'
[void]$baseline.AddElement($fallbackBefore, $maximum)
[void]$current.AddElement($fallbackAfter, $maximum)

# Equal-distance candidates stay ambiguous and are not arbitrarily called added/removed.
$ambiguousBefore = New-Element 'amb-before' 'interface_feature' 'hole' 'AMB-OLD' 'hole-duplicate' 80 0 'hole'
$ambiguousAfter1 = New-Element 'amb-after-1' 'interface_feature' 'hole' 'AMB-NEW-1' 'hole-duplicate' 179.9 50 'hole'
$ambiguousAfter2 = New-Element 'amb-after-2' 'interface_feature' 'hole' 'AMB-NEW-2' 'hole-duplicate' 180.1 50 'hole'
[void]$baseline.AddElement($ambiguousBefore, $maximum)
[void]$current.AddElement($ambiguousAfter1, $maximum)
[void]$current.AddElement($ambiguousAfter2, $maximum)

$dimensionBefore = New-Element 'dim-old' 'dimension_binding' 'linear' 'DIM-1' 'linear|model' 30 30 'dimension-binding'
$dimensionBefore.AddSemanticNumber('entity_measurement', 100) | Out-Null
$dimensionBefore.AddGeometryMetric('source_unit_geometry_span_minimum', 100) | Out-Null
$dimensionAfter = New-Element 'dim-new' 'dimension_binding' 'linear' 'DIM-1' 'linear|model' 130 80 'dimension-binding'
$dimensionAfter.AddSemanticNumber('entity_measurement', 100) | Out-Null
$dimensionAfter.AddGeometryMetric('source_unit_geometry_span_minimum', 120) | Out-Null
[void]$baseline.AddElement($dimensionBefore, $maximum)
[void]$current.AddElement($dimensionAfter, $maximum)

$bomBefore = New-Element 'bom-old' 'bom_row' 'mechanical_bom_row' 'BOM|ITEM:1' 'bom-row' 0 -20 'bom'
$bomBefore.AddSemanticValue('quantity', '2') | Out-Null
$bomAfter = New-Element 'bom-new' 'bom_row' 'mechanical_bom_row' 'BOM|ITEM:1' 'bom-row' 100 30 'bom'
$bomAfter.AddSemanticValue('quantity', '4') | Out-Null
[void]$baseline.AddElement($bomBefore, $maximum)
[void]$current.AddElement($bomAfter, $maximum)

$baseline.AddIssue([Shb.Cad.Core.SemanticDrawingIssueObservation]::new(
    'persist', 'review_candidate', 'open', 'review', 'persists')) | Out-Null
$baseline.AddIssue([Shb.Cad.Core.SemanticDrawingIssueObservation]::new(
    'closed', 'review_candidate', 'open', 'review', 'baseline only')) | Out-Null
$current.AddIssue([Shb.Cad.Core.SemanticDrawingIssueObservation]::new(
    'persist', 'review_candidate', 'open', 'review', 'persists')) | Out-Null
$current.AddIssue([Shb.Cad.Core.SemanticDrawingIssueObservation]::new(
    'new', 'review_candidate', 'open', 'review', 'current only')) | Out-Null

$config = [Shb.Cad.Core.SemanticDrawingDiffConfig]::new()
$config.MinimumFallbackSpatialTolerance = 1.0
$config.MinimumAlignmentSupport = 3
$diff = [Shb.Cad.Core.SemanticDrawingDiffAnalyzer]::Analyze($baseline, $current, $config)

Assert-True $diff.Identity.Comparable 'same authored drawing number and sheet must pass identity gate'
Assert-Equal 'stable_anchor_inferred_translation' $diff.Alignment.Source 'global translation inference source'
Assert-True ([Math]::Abs($diff.Alignment.TranslationX - 100) -lt 0.000001) 'translation X'
Assert-True ([Math]::Abs($diff.Alignment.TranslationY - 50) -lt 0.000001) 'translation Y'
Assert-Equal 7 $diff.MatchedElementCount 'stable and fallback matched element count'
Assert-Equal 2 $diff.UnchangedElementCount 'unchanged element count'
Assert-Equal 5 $diff.ChangedElementCount 'geometry/style/association-evidence/dimension/BOM changes'
Assert-Equal 1 $diff.AddedCandidateCount 'only genuine unmatched addition candidate'
Assert-Equal 1 $diff.RemovedCandidateCount 'only genuine unmatched removal candidate'
Assert-Equal 1 $diff.AmbiguousMatches.Count 'equal spatial candidates preserved'
Assert-True (@($diff.Changes | Where-Object { $_.MatchMethod -eq 'structure_signature_spatial_fallback' }).Count -gt 0) 'handle churn fallback match'
Assert-True (@($diff.Changes | Where-Object { $_.ChangeKinds -contains 'style_only_changed' }).Count -gt 0) 'style-only change is separate'
Assert-True (@($diff.Changes | Where-Object { $_.ChangeKinds -contains 'association_changed' }).Count -gt 0) 'association change is separate'
Assert-True (@($diff.Changes | Where-Object { $_.ChangeKinds -contains 'evidence_status_changed' }).Count -gt 0) 'evidence-status change is separate'
Assert-True (@($diff.SynchronizationCandidates | Where-Object {
    $_.Kind -eq 'bound_geometry_changed_without_dimension_value_change_candidate'
}).Count -gt 0) 'dimension/geometry synchronization review candidate'
Assert-Equal 3 $diff.IssueLifecycles.Count 'issue lifecycle count'
Assert-True (@($diff.IssueLifecycles | Where-Object { $_.Lifecycle -eq 'new_candidate' }).Count -gt 0) 'new issue lifecycle'
Assert-True (@($diff.IssueLifecycles | Where-Object { $_.Lifecycle -eq 'closed_or_not_reproduced_candidate' }).Count -gt 0) 'closed/not-reproduced issue lifecycle'
Assert-True ($diff.ChangeRegions.Count -gt 0) 'changed elements clustered into review regions'
Assert-Equal 'ambiguous' $diff.Status 'preserved match ambiguity propagates to status'

# Self-diff is an exact invariant even if the source snapshot itself is degraded.
$self = [Shb.Cad.Core.SemanticDrawingDiffAnalyzer]::Analyze($baseline, $baseline, $config)
Assert-Equal 0 $self.ChangedElementCount 'self diff changed count'
Assert-Equal 0 $self.AddedCandidateCount 'self diff additions'
Assert-Equal 0 $self.RemovedCandidateCount 'self diff removals'
Assert-Equal 0 $self.AmbiguousMatches.Count 'self diff ambiguity'

# Unrelated drawings are stopped before any mass addition/removal classification.
$other = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
    'other', (New-Identity 'D-999' 'A'), 'computed')
[void]$other.AddElement((New-Element 'other-g' 'geometry_occurrence' 'line' 'OTHER' 'line' 0 0 'line'), $maximum)
$notComparable = [Shb.Cad.Core.SemanticDrawingDiffAnalyzer]::Analyze($baseline, $other, $config)
Assert-Equal 'not_comparable' $notComparable.Status 'different authored number identity gate'
Assert-Equal 0 $notComparable.AddedCandidateCount 'identity failure suppresses additions'
Assert-Equal 0 $notComparable.RemovedCandidateCount 'identity failure suppresses removals'

# Comparable identity is not enough to call unmatched elements added/removed when
# no independent global alignment can be established.
$unalignedLeft = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
    'unaligned-left', (New-Identity 'D-100' 'A'), 'computed')
$unalignedRight = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
    'unaligned-right', (New-Identity 'D-100' 'B'), 'computed')
[void]$unalignedLeft.AddElement((New-Element 'ul' 'geometry_occurrence' 'line' 'UL' 'left-only' 0 0 'left'), $maximum)
[void]$unalignedRight.AddElement((New-Element 'ur' 'geometry_occurrence' 'line' 'UR' 'right-only' 100 50 'right'), $maximum)
$unaligned = [Shb.Cad.Core.SemanticDrawingDiffAnalyzer]::Analyze(
    $unalignedLeft, $unalignedRight, $config)
Assert-Equal 'ambiguous' $unaligned.Alignment.Status 'insufficient alignment support remains explicit'
Assert-Equal 0 $unaligned.AddedCandidateCount 'alignment ambiguity suppresses additions'
Assert-Equal 0 $unaligned.RemovedCandidateCount 'alignment ambiguity suppresses removals'

# Candidate budget truncation also suppresses unmatched classification.
$budgetLeft = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
    'budget-left', (New-Identity 'D-100' 'A'), 'computed')
$budgetRight = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
    'budget-right', (New-Identity 'D-100' 'B'), 'computed')
foreach ($index in 1..2) {
    [void]$budgetLeft.AddElement((New-Element "bl-$index" 'annotation' 'note' "BL-$index" 'same' $index 0 'note'), $maximum)
    [void]$budgetRight.AddElement((New-Element "br-$index" 'annotation' 'note' "BR-$index" 'same' $index 0 'note'), $maximum)
}
$budgetConfig = [Shb.Cad.Core.SemanticDrawingDiffConfig]::new()
$budgetConfig.MaximumCandidateComparisonCount = 1
$budgetConfig.MinimumFallbackSpatialTolerance = 10
$budget = [Shb.Cad.Core.SemanticDrawingDiffAnalyzer]::Analyze($budgetLeft, $budgetRight, $budgetConfig)
Assert-True $budget.CandidateBudgetTruncated 'candidate comparison budget truncation is explicit'
Assert-Equal 0 $budget.AddedCandidateCount 'budget truncation suppresses additions'
Assert-Equal 0 $budget.RemovedCandidateCount 'budget truncation suppresses removals'

# Title identity is read from authored fields, not guessed from geometry.
$title = [System.Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
$title['handle'] = 'ABCD'
$fields = [System.Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
$fields['图样代号'] = ' 5TBC.100 '
$fields['图样名称'] = '器身装配'
$fields['产品型号'] = 'SZ-100'
$fields['第几页'] = '1'
$fields['共几页'] = '2'
$fields['改版标记2'] = 'B'
$title['fields'] = $fields
$titles = [System.Collections.Generic.List[System.Collections.Generic.Dictionary[string,object]]]::new()
$titles.Add($title)
$identity = [Shb.Cad.Core.SemanticDrawingSnapshotBuilder]::IdentityOf(
    'fallback-id', 'sample.dwg', $titles)
Assert-Equal '5TBC.100' $identity.DrawingNumber 'authored drawing number'
Assert-Equal 'B' $identity.Revision 'latest non-empty authored revision marker'
Assert-Equal '1' $identity.Sheet 'authored sheet'

$map = $diff.ToMap()
Assert-Equal 'semantic_drawing_diff' $map['analysis_type'] 'diff map analysis type'
Assert-Equal 'read_only_no_entities_modified' $map['mutation_status'] 'read-only contract'
Assert-True ($map['semantic_contract'].ContainsKey('identity_gate')) 'identity semantic boundary'

Write-Host 'PASS semantic drawing snapshot identity projection'
Write-Host 'PASS translation alignment and stable/fallback matching'
Write-Host 'PASS separate semantic/geometry/style/association change evidence'
Write-Host 'PASS ambiguity, identity gate, and candidate budget safety'
Write-Host 'PASS issue lifecycle, synchronization candidates, and change regions'
