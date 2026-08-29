param(
    [string]$InputRoot = (Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad-11-12'),
    [string[]]$DrawingId,
    [string]$SummaryPath
)

$ErrorActionPreference = 'Stop'

$coreFiles = @(
    (Join-Path $PSScriptRoot '../04-mechanical-bom-knowledge/MechanicalBomKnowledgeBuilder.cs'),
    (Join-Path $PSScriptRoot '../05-technical-requirements-extraction/TechnicalRequirementsExtractor.cs'),
    (Join-Path $PSScriptRoot '../08-annotation-identification/AnnotationIdentifier.cs'),
    (Join-Path $PSScriptRoot '../09-dimension-topology/DimensionTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'PlanarTopologyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../13-engineering-view-regions/EngineeringViewRegionAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../14-representation-correspondence/RepresentationCorrespondenceAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../15-representation-identity-resolution/RepresentationIdentityResolver.cs'),
    (Join-Path $PSScriptRoot '../16-manufacturing-profile-features/ManufacturingProfileAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../17-mechanical-interface-adjacency/MechanicalInterfaceAdjacencyAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../18-dimension-geometry-binding/DimensionGeometryBindingAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../19-semantic-drawing-diff/SemanticDrawingDiffAnalyzer.cs'),
    (Join-Path $PSScriptRoot '../19-semantic-drawing-diff/SemanticDrawingSnapshotBuilder.cs'),
    (Join-Path $PSScriptRoot '../20-cross-drawing-interface-graph/CrossDrawingInterfaceGraphModels.cs'),
    (Join-Path $PSScriptRoot '../20-cross-drawing-interface-graph/CrossDrawingProjectInputBuilder.cs'),
    (Join-Path $PSScriptRoot '../20-cross-drawing-interface-graph/CrossDrawingInterfaceGraphAnalyzer.cs')
)
Add-Type -Path $coreFiles

function Get-SavedFieldValue($Fields, [string[]]$Names) {
    if ($null -eq $Fields) { return '' }
    foreach ($name in $Names) {
        $property = $Fields.PSObject.Properties[$name]
        if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
            return ([string]$property.Value).Trim()
        }
    }
    return ''
}

$inputDirectory = (Resolve-Path $InputRoot).Path
if ([string]::IsNullOrWhiteSpace($SummaryPath)) {
    $SummaryPath = Join-Path $inputDirectory '_planar-topology-replay-summary.json'
}

$requested = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($value in @($DrawingId)) {
    if (-not [string]::IsNullOrWhiteSpace($value)) { [void]$requested.Add($value) }
}

$factFiles = @(Get-ChildItem $inputDirectory -Directory |
    Sort-Object Name |
    ForEach-Object {
        $file = Join-Path $_.FullName 'block-instance-coordinate-facts.json'
        if (Test-Path $file) { Get-Item $file }
    } |
    Where-Object {
        $requested.Count -eq 0 -or $requested.Contains($_.Directory.Name)
    })
if ($factFiles.Count -eq 0) {
    throw "No block-instance-coordinate-facts.json matched under $inputDirectory"
}

$summaries = [System.Collections.Generic.List[object]]::new()
$crossDrawingObservations = [System.Collections.Generic.List[Shb.Cad.Core.CrossDrawingDrawingObservation]]::new()
foreach ($factFile in $factFiles) {
    $started = [DateTime]::UtcNow
    Write-Host "REPLAY START $($factFile.Directory.Name)"
    $jsonText = [IO.File]::ReadAllText(
        $factFile.FullName,
        [Text.UTF8Encoding]::new($false, $true))
    $facts = $jsonText | ConvertFrom-Json

    $dimensionObservations = [System.Collections.Generic.List[Shb.Cad.Core.DimensionTopologyObservation]]::new()
    $savedDimensionPath = Join-Path $factFile.Directory.FullName 'dimension-topology.json'
    if (Test-Path $savedDimensionPath) {
        $savedDimensions = [IO.File]::ReadAllText($savedDimensionPath) | ConvertFrom-Json
        foreach ($edge in @($savedDimensions.edges)) {
            $observation = [Shb.Cad.Core.DimensionTopologyObservation]::new(
                [string]$edge.handle,
                [string]$edge.runtime_class,
                [string]$edge.dimension_type,
                [string]$edge.layer,
                [string]$edge.owner_scope,
                [string]$edge.owner_block_name)
            if ($null -eq $edge.measurement) {
                $observation.SetMeasurement(
                    $null,
                    [string]$edge.dimension_text,
                    [string]$edge.dimension_style) | Out-Null
            } else {
                $observation.SetMeasurement(
                    [double]$edge.measurement,
                    [string]$edge.dimension_text,
                    [string]$edge.dimension_style) | Out-Null
            }
            if (@($edge.axis).Count -ge 2) {
                $observation.SetAxisAngle([Math]::Atan2(
                    [double]$edge.axis[1],
                    [double]$edge.axis[0])) | Out-Null
            }
            if (@($edge.definition_points.xline1).Count -ge 2) {
                $observation.SetXLine1Point(
                    [double]$edge.definition_points.xline1[0],
                    [double]$edge.definition_points.xline1[1]) | Out-Null
            }
            if (@($edge.definition_points.xline2).Count -ge 2) {
                $observation.SetXLine2Point(
                    [double]$edge.definition_points.xline2[0],
                    [double]$edge.definition_points.xline2[1]) | Out-Null
            }
            if (@($edge.definition_points.dimension_line).Count -ge 2) {
                $observation.SetDimensionLinePoint(
                    [double]$edge.definition_points.dimension_line[0],
                    [double]$edge.definition_points.dimension_line[1]) | Out-Null
            }
            if ($null -ne $edge.definition_points.text_position -and
                @($edge.definition_points.text_position).Count -ge 2) {
                $observation.SetTextPosition(
                    [double]$edge.definition_points.text_position[0],
                    [double]$edge.definition_points.text_position[1]) | Out-Null
            }
            $observation.SetAssociationHandle([string]$edge.association_handle) | Out-Null
            if ($null -ne $edge.linear_measurement_factor) {
                $observation.SetLinearMeasurementFactor(
                    [double]$edge.linear_measurement_factor) | Out-Null
            }
            $dimensionObservations.Add($observation)
        }
    }
    $dimensionTopology = [Shb.Cad.Core.DimensionTopologyAnalyzer]::Analyze(
        [string]$facts.drawing_id,
        $dimensionObservations,
        [System.Collections.Generic.List[Shb.Cad.Core.DimensionReferenceAxisObservation]]::new())
    $dimensionEdgesByHandle = [System.Collections.Generic.Dictionary[string,Shb.Cad.Core.DimensionEdgeRecord]]::new(
        [StringComparer]::OrdinalIgnoreCase)
    foreach ($edge in $dimensionTopology.Edges) {
        $dimensionEdgesByHandle[$edge.Handle] = $edge
    }
    $dimensionPlacements = [System.Collections.Generic.List[Shb.Cad.Core.DimensionGeometryPlacementObservation]]::new()
    foreach ($occurrence in @($facts.occurrences)) {
        $dimensionEdge = $null
        if (-not $dimensionEdgesByHandle.TryGetValue([string]$occurrence.source_handle, [ref]$dimensionEdge)) {
            continue
        }
        $transformValues = @($occurrence.world_transform)
        if ($transformValues.Count -ne 12) { continue }
        $transform = [Shb.Cad.Core.InstanceAffineTransformObservation]::new(
            [double]$transformValues[0], [double]$transformValues[1],
            [double]$transformValues[2], [double]$transformValues[3],
            [double]$transformValues[4], [double]$transformValues[5],
            [double]$transformValues[6], [double]$transformValues[7],
            [double]$transformValues[8], [double]$transformValues[9],
            [double]$transformValues[10], [double]$transformValues[11])
        $path = [System.Collections.Generic.List[string]]::new()
        foreach ($value in @($occurrence.instance_path)) { $path.Add([string]$value) }
        $dimensionPlacements.Add(
            [Shb.Cad.Core.DimensionGeometryBindingAnalyzer]::CreatePlacement(
                $dimensionEdge,
                [string]$occurrence.occurrence_id,
                [string]$occurrence.source_definition_handle,
                [string]$occurrence.source_definition_name,
                $path,
                $transform,
                [bool]$occurrence.visible,
                [string]$occurrence.status))
    }

    $frameSourceHandles = [System.Collections.Generic.HashSet[string]]::new(
        [StringComparer]::OrdinalIgnoreCase)
    $primaryFrame = $null
    $frameFactsPath = Join-Path $factFile.Directory.FullName 'drawing-frames.json'
    if (Test-Path $frameFactsPath) {
        $frameFacts = [IO.File]::ReadAllText($frameFactsPath) | ConvertFrom-Json
        $primaryFrame = @($frameFacts.frames |
            Where-Object is_outermost |
            Sort-Object area -Descending |
            Select-Object -First 1)
        if ($primaryFrame.Count -gt 0) {
            $primaryFrame = $primaryFrame[0]
            foreach ($property in $primaryFrame.edge_handles.PSObject.Properties) {
                if (-not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
                    [void]$frameSourceHandles.Add([string]$property.Value)
                }
            }
        } else {
            $primaryFrame = $null
        }
    }

    $drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new([string]$facts.drawing_id)
    $drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
        '0',
        [Shb.Cad.Core.InstanceColorObservation]::new(
            'explicit', 'white', 7, $null, $null, $null),
        'Continuous', 25, $false, $false)) | Out-Null
    $root = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
        'REPLAY', '*MODEL_SPACE', 'model_space', $true, $false, $false)
    $roles = [System.Collections.Generic.Dictionary[string,string]]::new(
        [StringComparer]::OrdinalIgnoreCase)
    $replayedFrameHandles = [System.Collections.Generic.List[string]]::new()

    $occurrenceIndex = 0
    foreach ($occurrence in @($facts.occurrences)) {
        $worldPath = @($occurrence.world_path)
        if ($worldPath.Count -lt 2) { continue }
        $handle = 'R' + $occurrenceIndex.ToString('X8')
        $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
            $handle,
            [string]$occurrence.runtime_class,
            [string]$occurrence.managed_type,
            [string]$occurrence.geometry_kind,
            '0',
            [bool]$occurrence.visible)
        $entity.SetRawStyle(
            [Shb.Cad.Core.InstanceColorObservation]::new(
                'explicit', 'white', 7, $null, $null, $null),
            'explicit', 'Continuous', 'explicit', 25) | Out-Null
        $points = [System.Collections.Generic.List[Shb.Cad.Core.InstancePoint3Observation]]::new()
        foreach ($coordinate in $worldPath) {
            $x = [double]$coordinate[0]
            $y = [double]$coordinate[1]
            $z = if (@($coordinate).Count -gt 2) { [double]$coordinate[2] } else { 0.0 }
            $points.Add([Shb.Cad.Core.InstancePoint3Observation]::new($x, $y, $z))
        }
        $entity.SetPath(
            $points,
            [bool]$occurrence.closed,
            [string]$occurrence.geometry_quality) | Out-Null
        $root.AddEntity($entity) | Out-Null
        $roles[$handle] = [string]$occurrence.semantic_role
        if ($frameSourceHandles.Contains([string]$occurrence.source_handle)) {
            $replayedFrameHandles.Add($handle)
        }
        $occurrenceIndex++
    }
    $drawing.AddDefinition($root) | Out-Null

    $instances = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing, $roles)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $topology = [Shb.Cad.Core.PlanarTopologyAnalyzer]::Analyze($instances)
    $watch.Stop()

    $viewFrame = $null
    if ($null -ne $primaryFrame) {
        $viewFrame = [Shb.Cad.Core.ViewRegionFrameObservation]::new(
            [string]$primaryFrame.id,
            [double]$primaryFrame.min[0],
            [double]$primaryFrame.min[1],
            [double]$primaryFrame.max[0],
            [double]$primaryFrame.max[1],
            $replayedFrameHandles)
    }
    $viewTexts = [System.Collections.Generic.List[Shb.Cad.Core.ViewRegionTextObservation]]::new()
    $knownDocumentRegions = [System.Collections.Generic.List[Shb.Cad.Core.KnownDocumentRegionObservation]]::new()
    $entitiesPath = Join-Path $factFile.Directory.FullName 'entities.jsonl'
    if (Test-Path $entitiesPath) {
        foreach ($line in [IO.File]::ReadLines($entitiesPath)) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try { $record = $line | ConvertFrom-Json } catch { continue }
            if ([string]$record.owner_scope -eq 'model_space' -and
                [string]$record.geometry.block_name -eq 'PC_TITLE_BLOCK' -and
                $null -ne $record.bbox -and @($record.bbox.min).Count -ge 2 -and
                @($record.bbox.max).Count -ge 2) {
                $knownDocumentRegions.Add([Shb.Cad.Core.KnownDocumentRegionObservation]::new(
                    ('title-block:' + [string]$record.handle),
                    'title_block',
                    [double]$record.bbox.min[0],
                    [double]$record.bbox.min[1],
                    [double]$record.bbox.max[0],
                    [double]$record.bbox.max[1]))
            }
            if ([string]$record.owner_scope -ne 'model_space' -or $null -eq $record.text -or
                $null -eq $record.bbox -or @($record.bbox.min).Count -lt 2 -or
                @($record.bbox.max).Count -lt 2) { continue }
            $plain = [string]$record.text.plain
            if ([string]::IsNullOrWhiteSpace($plain)) { continue }
            $viewTexts.Add([Shb.Cad.Core.ViewRegionTextObservation]::new(
                [string]$record.handle,
                $plain,
                [double]$record.bbox.min[0],
                [double]$record.bbox.min[1],
                [double]$record.bbox.max[0],
                [double]$record.bbox.max[1],
                'saved_entity_text'))
        }
    }
    $technicalPath = Join-Path $factFile.Directory.FullName 'technical-requirements.json'
    if (Test-Path $technicalPath) {
        $technicalFacts = [IO.File]::ReadAllText($technicalPath) | ConvertFrom-Json
        foreach ($section in @($technicalFacts.sections)) {
            if ($null -eq $section.bounds) { continue }
            $knownDocumentRegions.Add([Shb.Cad.Core.KnownDocumentRegionObservation]::new(
                [string]$section.id,
                'technical_requirements',
                [double]$section.bounds.min[0],
                [double]$section.bounds.min[1],
                [double]$section.bounds.max[0],
                [double]$section.bounds.max[1]))
        }
    }
    $bomPath = Join-Path $factFile.Directory.FullName 'bom-knowledge.json'
    if (Test-Path $bomPath) {
        $bomFacts = [IO.File]::ReadAllText($bomPath) | ConvertFrom-Json
        foreach ($table in @($bomFacts.tables)) {
            if ($null -eq $table.bounds) { continue }
            $knownDocumentRegions.Add([Shb.Cad.Core.KnownDocumentRegionObservation]::new(
                [string]$table.id,
                'mechanical_bill_of_materials',
                [double]$table.bounds.min[0],
                [double]$table.bounds.min[1],
                [double]$table.bounds.max[0],
                [double]$table.bounds.max[1]))
        }
    }
    $viewWatch = [Diagnostics.Stopwatch]::StartNew()
    $viewRegions = [Shb.Cad.Core.EngineeringViewRegionAnalyzer]::Analyze(
        $instances,
        $topology,
        $viewFrame,
        $viewTexts,
        $knownDocumentRegions)
    $viewWatch.Stop()
    $correspondenceWatch = [Diagnostics.Stopwatch]::StartNew()
    $correspondence = [Shb.Cad.Core.RepresentationCorrespondenceAnalyzer]::Analyze(
        $viewRegions,
        $topology)
    $correspondenceWatch.Stop()
    $identityWatch = [Diagnostics.Stopwatch]::StartNew()
    $identity = [Shb.Cad.Core.RepresentationIdentityResolver]::Analyze(
        $viewRegions,
        $correspondence)
    $identityWatch.Stop()
    $manufacturingWatch = [Diagnostics.Stopwatch]::StartNew()
    $manufacturingProfiles = [Shb.Cad.Core.ManufacturingProfileAnalyzer]::Analyze(
        $viewRegions,
        $topology,
        $identity)
    $manufacturingWatch.Stop()
    $interfaceWatch = [Diagnostics.Stopwatch]::StartNew()
    $mechanicalInterfaces = [Shb.Cad.Core.MechanicalInterfaceAdjacencyAnalyzer]::Analyze(
        $viewRegions,
        $topology,
        $identity,
        $manufacturingProfiles)
    $interfaceWatch.Stop()
    $dimensionGeometryWatch = [Diagnostics.Stopwatch]::StartNew()
    $dimensionGeometryBindings = [Shb.Cad.Core.DimensionGeometryBindingAnalyzer]::Analyze(
        $dimensionTopology,
        $dimensionPlacements,
        $viewRegions,
        $topology,
        $manufacturingProfiles,
        $mechanicalInterfaces)
    $dimensionGeometryWatch.Stop()

    $semanticDrawingIdentity = [Shb.Cad.Core.SemanticDrawingIdentityObservation]::new(
        [string]$facts.drawing_id)
    $semanticDrawingIdentity.SetSource($factFile.Directory.FullName, 'saved_fact_directory') | Out-Null
    $semanticObjectPath = Join-Path $factFile.Directory.FullName 'semantic-objects.json'
    if (Test-Path $semanticObjectPath) {
        $savedSemanticObjects = [IO.File]::ReadAllText($semanticObjectPath) | ConvertFrom-Json
        $savedTitle = @($savedSemanticObjects.title_blocks | Where-Object { $null -ne $_ }) |
            Select-Object -First 1
        if ($null -ne $savedTitle) {
            $drawingNumber = Get-SavedFieldValue $savedTitle.fields @('图样代号', '图号', 'DRAWING_NUMBER')
            $drawingName = Get-SavedFieldValue $savedTitle.fields @('图样名称', '图名', 'DRAWING_NAME')
            $productModel = Get-SavedFieldValue $savedTitle.fields @('产品型号', '型号', 'PRODUCT_MODEL')
            $sheet = Get-SavedFieldValue $savedTitle.fields @('第几页', '页码', 'SHEET')
            $sheetCount = Get-SavedFieldValue $savedTitle.fields @('共几页', '总页数', 'SHEET_COUNT')
            $revision = Get-SavedFieldValue $savedTitle.fields @(
                '改版标记4', '改版标记3', '改版标记2', '改版标记1',
                '版次', '版本', 'REVISION', 'REV', '标记4', '标记3', '标记2', '标记1')
            if (-not [string]::IsNullOrWhiteSpace($drawingNumber)) {
                $semanticDrawingIdentity.SetDrawingNumber($drawingNumber, 'saved_title_block.图样代号') | Out-Null
            }
            if (-not [string]::IsNullOrWhiteSpace($drawingName)) {
                $semanticDrawingIdentity.SetDrawingName($drawingName, 'saved_title_block.图样名称') | Out-Null
            }
            if (-not [string]::IsNullOrWhiteSpace($productModel)) {
                $semanticDrawingIdentity.SetProductModel($productModel, 'saved_title_block.产品型号') | Out-Null
            }
            if (-not [string]::IsNullOrWhiteSpace($sheet) -or
                -not [string]::IsNullOrWhiteSpace($sheetCount)) {
                $semanticDrawingIdentity.SetSheet($sheet, $sheetCount, 'saved_title_block.页码') | Out-Null
            }
            if (-not [string]::IsNullOrWhiteSpace($revision)) {
                $semanticDrawingIdentity.SetRevision($revision, 'saved_title_block.改版标记') | Out-Null
            }
        }
    }
    $semanticSnapshotWatch = [Diagnostics.Stopwatch]::StartNew()
    $semanticDrawingSnapshot = [Shb.Cad.Core.SemanticDrawingSnapshotBuilder]::Create(
        $semanticDrawingIdentity,
        $instances,
        $viewRegions,
        $manufacturingProfiles,
        $mechanicalInterfaces,
        $dimensionGeometryBindings,
        $null)
    $semanticSnapshotWatch.Stop()
    $semanticSelfDiffWatch = [Diagnostics.Stopwatch]::StartNew()
    $semanticDrawingSelfDiff = [Shb.Cad.Core.SemanticDrawingDiffAnalyzer]::Analyze(
        $semanticDrawingSnapshot,
        $semanticDrawingSnapshot)
    $semanticSelfDiffWatch.Stop()
    if ($semanticDrawingSelfDiff.ChangedElementCount -ne 0 -or
        $semanticDrawingSelfDiff.AddedCandidateCount -ne 0 -or
        $semanticDrawingSelfDiff.RemovedCandidateCount -ne 0 -or
        $semanticDrawingSelfDiff.AmbiguousMatches.Count -ne 0) {
        throw "Semantic snapshot self-diff invariant failed for $($facts.drawing_id)"
    }
    $crossDrawingObservationWatch = [Diagnostics.Stopwatch]::StartNew()
    $crossDrawingObservation =
        [Shb.Cad.Core.CrossDrawingProjectInputBuilder]::FromSemanticSnapshot(
            $semanticDrawingSnapshot)
    $drawingMetadataPath = Join-Path $factFile.Directory.FullName 'drawing.json'
    if (Test-Path $drawingMetadataPath) {
        $savedDrawingMetadata = [IO.File]::ReadAllText($drawingMetadataPath) | ConvertFrom-Json
        $crossDrawingObservation.SetUnitContext(
            [string]$savedDrawingMetadata.insunits,
            [string]$savedDrawingMetadata.measurement,
            $false,
            'saved_dwg_unit_metadata_preserved_but_cross_file_geometry_scale_not_proven') | Out-Null
        foreach ($block in @($savedDrawingMetadata.block_inventory | Where-Object {
            [bool]$_.is_from_xref
        })) {
            $xrefPath = [string]$block.xref_path
            $xrefStem = if ([string]::IsNullOrWhiteSpace($xrefPath)) {
                [string]$block.name
            } else {
                [IO.Path]::GetFileNameWithoutExtension($xrefPath)
            }
            if ([string]::IsNullOrWhiteSpace($xrefStem)) { continue }
            $xrefCode = $xrefStem
            $xrefSheet = ''
            if ($xrefStem -match '^(.*)_([1-9][0-9]*)$') {
                $xrefCode = $Matches[1]
                $xrefSheet = $Matches[2]
            }
            $xrefReference =
                [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
                    ('component-ref:xref:replay:' + [string]$facts.drawing_id + ':' +
                        [string]$block.handle),
                    $xrefCode,
                    'authored_external_reference',
                    ('xref-block:' + [string]$block.handle))
            $xrefReference.SetBomContext('', [string]$block.name, '') | Out-Null
            $xrefReference.SetReferenceQualifier($xrefSheet, '') | Out-Null
            $xrefReference.SetSourceText($xrefPath) | Out-Null
            $xrefReference.AddSourceHandle([string]$block.handle) | Out-Null
            $crossDrawingObservation.AddComponentReference($xrefReference) | Out-Null
        }
    }
    $savedBomPath = Join-Path $factFile.Directory.FullName 'bom-knowledge.json'
    if (Test-Path $savedBomPath) {
        $savedBom = [IO.File]::ReadAllText($savedBomPath) | ConvertFrom-Json
        foreach ($table in @($savedBom.tables)) {
            foreach ($row in @($table.rows)) {
                $partNumber = [string]$row.values.part_number
                if ([string]::IsNullOrWhiteSpace($partNumber)) { continue }
                $referenceId = 'component-ref:replay:' + [string]$facts.drawing_id + ':' +
                    [string]$row.id
                $componentReference =
                    [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
                        $referenceId,
                        $partNumber.Trim(),
                        'authored_bom_part_number',
                        [string]$row.id)
                $componentReference.SetBomContext(
                    [string]$row.item_number,
                    [string]$row.values.name,
                    [string]$row.values.quantity) | Out-Null
                $componentReference.AddSourceId([string]$row.id) | Out-Null
                if ($null -ne $row.evidence) {
                    $componentReference.AddSourceHandle(
                        [string]$row.evidence.row_block_handle) | Out-Null
                    foreach ($cell in @($row.evidence.cell_handles.PSObject.Properties)) {
                        $componentReference.AddSourceHandle([string]$cell.Value) | Out-Null
                    }
                }
                $annotations = @($row.annotations | Where-Object {
                    $null -ne $_.pointing_position -and $_.pointing_position.Count -ge 2
                })
                if ($annotations.Count -eq 1) {
                    $componentReference.SetPointer(
                        [double]$annotations[0].pointing_position[0],
                        [double]$annotations[0].pointing_position[1]) | Out-Null
                }
                foreach ($annotation in @($row.annotations)) {
                    $componentReference.AddSourceHandle(
                        [string]$annotation.xuhao_handle) | Out-Null
                    $componentReference.AddSourceHandle(
                        [string]$annotation.association_record_handle) | Out-Null
                }
                $crossDrawingObservation.AddComponentReference($componentReference) | Out-Null
            }
        }
    }
    $crossDrawingObservationWatch.Stop()
    $crossDrawingObservations.Add($crossDrawingObservation)

    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'engineering-view-regions-replay.json'),
        (($viewRegions.ToMap() | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'representation-correspondence-replay.json'),
        (($correspondence.ToMap() | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'representation-identity-resolution-replay.json'),
        (($identity.ToMap() | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'manufacturing-profile-features-replay.json'),
        (($manufacturingProfiles.ToMap() | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'mechanical-interface-adjacency-replay.json'),
        (($mechanicalInterfaces.ToMap() | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'dimension-geometry-binding-replay.json'),
        (($dimensionGeometryBindings.ToMap() | ConvertTo-Json -Depth 14) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'semantic-drawing-snapshot-replay.json'),
        (($semanticDrawingSnapshot.ToMap() | ConvertTo-Json -Depth 16) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'semantic-drawing-self-diff-replay.json'),
        (($semanticDrawingSelfDiff.ToMap() | ConvertTo-Json -Depth 16) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'cross-drawing-observation-replay.json'),
        (($crossDrawingObservation.ToMap() | ConvertTo-Json -Depth 16) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(
        (Join-Path $factFile.Directory.FullName 'cross-drawing-observation-replay.md'),
        ($crossDrawingObservation.ToMarkdown() + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))

    $diagnosticCounts = @($topology.Diagnostics |
        Group-Object Code |
        Sort-Object @{ Expression = 'Count'; Descending = $true }, Name |
        ForEach-Object {
            [ordered]@{ code = $_.Name; count = $_.Count }
        })
    $validations = @($topology.Validations | ForEach-Object {
        [ordered]@{
            name = $_.Name
            passed = $_.Passed
            actual = $_.Actual
            expected = $_.Expected
        }
    })
    $stageElapsed = [ordered]@{}
    foreach ($entry in $topology.StageElapsedMilliseconds.GetEnumerator() | Sort-Object Key) {
        $stageElapsed[$entry.Key] = [Math]::Round($entry.Value, 3)
    }
    $summary = [ordered]@{
        drawing_id = [string]$facts.drawing_id
        source_artifact = $factFile.FullName
        replayed_curve_occurrence_count = $occurrenceIndex
        status = $topology.Status
        elapsed_ms = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
        input_segment_count = $topology.InputSegmentCount
        vertex_count = $topology.Vertices.Count
        edge_count = $topology.Edges.Count
        halfedge_count = $topology.HalfEdges.Count
        bounded_face_count = $topology.Faces.Count
        component_count = $topology.Components.Count
        ring_count = $topology.RingCount
        degenerate_ring_count = $topology.DegenerateRingCount
        unresolved_cycle_count = $topology.UnresolvedCycleCount
        intersection_count = $topology.IntersectionCount
        collinear_overlap_count = $topology.CollinearOverlapCount
        nontrivial_snap_cluster_count = $topology.SnapClusters.Count
        diagnostic_counts = $diagnosticCounts
        validations = $validations
        stage_elapsed_ms = $stageElapsed
        engineering_view_regions = [ordered]@{
            status = $viewRegions.Status
            elapsed_ms = [Math]::Round($viewWatch.Elapsed.TotalMilliseconds, 1)
            cluster_gap = $viewRegions.ClusterGap
            atom_count = $viewRegions.AtomCount
            region_count = $viewRegions.Regions.Count
            engineering_view_candidate_count = $viewRegions.EngineeringViewCandidateCount
            documentation_region_count = $viewRegions.DocumentationRegionCount
            unassigned_occurrence_count = $viewRegions.UnassignedOccurrenceCount
            kind_counts = $viewRegions.KindCounts
            diagnostic_count = $viewRegions.Diagnostics.Count
        }
        representation_correspondence = [ordered]@{
            status = $correspondence.Status
            elapsed_ms = [Math]::Round($correspondenceWatch.Elapsed.TotalMilliseconds, 1)
            signature_count = $correspondence.RegionSignatures.Count
            evaluated_pair_count = $correspondence.EvaluatedPairCount
            repeated_family_count = $correspondence.RepeatedFamilies.Count
            repeated_geometry_relation_count = $correspondence.RepeatedGeometryRelationCount
            orthographic_projection_relation_count = $correspondence.OrthographicProjectionRelationCount
            supported_projection_relation_count = @($correspondence.Relations |
                Where-Object { $_.Kind -eq 'orthographic_projection_candidate' -and
                    $_.Status -eq 'supported_geometry_relation' }).Count
            ambiguous_relation_count = @($correspondence.Relations |
                Where-Object Status -eq 'ambiguous').Count
            diagnostic_count = $correspondence.Diagnostics.Count
        }
        representation_identity_resolution = [ordered]@{
            status = $identity.Status
            elapsed_ms = [Math]::Round($identityWatch.Elapsed.TotalMilliseconds, 1)
            representation_count = $identity.Representations.Count
            assertion_count = $identity.Assertions.Count
            same_object_supported_assertion_count = $identity.SupportedObjectAssertionCount
            same_object_possible_assertion_count = $identity.PossibleObjectAssertionCount
            different_object_constraint_count = $identity.DifferentObjectConstraintCount
            physical_object_cluster_count = $identity.PhysicalObjectClusters.Count
            merged_physical_object_cluster_count = @($identity.PhysicalObjectClusters |
                Where-Object { $_.RepresentationIds.Count -gt 1 }).Count
            same_object_possible_group_count = $identity.SameObjectPossibleGroups.Count
            type_candidate_group_count = $identity.TypeCandidateGroups.Count
            blocked_merge_count = $identity.BlockedMerges.Count
            diagnostic_count = $identity.Diagnostics.Count
        }
        manufacturing_profile_features = [ordered]@{
            status = $manufacturingProfiles.Status
            elapsed_ms = [Math]::Round($manufacturingWatch.Elapsed.TotalMilliseconds, 1)
            input_face_count = $manufacturingProfiles.InputFaceCount
            assigned_profile_count = $manufacturingProfiles.Profiles.Count
            unassigned_face_count = $manufacturingProfiles.UnassignedFaceCount
            void_boundary_candidate_count = $manufacturingProfiles.VoidBoundaries.Count
            circular_void_boundary_candidate_count =
                $manufacturingProfiles.CircularVoidBoundaryCount
            profile_adjacency_count = $manufacturingProfiles.Adjacencies.Count
            repeated_feature_group_count =
                $manufacturingProfiles.RepeatedFeatureGroups.Count
            open_boundary_candidate_count = $manufacturingProfiles.OpenBoundaries.Count
            object_summary_count = $manufacturingProfiles.ObjectSummaries.Count
            diagnostic_count = $manufacturingProfiles.Diagnostics.Count
        }
        mechanical_interface_adjacency = [ordered]@{
            status = $mechanicalInterfaces.Status
            elapsed_ms = [Math]::Round($interfaceWatch.Elapsed.TotalMilliseconds, 1)
            input_feature_candidate_count =
                $mechanicalInterfaces.InputFeatureCandidateCount
            interface_feature_candidate_count = $mechanicalInterfaces.Features.Count
            unresolved_feature_candidate_count =
                $mechanicalInterfaces.UnresolvedFeatureCandidateCount
            circular_feature_candidate_count =
                $mechanicalInterfaces.CircularFeatureCount
            interface_pattern_count = $mechanicalInterfaces.Patterns.Count
            coaxial_pattern_candidate_count = $mechanicalInterfaces.CoaxialPatternCount
            aligned_nested_pattern_candidate_count =
                $mechanicalInterfaces.AlignedNestedPatternCount
            repeated_pattern_candidate_count =
                $mechanicalInterfaces.RepeatedPatternCount
            adjacency_evidence_count = $mechanicalInterfaces.Adjacencies.Count
            coincident_multi_source_boundary_candidate_count =
                $mechanicalInterfaces.CoincidentBoundaryCount
            open_terminal_approach_candidate_count =
                $mechanicalInterfaces.TerminalApproachCount
            object_summary_count = $mechanicalInterfaces.ObjectSummaries.Count
            diagnostic_count = $mechanicalInterfaces.Diagnostics.Count
        }
        dimension_geometry_binding = [ordered]@{
            status = $dimensionGeometryBindings.Status
            elapsed_ms = [Math]::Round($dimensionGeometryWatch.Elapsed.TotalMilliseconds, 1)
            input_dimension_count = $dimensionGeometryBindings.InputDimensionCount
            input_placement_count = $dimensionGeometryBindings.InputPlacementCount
            processed_placement_count = $dimensionGeometryBindings.ProcessedPlacementCount
            unplaced_source_dimension_count =
                $dimensionGeometryBindings.UnplacedSourceDimensionHandles.Count
            unique_binding_count = $dimensionGeometryBindings.UniqueBindingCount
            ambiguous_binding_count = $dimensionGeometryBindings.AmbiguousBindingCount
            partial_binding_count = $dimensionGeometryBindings.PartialBindingCount
            unbound_placement_count = $dimensionGeometryBindings.UnboundPlacementCount
            comparable_binding_count = $dimensionGeometryBindings.ComparableBindingCount
            numeric_text_override_count = $dimensionGeometryBindings.NumericOverrideCount
            outside_tolerance_candidate_count =
                $dimensionGeometryBindings.OutsideToleranceCandidateCount
            display_scale_hypothesis_count =
                $dimensionGeometryBindings.DisplayScaleHypotheses.Count
            scale_explained_outside_candidate_count =
                $dimensionGeometryBindings.ScaleExplainedOutsideCandidateCount
            unexplained_outside_candidate_count =
                $dimensionGeometryBindings.UnexplainedOutsideCandidateCount
            object_summary_count = $dimensionGeometryBindings.ObjectSummaries.Count
            diagnostic_count = $dimensionGeometryBindings.Diagnostics.Count
        }
        semantic_drawing_snapshot = [ordered]@{
            status = $semanticDrawingSnapshot.Status
            elapsed_ms = [Math]::Round($semanticSnapshotWatch.Elapsed.TotalMilliseconds, 1)
            snapshot_id = $semanticDrawingSnapshot.SnapshotId
            drawing_key = $semanticDrawingSnapshot.Identity.DrawingKey
            authored_drawing_number = $semanticDrawingSnapshot.Identity.DrawingNumber
            authored_revision = $semanticDrawingSnapshot.Identity.Revision
            element_count = $semanticDrawingSnapshot.Elements.Count
            domain_counts = $semanticDrawingSnapshot.DomainCounts
            issue_count = $semanticDrawingSnapshot.Issues.Count
            diagnostic_count = $semanticDrawingSnapshot.Diagnostics.Count
            truncated = $semanticDrawingSnapshot.Truncated
        }
        semantic_drawing_self_diff = [ordered]@{
            status = $semanticDrawingSelfDiff.Status
            elapsed_ms = [Math]::Round($semanticSelfDiffWatch.Elapsed.TotalMilliseconds, 1)
            identity_status = $semanticDrawingSelfDiff.Identity.Status
            matched_element_count = $semanticDrawingSelfDiff.MatchedElementCount
            unchanged_element_count = $semanticDrawingSelfDiff.UnchangedElementCount
            changed_element_count = $semanticDrawingSelfDiff.ChangedElementCount
            added_candidate_count = $semanticDrawingSelfDiff.AddedCandidateCount
            removed_candidate_count = $semanticDrawingSelfDiff.RemovedCandidateCount
            ambiguous_match_count = $semanticDrawingSelfDiff.AmbiguousMatches.Count
            invariant_passed = $true
        }
        cross_drawing_observation = [ordered]@{
            elapsed_ms = [Math]::Round($crossDrawingObservationWatch.Elapsed.TotalMilliseconds, 1)
            drawing_node_id = $crossDrawingObservation.NodeId
            component_reference_count = $crossDrawingObservation.ComponentReferences.Count
            interface_reference_count = $crossDrawingObservation.Interfaces.Count
            project_graph_status = 'requires_multiple_drawing_observations'
        }
        source_mutation_status = 'read_only_saved_facts_only'
        completed_at = [DateTime]::UtcNow.ToString('o')
    }
    $summaries.Add([pscustomobject]$summary)
    [IO.File]::WriteAllText(
        $SummaryPath,
        (($summaries | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    Write-Host ("REPLAY DONE {0} status={1} segments={2} edges={3} faces={4} elapsed_ms={5}" -f
        $facts.drawing_id, $topology.Status, $topology.InputSegmentCount,
        $topology.Edges.Count, $topology.Faces.Count, $summary.elapsed_ms)
    Write-Host ("  VIEW regions={0} candidates={1} docs={2} status={3}; CORR repeated={4} projection={5} status={6}" -f
        $viewRegions.Regions.Count, $viewRegions.EngineeringViewCandidateCount,
        $viewRegions.DocumentationRegionCount, $viewRegions.Status,
        $correspondence.RepeatedGeometryRelationCount,
        $correspondence.OrthographicProjectionRelationCount,
        $correspondence.Status)
    Write-Host ("  IDENTITY reps={0} clusters={1} merged={2} possible_groups={3} type_groups={4} status={5}" -f
        $identity.Representations.Count,
        $identity.PhysicalObjectClusters.Count,
        @($identity.PhysicalObjectClusters | Where-Object { $_.RepresentationIds.Count -gt 1 }).Count,
        $identity.SameObjectPossibleGroups.Count,
        $identity.TypeCandidateGroups.Count,
        $identity.Status)
    Write-Host ("  PROFILE profiles={0} voids={1} circular_voids={2} repeated={3} open={4} status={5}" -f
        $manufacturingProfiles.Profiles.Count,
        $manufacturingProfiles.VoidBoundaries.Count,
        $manufacturingProfiles.CircularVoidBoundaryCount,
        $manufacturingProfiles.RepeatedFeatureGroups.Count,
        $manufacturingProfiles.OpenBoundaries.Count,
        $manufacturingProfiles.Status)
    Write-Host ("  INTERFACE features={0} coaxial={1} aligned={2} repeated={3} adjacency={4} coincident={5} terminals={6} status={7}" -f
        $mechanicalInterfaces.Features.Count,
        $mechanicalInterfaces.CoaxialPatternCount,
        $mechanicalInterfaces.AlignedNestedPatternCount,
        $mechanicalInterfaces.RepeatedPatternCount,
        $mechanicalInterfaces.Adjacencies.Count,
        $mechanicalInterfaces.CoincidentBoundaryCount,
        $mechanicalInterfaces.TerminalApproachCount,
        $mechanicalInterfaces.Status)
    Write-Host ("  DIM-GEOM dimensions={0} placements={1} unique={2} ambiguous={3} partial={4} unbound={5} comparable={6} outside={7} scale_hypotheses={8} scale_explained={9} unexplained={10} status={11}" -f
        $dimensionGeometryBindings.InputDimensionCount,
        $dimensionGeometryBindings.InputPlacementCount,
        $dimensionGeometryBindings.UniqueBindingCount,
        $dimensionGeometryBindings.AmbiguousBindingCount,
        $dimensionGeometryBindings.PartialBindingCount,
        $dimensionGeometryBindings.UnboundPlacementCount,
        $dimensionGeometryBindings.ComparableBindingCount,
        $dimensionGeometryBindings.OutsideToleranceCandidateCount,
        $dimensionGeometryBindings.DisplayScaleHypotheses.Count,
        $dimensionGeometryBindings.ScaleExplainedOutsideCandidateCount,
        $dimensionGeometryBindings.UnexplainedOutsideCandidateCount,
        $dimensionGeometryBindings.Status)
    Write-Host ("  SEM-DIFF snapshot_elements={0} issues={1} self_matched={2} self_changed={3} self_ambiguous={4} status={5}" -f
        $semanticDrawingSnapshot.Elements.Count,
        $semanticDrawingSnapshot.Issues.Count,
        $semanticDrawingSelfDiff.MatchedElementCount,
        $semanticDrawingSelfDiff.ChangedElementCount,
        $semanticDrawingSelfDiff.AmbiguousMatches.Count,
        $semanticDrawingSelfDiff.Status)

    $semanticDrawingSelfDiff = $null
    $semanticDrawingSnapshot = $null
    $semanticDrawingIdentity = $null
    $crossDrawingObservation = $null
    $savedDrawingMetadata = $null
    $savedBom = $null
    $savedSemanticObjects = $null
    $savedTitle = $null
    $dimensionGeometryBindings = $null
    $dimensionPlacements = $null
    $dimensionTopology = $null
    $mechanicalInterfaces = $null
    $manufacturingProfiles = $null
    $identity = $null
    $correspondence = $null
    $viewRegions = $null
    $topology = $null
    $instances = $null
    $drawing = $null
    $facts = $null
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$crossDrawingGraphWatch = [Diagnostics.Stopwatch]::StartNew()
$crossDrawingGraph = [Shb.Cad.Core.CrossDrawingInterfaceGraphAnalyzer]::Analyze(
    $crossDrawingObservations)
$crossDrawingGraphWatch.Stop()
$crossDrawingGraphPath = Join-Path $inputDirectory '_cross-drawing-interface-graph-replay.json'
$crossDrawingGraphMarkdownPath = Join-Path $inputDirectory '_cross-drawing-interface-graph-replay.md'
[IO.File]::WriteAllText(
    $crossDrawingGraphPath,
    (($crossDrawingGraph.ToMap() | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText(
    $crossDrawingGraphMarkdownPath,
    ($crossDrawingGraph.ToMarkdown() + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false))

Write-Host ("  CROSS-DRAWING drawings={0} component_refs={1} interface_refs={2} drawing_relations={3} identities={4} comparisons={5} audits={6} elapsed_ms={7} status={8}" -f
    $crossDrawingGraph.Drawings.Count,
    $crossDrawingGraph.ComponentReferenceCount,
    $crossDrawingGraph.InterfaceReferenceCount,
    $crossDrawingGraph.DrawingReferenceCount,
    $crossDrawingGraph.IdentityAssertions.Count,
    $crossDrawingGraph.InterfaceComparisons.Count,
    $crossDrawingGraph.Audits.Count,
    [Math]::Round($crossDrawingGraphWatch.Elapsed.TotalMilliseconds, 1),
    $crossDrawingGraph.Status)
Write-Host "PASS saved 09/11 facts replayed through latest 12/13/14/15/16/17/18/19/20: $($summaries.Count) drawing(s)"
Write-Host "Summary: $SummaryPath"
Write-Host "Cross-drawing graph: $crossDrawingGraphPath"
