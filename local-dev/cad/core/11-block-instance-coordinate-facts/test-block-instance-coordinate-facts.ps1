$ErrorActionPreference = 'Stop'

$core = Join-Path $PSScriptRoot 'BlockInstanceCoordinateAnalyzer.cs'
Add-Type -Path $core

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
            [double]$coordinate[0], [double]$coordinate[1],
            $(if ($coordinate.Count -gt 2) { [double]$coordinate[2] } else { 0.0 })))
    }
    return ,$result
}

function New-LineEntity(
    [string]$Handle,
    [string]$Layer,
    [double]$Ax,
    [double]$Ay,
    [double]$Bx,
    [double]$By,
    [string]$ColorMode = 'by_layer') {
    $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
        $Handle, 'AcDbLine', 'Line', 'line', $Layer, $true)
    $entity.SetRawStyle(
        [Shb.Cad.Core.InstanceColorObservation]::new($ColorMode, $ColorMode, $null, $null, $null, $null),
        'by_layer', 'ByLayer', 'by_layer', $null) | Out-Null
    $entity.SetPath((New-PointList @(@($Ax, $Ay), @($Bx, $By))), $false, 'exact_linear_segment') | Out-Null
    return $entity
}

$drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-instance')
$drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
    '0',
    [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'white', 7, $null, $null, $null),
    'Continuous', 25, $false, $false)) | Out-Null
$drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
    'PART',
    [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'yellow', 2, $null, $null, $null),
    'DASHED', 50, $false, $false)) | Out-Null

$part = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
    'D1', 'PART_DEF', 'block_definition', $false, $false, $false)
$part.AddEntity((New-LineEntity 'E1' '0' 0 0 10 0 'by_block')) | Out-Null
$drawing.AddDefinition($part) | Out-Null

$root = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
    'R1', '*MODEL_SPACE', 'model_space', $true, $false, $false)
$mirror = [Shb.Cad.Core.InstanceAffineTransformObservation]::new(
    -1, 0, 0, 10,
     0, 1, 0,  0,
     0, 0, 1,  0)
$insert = [Shb.Cad.Core.InstanceEntityObservation]::new(
    'B1', 'AcDbBlockReference', 'BlockReference', 'block_reference', 'PART', $true)
$insert.SetRawStyle(
    [Shb.Cad.Core.InstanceColorObservation]::new('by_layer', 'ByLayer', 256, $null, $null, $null),
    'by_layer', 'ByLayer', 'by_layer', $null) | Out-Null
$insert.SetBlockReference('D1', 'PART_DEF', '', $mirror, 2, 2, 20, 30, $false, $false) | Out-Null
$root.AddEntity($insert) | Out-Null
$drawing.AddDefinition($root) | Out-Null

$roles = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
$roles['E1'] = 'visible_contour'
$document = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing, $roles)

Assert-Equal 8 $document.Occurrences.Count 'four MINSERT references plus four curve occurrences'
Assert-Equal 4 $document.BlockReferenceOccurrenceCount 'MINSERT cell count'
Assert-Equal 4 $document.CurveOccurrenceCount 'definition entity occurs in every MINSERT cell'
Assert-Equal 8 $document.MirroredOccurrenceCount 'mirror parity propagates to reference and child'
Assert-Equal 0 $document.Diagnostics.Count 'valid instance graph has no diagnostics'

$curves = @($document.Occurrences | Where-Object HasWorldPath)
$first = $curves | Where-Object Id -eq 'root:R1/ref:B1[0,0]/ent:E1' | Select-Object -First 1
Assert-True ($null -ne $first) 'stable path selects first MINSERT cell'
Assert-Near 10 $first.WorldPath[0].X 0.000001 'mirror+translation start'
Assert-Near 0 $first.WorldPath[1].X 0.000001 'mirror+translation end'
Assert-Equal 'PART' $first.EffectiveStyle.Layer 'layer 0 inherits insert layer'
Assert-Equal 2 $first.EffectiveStyle.Color.Index 'ByBlock inherits effective insert color'
Assert-Equal 'ByBlock_from_insert' $first.EffectiveStyle.ColorSource 'ByBlock provenance retained'
Assert-Equal 'DASHED' $first.EffectiveStyle.Linetype 'ByLayer resolves after layer-0 inheritance'
Assert-Equal 'visible_contour' $first.SemanticRole '10 semantic role carried to occurrence'
Assert-Equal 'root:R1/ref:B1[0,0]/ent:E1' $first.Id 'stable instance path'

$last = $curves | Where-Object Id -eq 'root:R1/ref:B1[1,1]/ent:E1' | Select-Object -First 1
Assert-True ($null -ne $last) 'stable path selects last MINSERT cell'
Assert-Near -20 $last.WorldPath[0].X 0.000001 'column spacing follows local block axes before mirror'
Assert-Near 20 $last.WorldPath[0].Y 0.000001 'row spacing follows local block axes'

# A recursive definition must terminate deterministically and become evidence.
$cycleDrawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('cycle')
$cycleDrawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
    '0', [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'white', 7, $null, $null, $null),
    'Continuous', 25, $false, $false)) | Out-Null
$cycleRoot = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
    'CR', '*MODEL_SPACE', 'model_space', $true, $false, $false)
$cycleDefinition = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
    'CD', 'CYCLE', 'block_definition', $false, $false, $false)
$toCycle = [Shb.Cad.Core.InstanceEntityObservation]::new(
    'CB1', 'AcDbBlockReference', 'BlockReference', 'block_reference', '0', $true)
$toCycle.SetBlockReference('CD', 'CYCLE', '',
    [Shb.Cad.Core.InstanceAffineTransformObservation]::Identity,
    1, 1, 0, 0, $false, $false) | Out-Null
$self = [Shb.Cad.Core.InstanceEntityObservation]::new(
    'CB2', 'AcDbBlockReference', 'BlockReference', 'block_reference', '0', $true)
$self.SetBlockReference('CD', 'CYCLE', '',
    [Shb.Cad.Core.InstanceAffineTransformObservation]::Identity,
    1, 1, 0, 0, $false, $false) | Out-Null
$cycleRoot.AddEntity($toCycle) | Out-Null
$cycleDefinition.AddEntity($self) | Out-Null
$cycleDrawing.AddDefinition($cycleRoot).AddDefinition($cycleDefinition) | Out-Null
$cycleResult = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($cycleDrawing)
Assert-Equal 1 @($cycleResult.Diagnostics | Where-Object Code -eq 'CYCLIC_BLOCK_REFERENCE').Count `
    'cycle detected instead of infinite traversal'

# Optional regression over outputs produced by the THCAD adapter.
$outRoot = Resolve-Path (Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad')
$regressionFiles = @(Get-ChildItem $outRoot -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'block-instance-coordinate-facts.json' } |
    Where-Object { Test-Path $_ })
foreach ($file in $regressionFiles) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    Assert-True ($json.occurrence_count -ge $json.curve_occurrence_count) "occurrence invariant: $file"
    Assert-True ($json.mirrored_occurrence_count -ge 0) "mirror count present: $file"
    Assert-Equal 'read_only_no_entities_modified' $json.mutation_status "read-only contract: $file"
}

Write-Host "PASS 11 block-instance-coordinate-facts; optional THCAD regressions=$($regressionFiles.Count)"
