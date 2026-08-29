param(
    [Parameter(Mandatory = $true)]
    [string]$InputRoot,
    [string]$ObservationFileName = 'cross-drawing-observation.json',
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath $InputRoot).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = $root }
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null

$coreRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$coreFiles = @(
    (Join-Path $coreRoot '19-semantic-drawing-diff/SemanticDrawingDiffAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'CrossDrawingInterfaceGraphModels.cs'),
    (Join-Path $PSScriptRoot 'CrossDrawingProjectInputBuilder.cs'),
    (Join-Path $PSScriptRoot 'CrossDrawingInterfaceGraphAnalyzer.cs')
)
Add-Type -Path $coreFiles

function Get-Properties($Value) {
    if ($null -eq $Value) { return @() }
    return @($Value.PSObject.Properties)
}

function Add-StringValues($Target, [string]$Method, $Values) {
    foreach ($value in @($Values)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
            $Target.$Method([string]$value) | Out-Null
        }
    }
}

$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter $ObservationFileName |
    Sort-Object FullName)
if ($files.Count -eq 0) {
    throw "No $ObservationFileName files found under $root"
}

$drawings = [System.Collections.Generic.List[Shb.Cad.Core.CrossDrawingDrawingObservation]]::new()
foreach ($file in $files) {
    $json = [IO.File]::ReadAllText(
        $file.FullName,
        [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json
    $drawing = [Shb.Cad.Core.CrossDrawingDrawingObservation]::new(
        [string]$json.snapshot_id,
        [string]$json.drawing_id,
        [string]$json.drawing_number)
    $drawing.SetTitle(
        [string]$json.drawing_name,
        [string]$json.revision,
        [string]$json.stage,
        [string]$json.sheet,
        [string]$json.sheet_count,
        [string]$json.product_model) | Out-Null
    $drawing.SetSource(
        [string]$json.source_path,
        [string]$json.source_status,
        [bool]$json.truncated) | Out-Null
    $drawing.SetUnitContext(
        [string]$json.unit_name,
        [string]$json.measurement_system,
        [bool]$json.comparable_geometry_scale_proven,
        [string]$json.geometry_scale_evidence) | Out-Null
    foreach ($property in Get-Properties $json.evidence) {
        $drawing.AddEvidence([string]$property.Name, [string]$property.Value) | Out-Null
    }

    foreach ($item in @($json.component_references)) {
        $reference = [Shb.Cad.Core.CrossDrawingComponentReferenceObservation]::new(
            [string]$item.component_reference_id,
            [string]$item.reference_code,
            [string]$item.evidence_kind,
            [string]$item.source_element_id)
        $reference.SetBomContext(
            [string]$item.item_number,
            [string]$item.name,
            [string]$item.quantity) | Out-Null
        $reference.SetReferenceQualifier(
            [string]$item.referenced_sheet,
            [string]$item.referenced_revision) | Out-Null
        $reference.SetSourceText([string]$item.source_text) | Out-Null
        if ($null -ne $item.pointer -and @($item.pointer).Count -ge 2) {
            $reference.SetPointer(
                [double]$item.pointer[0],
                [double]$item.pointer[1]) | Out-Null
        }
        foreach ($interfaceId in @($item.associated_interface_ids)) {
            $reference.AddAssociatedInterface(
                [string]$interfaceId,
                [string]$item.association_status) | Out-Null
        }
        Add-StringValues $reference 'AddSourceId' $item.source_ids
        Add-StringValues $reference 'AddSourceHandle' $item.source_handles
        $drawing.AddComponentReference($reference) | Out-Null
    }

    foreach ($item in @($json.interface_references)) {
        $interface = [Shb.Cad.Core.CrossDrawingInterfaceObservation]::new(
            [string]$item.interface_reference_id,
            [string]$item.source_element_id,
            [string]$item.domain,
            [string]$item.kind,
            [string]$item.shape_class,
            [string]$item.evidence_status)
        $interface.SetSignatures(
            [string]$item.match_signature,
            [string]$item.geometry_signature) | Out-Null
        $interface.SetContext(
            [string]$item.region_id,
            [string]$item.physical_object_cluster_id) | Out-Null
        if ($null -ne $item.bounds -and @($item.bounds).Count -ge 4) {
            $interface.SetBounds(
                [double]$item.bounds[0],
                [double]$item.bounds[1],
                [double]$item.bounds[2],
                [double]$item.bounds[3]) | Out-Null
        } elseif ($null -ne $item.anchor -and @($item.anchor).Count -ge 2) {
            $interface.SetAnchor(
                [double]$item.anchor[0],
                [double]$item.anchor[1]) | Out-Null
        }
        if ($null -ne $item.local_frame -and
            $null -ne $item.local_frame.position -and
            @($item.local_frame.position).Count -ge 2) {
            $interface.SetLocalFrame(
                [double]$item.local_frame.position[0],
                [double]$item.local_frame.position[1],
                [double]$item.local_frame.direction_degrees,
                [double]$item.local_frame.scale,
                [string]$item.local_frame.scale_source) | Out-Null
        }
        foreach ($property in Get-Properties $item.metrics) {
            $interface.AddMetric([string]$property.Name, [double]$property.Value) | Out-Null
        }
        foreach ($property in Get-Properties $item.semantic_values) {
            $interface.AddSemanticValue(
                [string]$property.Name,
                [string]$property.Value) | Out-Null
        }
        foreach ($property in Get-Properties $item.bound_dimension_values) {
            foreach ($value in @($property.Value)) {
                $interface.AddBoundDimensionValue(
                    [string]$property.Name,
                    [double]$value) | Out-Null
            }
        }
        Add-StringValues $interface 'AddSourceId' $item.source_ids
        Add-StringValues $interface 'AddSourceHandle' $item.source_handles
        $drawing.AddInterface($interface) | Out-Null
    }
    $drawings.Add($drawing)
}

$graph = [Shb.Cad.Core.CrossDrawingInterfaceGraphAnalyzer]::Analyze($drawings)
$jsonPath = Join-Path $OutputDirectory 'cross-drawing-interface-graph.json'
$markdownPath = Join-Path $OutputDirectory 'cross-drawing-interface-graph.md'
[IO.File]::WriteAllText(
    $jsonPath,
    (($graph.ToMap() | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText(
    $markdownPath,
    ($graph.ToMarkdown() + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false))

Write-Host ('PASS 20 graph built: drawings={0} refs={1} interfaces={2} identities={3} comparisons={4} audits={5} status={6}' -f
    $graph.Drawings.Count,
    $graph.ComponentReferenceCount,
    $graph.InterfaceReferenceCount,
    $graph.IdentityAssertions.Count,
    $graph.InterfaceComparisons.Count,
    $graph.Audits.Count,
    $graph.Status)
Write-Host "JSON: $jsonPath"
Write-Host "Markdown: $markdownPath"
