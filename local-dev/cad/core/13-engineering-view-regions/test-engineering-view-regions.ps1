$ErrorActionPreference = 'Stop'

$files = @(
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../12-planar-topology-kernel/PlanarTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'EngineeringViewRegionAnalyzer.cs')
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

$drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-view-regions')
$drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
    'OUTLINE',
    [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'white', 7, $null, $null, $null),
    'Continuous', 25, $false, $false)) | Out-Null
$root = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
    'ROOT', '*MODEL_SPACE', 'model_space', $true, $false, $false)
$roles = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)

function Add-Path([string]$Handle, [object[]]$Points, [bool]$Closed, [string]$Role = 'visible_contour') {
    $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
        $Handle, 'AcDbPolyline', 'Polyline', 'path', 'OUTLINE', $true)
    $entity.SetPath((New-PointList $Points), $Closed, 'exact_linear_polyline') | Out-Null
    $root.AddEntity($entity) | Out-Null
    $roles[$Handle] = $Role
}

# Unlabelled engineering view: geometry may make it a candidate, never a guessed "main view".
Add-Path 'VIEW_A_BOX' @(@(0,0), @(10,0), @(10,6), @(0,6)) $true
Add-Path 'VIEW_A_MID' @(@(0,3), @(10,3)) $false

# Authored section label is the only reason this scope may be called a section candidate.
Add-Path 'VIEW_B_BOX' @(@(20,0), @(26,0), @(26,6), @(20,6)) $true
Add-Path 'VIEW_B_MID' @(@(20,3), @(26,3)) $false

# A frame-scale connected skeleton must become its own sheet scope instead of
# acting as a bridge between all local regions.
Add-Path 'SHEET_SKELETON' @(@(-2,-12), @(30,-12), @(30,10), @(-2,10)) $true

# This annotation crosses the space between A and B. Both 12 and 13 must exclude it.
Add-Path 'CROSS_DIMENSION' @(@(8,7), @(22,7)) $false 'annotation_geometry'

$drawing.AddDefinition($root) | Out-Null
$instances = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing, $roles)
$topologyConfig = [Shb.Cad.Core.PlanarTopologyConfig]::new()
$topologyConfig.SnapTolerance = 0.001
$topologyConfig.GridSize = 0.0001
$topology = [Shb.Cad.Core.PlanarTopologyAnalyzer]::Analyze($instances, $topologyConfig)

$frame = [Shb.Cad.Core.ViewRegionFrameObservation]::new(
    'FRAME', -2, -12, 30, 10, [string[]]@())
$sectionText = 'A-A' + [char]0x5256 + [char]0x89C6
$documentationText = [string][char]0x6280 + [char]0x672F + [char]0x8981 + [char]0x6C42
$mainViewText = [string][char]0x4E3B + [char]0x89C6 + [char]0x56FE
$texts = [System.Collections.Generic.List[Shb.Cad.Core.ViewRegionTextObservation]]::new()
$texts.Add([Shb.Cad.Core.ViewRegionTextObservation]::new(
    'TEXT_SECTION', $sectionText, 21, 5, 24, 5.8, 'drawing_text'))
$texts.Add([Shb.Cad.Core.ViewRegionTextObservation]::new(
    'TEXT_DOC', $documentationText, 1, -9.7, 4, -9.1, 'drawing_text'))
$texts.Add([Shb.Cad.Core.ViewRegionTextObservation]::new(
    'TEXT_FAR', $mainViewText, 40, 40, 43, 41, 'drawing_text'))
$documents = [System.Collections.Generic.List[Shb.Cad.Core.KnownDocumentRegionObservation]]::new()
$documents.Add([Shb.Cad.Core.KnownDocumentRegionObservation]::new(
    'TECH_REQ_1', 'technical_requirements', 0, -10, 8, -7))

$config = [Shb.Cad.Core.EngineeringViewRegionConfig]::new()
$config.ExplicitClusterGap = 0.25
$result = [Shb.Cad.Core.EngineeringViewRegionAnalyzer]::Analyze(
    $instances, $topology, $frame, $texts, $documents, $config)

Assert-Equal 'computed' $result.Status 'complete evidence produces computed document'
Assert-Equal 4 $result.Regions.Count 'views, standalone document, and sheet scope retained'
Assert-Equal 2 $result.EngineeringViewCandidateCount 'ordinary and authored section candidates'
Assert-Equal 1 $result.DocumentationRegionCount 'known technical-requirements scope'
Assert-Equal 5 $result.EligibleOccurrenceCount 'annotation excluded while sheet structure remains traceable'
Assert-Equal 0 $result.UnassignedOccurrenceCount 'all eligible structural occurrences trace to a region'

$ordinary = @($result.Regions | Where-Object Kind -eq 'engineering_view_candidate')
$section = @($result.Regions | Where-Object Kind -eq 'section_view_candidate')
$documentation = @($result.Regions | Where-Object Kind -eq 'documentation_region')
$sheet = @($result.Regions | Where-Object Kind -eq 'sheet_structure_region')
Assert-Equal 1 $ordinary.Count 'one unlabelled geometry candidate'
Assert-Equal 1 $section.Count 'one authored section candidate'
Assert-Equal 1 $documentation.Count 'one known documentation region'
Assert-Equal 1 $sheet.Count 'one frame-scale sheet structure region'
Assert-Equal 'geometry_scope_without_authored_view_name' $ordinary[0].Subtype `
    'unlabelled geometry is not guessed as main/front view'
Assert-True ($ordinary[0].LabelTexts -notcontains $mainViewText) 'far-away text cannot name a region'
Assert-True ($section[0].LabelTexts -contains $sectionText) 'authored section text retained as evidence'
Assert-True ($documentation[0].KnownDocumentRegionIds -contains 'TECH_REQ_1') `
    'known document object retained as evidence'
Assert-Equal 0 $documentation[0].EdgeIds.Count `
    'known document can stand alone when no structural linework is present'
Assert-True ($sheet[0].OccurrenceIds -contains 'root:ROOT/ent:SHEET_SKELETON') `
    'sheet-scale bridge is retained separately instead of discarded'
Assert-True ($ordinary[0].OccurrenceIds -notcontains 'root:ROOT/ent:CROSS_DIMENSION') `
    'annotation geometry never glues view scopes'
Assert-Near 1 $ordinary[0].LocalFrame.OrthogonalCoverage 0.000001 `
    'axis-aligned view has full orthogonal edge-length coverage'
Assert-True ($ordinary[0].ComponentIds.Count -eq 1 -and $ordinary[0].EdgeIds.Count -ge 6) `
    'region preserves topology evidence rather than only a crop box'
Assert-Equal 'read_only_no_entities_modified' $result.ToMap()['mutation_status'] 'read-only contract'

# Optional regression over saved-fact replay artifacts.
$outRoot = Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad-11-12'
$regressionFiles = @()
if (Test-Path $outRoot) {
    $regressionFiles = @(Get-ChildItem $outRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'engineering-view-regions-replay.json' } |
        Where-Object { Test-Path $_ })
}
foreach ($file in $regressionFiles) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    Assert-Equal 0 $json.unassigned_occurrence_count "all eligible occurrences assigned: $file"
    Assert-Equal 1 @($json.regions | Where-Object region_kind -eq 'sheet_structure_region').Count `
        "one separated sheet scope: $file"
    Assert-Equal 'read_only_no_entities_modified' $json.mutation_status "read-only replay: $file"
}

Write-Host "PASS 13 engineering-view-regions; optional saved-fact regressions=$($regressionFiles.Count)"
