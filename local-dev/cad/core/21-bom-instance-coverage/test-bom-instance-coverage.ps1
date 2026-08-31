$ErrorActionPreference = 'Stop'

$files = @(
    (Join-Path $PSScriptRoot '../04-mechanical-bom-knowledge/MechanicalBomKnowledgeBuilder.cs'),
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../12-planar-topology-kernel/PlanarTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'BomInstanceCoverageAnalyzer.cs')
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

function New-InstanceFacts([object[]]$References, [object[]]$LoosePaths = @()) {
    $drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-bom-coverage')
    $part = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
        'PART_DEF', 'PART', 'block_definition', $false, $false, $false)
    $partEdge = [Shb.Cad.Core.InstanceEntityObservation]::new(
        'PART_EDGE', 'AcDbPolyline', 'Polyline', 'path', 'OUTLINE', $true)
    $partEdge.SetPath((New-PointList @(@(-2,-2), @(2,-2), @(2,2), @(-2,2))), $true, 'exact_linear_polyline') | Out-Null
    $part.AddEntity($partEdge) | Out-Null

    $root = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
        'ROOT', '*MODEL_SPACE', 'model_space', $true, $false, $false)
    foreach ($spec in $References) {
        if ($spec.Mirrored) {
            $transform = [Shb.Cad.Core.InstanceAffineTransformObservation]::new(
                -1, 0, 0, [double]$spec.X,
                 0, 1, 0, [double]$spec.Y,
                 0, 0, 1, 0)
        } else {
            $transform = [Shb.Cad.Core.InstanceAffineTransformObservation]::Translation(
                [double]$spec.X, [double]$spec.Y, 0)
        }
        $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
            [string]$spec.Handle, 'AcDbBlockReference', 'BlockReference', 'block_reference', 'OUTLINE', $true)
        $rowCount = if ($null -eq $spec.Rows) { 1 } else { [int]$spec.Rows }
        $columnCount = if ($null -eq $spec.Columns) { 1 } else { [int]$spec.Columns }
        $rowSpacing = if ($null -eq $spec.RowSpacing) { 0 } else { [double]$spec.RowSpacing }
        $columnSpacing = if ($null -eq $spec.ColumnSpacing) { 0 } else { [double]$spec.ColumnSpacing }
        $entity.SetBlockReference(
            'PART_DEF', 'PART', 'PART_DEF', $transform,
            $rowCount, $columnCount, $rowSpacing, $columnSpacing,
            $false, $false) | Out-Null
        $root.AddEntity($entity) | Out-Null
    }
    $looseIndex = 0
    foreach ($path in $LoosePaths) {
        $looseIndex++
        $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
            "LOOSE_$looseIndex", 'AcDbLine', 'Line', 'line', 'OUTLINE', $true)
        $entity.SetPath((New-PointList $path), $false, 'exact_line') | Out-Null
        $root.AddEntity($entity) | Out-Null
    }
    $drawing.AddDefinition($root) | Out-Null
    $drawing.AddDefinition($part) | Out-Null
    return [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing)
}

function New-Regions(
    [Shb.Cad.Core.BlockInstanceCoordinateDocument]$Instances,
    [double[]]$DocumentationBounds = $null) {
    $topologyConfig = [Shb.Cad.Core.PlanarTopologyConfig]::new()
    $topologyConfig.SnapTolerance = 0.001
    $topologyConfig.GridSize = 0.0001
    $topology = [Shb.Cad.Core.PlanarTopologyAnalyzer]::Analyze($Instances, $topologyConfig)
    $frame = [Shb.Cad.Core.ViewRegionFrameObservation]::new(
        'FRAME', -1000, -1000, 5000, 5000, [string[]]@())
    $documents = [System.Collections.Generic.List[Shb.Cad.Core.KnownDocumentRegionObservation]]::new()
    if ($null -ne $DocumentationBounds) {
        $documents.Add([Shb.Cad.Core.KnownDocumentRegionObservation]::new(
            'DOC_1', 'mechanical_bill_of_materials',
            $DocumentationBounds[0], $DocumentationBounds[1],
            $DocumentationBounds[2], $DocumentationBounds[3]))
    }
    $config = [Shb.Cad.Core.EngineeringViewRegionConfig]::new()
    $config.ExplicitClusterGap = 0.1
    return [Shb.Cad.Core.EngineeringViewRegionAnalyzer]::Analyze(
        $Instances, $topology, $frame,
        [Shb.Cad.Core.ViewRegionTextObservation[]]@(), $documents, $config)
}

function New-Bom([int[]]$ItemNumbers, [object[]]$Annotations) {
    $labelItemNumber = [string][char]0x5E8F + [char]0x53F7
    $labelPartNumber = [string][char]0x4EE3 + [char]0x53F7
    $labelName = [string][char]0x540D + [char]0x79F0
    $labelQuantity = [string][char]0x6570 + [char]0x91CF
    $labelMaterial = [string][char]0x6750 + [char]0x6599
    $labelUnitWeight = [string][char]0x5355 + [char]0x91CD
    $labelTotalWeight = [string][char]0x603B + [char]0x91CD
    $labelRemark = [string][char]0x5907 + [char]0x6CE8
    $rows = [System.Collections.Generic.List[Shb.Cad.Core.MechanicalBomRowObservation]]::new()
    foreach ($itemNumber in $ItemNumbers) {
        $cells = [System.Collections.Generic.List[Shb.Cad.Core.MechanicalBomCellObservation]]::new()
        $values = [ordered]@{}
        $values[$labelItemNumber] = [string]$itemNumber
        $values[$labelPartNumber] = "CODE-$itemNumber"
        $values[$labelName] = "PART-$itemNumber"
        $values[$labelQuantity] = if ($itemNumber -eq 1) { '(3)' } else { '2' }
        $values[$labelMaterial] = 'Q235'
        $values[$labelUnitWeight] = '1.0'
        $values[$labelTotalWeight] = '2.0'
        $values[$labelRemark] = ''
        $cellIndex = 0
        foreach ($entry in $values.GetEnumerator()) {
            $cellIndex++
            $cells.Add([Shb.Cad.Core.MechanicalBomCellObservation]::new(
                [string]$entry.Key, [string]$entry.Value,
                "CELL_${itemNumber}_$cellIndex", $cellIndex, $itemNumber))
        }
        $rows.Add([Shb.Cad.Core.MechanicalBomRowObservation]::new(
            "ROW_$itemNumber", 0, $itemNumber, 0, $itemNumber, 8, $itemNumber + 1,
            [string]$itemNumber, $cells))
    }
    $annotationValues = [System.Collections.Generic.List[Shb.Cad.Core.MechanicalBomAnnotationObservation]]::new()
    foreach ($spec in $Annotations) {
        $annotationValues.Add([Shb.Cad.Core.MechanicalBomAnnotationObservation]::new(
            [int]($spec['Item']),
            "KEY_$($spec['Handle'])",
            [string]($spec['Handle']),
            "ASSOC_$($spec['Handle'])",
            'TH_XuHaoEntity',
            $true,
            [double[]]@([double]($spec['TargetX']), [double]($spec['TargetY'])),
            [double[]]@([double]($spec['NumberX']), [double]($spec['NumberY']))))
    }
    return [Shb.Cad.Core.MechanicalBomKnowledgeBuilder]::Build(
        'synthetic-bom-coverage', $rows, $annotationValues)
}

function Segment-ForItem(
    [Shb.Cad.Core.BomInstanceCoverageDocument]$Document,
    [int]$ItemNumber) {
    $selected = @($Document.Segments | Where-Object {
        @($_.ItemNumbers) -contains $ItemNumber
    })
    return $selected[0]
}

# 1. Three same-definition insertions, two covered by different serials: one remains unpointed.
$instances = New-InstanceFacts @(
    @{ Handle='R1'; X=0; Y=0 },
    @{ Handle='R2'; X=20; Y=0 },
    @{ Handle='R3'; X=40; Y=0 }
)
$bom = New-Bom @(1,2) @(
    @{ Item=1; Handle='B1'; TargetX=-2; TargetY=0; NumberX=1000; NumberY=1000 },
    @{ Item=2; Handle='B2'; TargetX=18; TargetY=0; NumberX=2000; NumberY=1000 }
)
$result = [Shb.Cad.Core.BomInstanceCoverageAnalyzer]::Analyze(
    $bom, $instances, (New-Regions $instances))
$segment = Segment-ForItem $result 1
Assert-Equal 3 $segment.DefinitionInstanceCount 'all same-definition block insertions are enumerated'
Assert-Equal 2 ($segment.PointedCount + $segment.PointedByOtherItemCount) 'two of three insertions have serial evidence'
Assert-Equal 1 $segment.UnpointedCandidateCount 'exactly one same-definition insertion is unpointed'
Assert-Equal '(3)' $segment.BomItems[0].Values['quantity'] 'raw parenthesized BOM quantity is retained'
Assert-Equal 3 $segment.BomItems[0].ParsedValues['quantity']['value'] 'parsed BOM quantity value is retained without verdict'

# 2. Root-space loose line has no /ref: owner and is explicitly not matchable in v1.
$looseInstances = New-InstanceFacts @(
    @{ Handle='REMOTE_BLOCK'; X=1000; Y=1000 }
) @(
    @(@(100,0), @(110,0))
)
$looseBom = New-Bom @(3) @(
    @{ Item=3; Handle='B3'; TargetX=105; TargetY=0; NumberX=1500; NumberY=1500 }
)
$looseResult = [Shb.Cad.Core.BomInstanceCoverageAnalyzer]::Analyze(
    $looseBom, $looseInstances, (New-Regions $looseInstances))
Assert-Equal 'not_matchable_loose_geometry' $looseResult.Segments[0].Status `
    'loose geometry is not guessed into a block class'

# 3. Each MINSERT cell and a mirrored insertion are independent definition instances.
$arrayInstances = New-InstanceFacts @(
    @{ Handle='ARRAY'; X=0; Y=0; Rows=2; Columns=2; RowSpacing=20; ColumnSpacing=20 },
    @{ Handle='MIRROR'; X=100; Y=0; Mirrored=$true }
)
$arrayBom = New-Bom @(4) @(
    @{ Item=4; Handle='B4'; TargetX=-2; TargetY=0; NumberX=1000; NumberY=2000 }
)
$arrayResult = [Shb.Cad.Core.BomInstanceCoverageAnalyzer]::Analyze(
    $arrayBom, $arrayInstances, (New-Regions $arrayInstances))
$arraySegment = $arrayResult.Segments[0]
Assert-Equal 5 $arraySegment.DefinitionInstanceCount 'four MINSERT cells plus mirrored insertion are counted'
Assert-Equal 1 @($arraySegment.Instances | Where-Object Mirrored).Count 'mirrored insertion is retained'
Assert-True (@($arraySegment.Instances | Where-Object { $_.MInsertRow -eq 1 -and $_.MInsertColumn -eq 1 }).Count -eq 1) `
    'MINSERT row and column identity is retained'

# 4. An otherwise unpointed instance in a documentation region is excluded from candidates.
$documentInstances = New-InstanceFacts @(
    @{ Handle='DRAWN'; X=0; Y=0 },
    @{ Handle='BOM_SAMPLE'; X=100; Y=0 }
)
$documentBom = New-Bom @(5) @(
    @{ Item=5; Handle='B5'; TargetX=-2; TargetY=0; NumberX=1000; NumberY=3000 }
)
$documentRegions = New-Regions $documentInstances ([double[]]@(99.8,-0.2,100.2,0.2))
$documentResult = [Shb.Cad.Core.BomInstanceCoverageAnalyzer]::Analyze(
    $documentBom, $documentInstances, $documentRegions)
$documentSegment = $documentResult.Segments[0]
Assert-Equal 1 $documentSegment.DocumentationRegionCount 'documentation insertion is classified as excluded'
Assert-Equal 0 $documentSegment.UnpointedCandidateCount 'documentation insertion is not an unpointed candidate'

# 5. A same-definition insertion pointed by another item is explicit, not silently unpointed.
$otherInstances = New-InstanceFacts @(
    @{ Handle='O1'; X=0; Y=0 },
    @{ Handle='O2'; X=30; Y=0 }
)
$otherBom = New-Bom @(6,7) @(
    @{ Item=6; Handle='B6'; TargetX=-2; TargetY=0; NumberX=1000; NumberY=4000 },
    @{ Item=7; Handle='B7'; TargetX=28; TargetY=0; NumberX=2000; NumberY=4000 }
)
$otherResult = [Shb.Cad.Core.BomInstanceCoverageAnalyzer]::Analyze(
    $otherBom, $otherInstances, (New-Regions $otherInstances))
$otherSegment = Segment-ForItem $otherResult 6
$otherDetail = @($otherSegment.Instances | Where-Object Classification -eq 'pointed_by_other_item')
Assert-Equal 1 $otherDetail.Count 'other serial coverage has a dedicated classification'
Assert-True ($otherDetail[0].PointedItemNumbers -contains 7) 'other item number remains traceable'

Assert-Equal 'read_only_no_entities_modified' $result.ToMap()['mutation_status'] 'read-only contract'
Assert-Equal 'bom_instance_coverage' $result.ToMap()['analysis_type'] 'artifact analysis type'

Write-Host 'PASS 21 bom-instance-coverage; scenarios=5'
