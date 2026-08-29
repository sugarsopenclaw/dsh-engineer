param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}

if ($null -eq ("Shb.Cad.Core.AnnotationIdentifier" -as [type])) {
    Add-Type -Path (Join-Path $scriptRoot "AnnotationIdentifier.cs")
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message expected=$Expected actual=$Actual"
    }
}

function Assert-True {
    param([bool]$Actual, [string]$Message)
    if (-not $Actual) {
        throw "$Message expected=true actual=false"
    }
}

function Assert-Contains {
    param([string]$ExpectedSubstring, [string]$Actual, [string]$Message)
    if (-not $Actual.Contains($ExpectedSubstring)) {
        throw "$Message missing=[$ExpectedSubstring]"
    }
}

function Get-VisibleText {
    param($Record)
    $values = [System.Collections.Generic.List[string]]::new()
    function Add-TextValue($Value) {
        if ($null -eq $Value) { return }
        $text = ([string]$Value).Trim()
        if ($text.Length -gt 0 -and -not $values.Contains($text)) {
            $values.Add($text)
        }
    }
    if ($Record.text -is [string]) {
        Add-TextValue $Record.text
    }
    elseif ($null -ne $Record.text) {
        if (-not [string]::IsNullOrWhiteSpace([string]$Record.text.plain)) {
            Add-TextValue $Record.text.plain
        }
        elseif (-not [string]::IsNullOrWhiteSpace([string]$Record.text.dimension_text)) {
            Add-TextValue $Record.text.dimension_text
        }
        elseif (-not [string]::IsNullOrWhiteSpace([string]$Record.text.contents)) {
            Add-TextValue $Record.text.contents
        }
        else {
            Add-TextValue $Record.text.value
        }
    }
    Add-TextValue $Record.geometry.text
    if ($null -ne $Record.geometry.annotation) {
        if ($Record.geometry.annotation.text -is [string]) {
            Add-TextValue $Record.geometry.annotation.text
        }
        else {
            Add-TextValue $Record.geometry.annotation.text.plain
            Add-TextValue $Record.geometry.annotation.text.contents
        }
    }
    foreach ($part in @($Record.custom.explode)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$part.plain)) {
            Add-TextValue $part.plain
        }
        elseif (-not [string]::IsNullOrWhiteSpace([string]$part.string)) {
            Add-TextValue $part.string
        }
        else {
            Add-TextValue $part.contents
        }
    }
    return [string]::Join("`n", $values)
}

function Add-Point {
    param($Observation, [string]$Role, $Point)
    if ($null -ne $Point -and @($Point).Count -ge 2) {
        $null = $Observation.AddGeometryPoint(
            $Role,
            [double]$Point[0],
            [double]$Point[1])
    }
}

function New-AnnotationObservation {
    param($Record)
    $colorIndex = if ($null -eq $Record.color.index) { -1 } else { [int]$Record.color.index }
    $observation = [Shb.Cad.Core.AnnotationEntityObservation]::new(
        [string]$Record.handle,
        [string]$Record.runtime_class,
        [string]$Record.managed_type,
        [string]$Record.layer,
        $colorIndex,
        [string]$Record.owner_scope,
        [string]$Record.owner_block_name,
        [string]$Record.geometry.kind)
    if ($null -ne $Record.bbox.min -and $null -ne $Record.bbox.max) {
        $null = $observation.SetBounds(
            [double]$Record.bbox.min[0],
            [double]$Record.bbox.min[1],
            [double]$Record.bbox.max[0],
            [double]$Record.bbox.max[1])
    }
    $null = $observation.SetText((Get-VisibleText $Record))
    switch ([string]$Record.geometry.kind) {
        "dimension" {
            $measurement = if ($null -eq $Record.geometry.measurement) {
                $null
            }
            else {
                [Nullable[double]]([double]$Record.geometry.measurement)
            }
            $null = $observation.SetDimension(
                [string]$Record.geometry.dim_type,
                $measurement,
                [string]$Record.text.dimension_text,
                [string]$Record.geometry.dim_style)
            Add-Point $observation "text_position" $Record.geometry.text_position
            foreach ($definition in @($Record.geometry.definition_points)) {
                Add-Point $observation ([string]$definition.role) $definition.point
            }
        }
        "line" {
            Add-Point $observation "start" $Record.geometry.start
            Add-Point $observation "end" $Record.geometry.end
        }
        "solid" {
            $index = 0
            foreach ($point in @($Record.geometry.points)) {
                Add-Point $observation "solid_$index" $point
                $index++
            }
        }
        "text" { Add-Point $observation "text_position" $Record.geometry.position }
        "mtext" { Add-Point $observation "text_location" $Record.geometry.location }
        "leader" {
            $null = $observation.SetHasArrowHead([bool]$Record.geometry.has_arrow_head)
            $index = 0
            foreach ($point in @($Record.geometry.vertices)) {
                Add-Point $observation "vertex_$index" $point
                $index++
            }
        }
        "professional" {
            Add-Point $observation "pointing_position" $Record.geometry.pointing_position
            Add-Point $observation "number_position" $Record.geometry.number_position
        }
    }
    return $observation
}

$drawingIds = @(
    "5TBC.384.A110050.1_1",
    "5TBC.384.A110050.2_1",
    "5TBC.426.A110050.1_1",
    "5TBC.457.A110050.1_1",
    "5TBC.709.A110050.1_1",
    "5TBC.709.A110050.1_2",
    "8TBC.312.A110050.101_1")

$documents = @{}
$aggregate = @{}
foreach ($drawingId in $drawingIds) {
    $entitiesPath = Join-Path (Join-Path $ExtractionRoot $drawingId) "entities.jsonl"
    if (-not (Test-Path -LiteralPath $entitiesPath)) {
        throw "Missing extraction: $entitiesPath"
    }
    $observations = [System.Collections.Generic.List[Shb.Cad.Core.AnnotationEntityObservation]]::new()
    foreach ($jsonLine in Get-Content -LiteralPath $entitiesPath) {
        $candidate = $jsonLine -like '*"kind":"dimension"*' -or
            $jsonLine -like '*"kind":"leader"*' -or
            $jsonLine -like '*"kind":"mleader"*' -or
            $jsonLine -like '*"kind":"line"*' -or
            $jsonLine -like '*"kind":"solid"*' -or
            $jsonLine -like '*"kind":"text"*' -or
            $jsonLine -like '*TH_XuHaoEntity*' -or
            $jsonLine -like '*TH_DimRough*' -or
            $jsonLine -like '*TH_ParaBasePntUA*'
        if (-not $candidate) { continue }
        $observations.Add((New-AnnotationObservation ($jsonLine | ConvertFrom-Json)))
    }
    $document = [Shb.Cad.Core.AnnotationIdentifier]::Identify(
        $drawingId,
        $observations,
        $null)
    $documents[$drawingId] = $document
    foreach ($entry in $document.TypeCounts.GetEnumerator()) {
        if (-not $aggregate.ContainsKey($entry.Key)) { $aggregate[$entry.Key] = 0 }
        $aggregate[$entry.Key] += [int]$entry.Value
    }
}

Assert-Equal 743 $aggregate.dimension "seven drawings dimension count"
Assert-Equal 178 $aggregate.serial_balloon "seven drawings serial balloon count"
Assert-Equal 177 $aggregate.text_leader "seven drawings TH text leader count"
Assert-Equal 10 $aggregate.leader "seven drawings plain leader count"
Assert-Equal 6 $aggregate.roughness_symbol "seven drawings roughness count"
Assert-Equal 87 $aggregate.datum_reference_symbol "seven drawings datum reference count"
Assert-Equal 2 $aggregate.symbol_arrow "seven drawings TH arrow count"

$pqDocument = $documents["5TBC.384.A110050.1_1"]
$directionMarkers = @($pqDocument.Annotations | Where-Object Type -eq "direction_marker")
$p = @($directionMarkers | Where-Object DisplayText -eq "P")
$q = @($directionMarkers | Where-Object DisplayText -eq "Q")
Assert-Equal 1 $p.Count "P direction marker"
Assert-Equal 1 $q.Count "Q direction marker"
Assert-Equal "3EF2C,3EF2D,3EF2E" ([string]::Join(",", $p[0].SourceHandles)) `
    "P grouped handles"
Assert-Equal "3EF2F,3EF30,3EF31" ([string]::Join(",", $q[0].SourceHandles)) `
    "Q grouped handles"
Assert-True ($p[0].DirectionX -lt -0.99) "P arrow points left"
Assert-True ($q[0].DirectionX -gt 0.99) "Q arrow points right"
Assert-Equal "business_meaning_unresolved" $p[0].MeaningStatus "P semantics stay unresolved"

$centerlineLabels = @(
    foreach ($document in $documents.Values) {
        $document.Annotations | Where-Object {
            $_.Type -eq "text_leader" -and $_.DisplayText.Contains("中心线")
        }
    })
Assert-Equal 29 $centerlineLabels.Count "centerline leaders remain in annotation scope"

$json = $pqDocument.ToMap() | ConvertTo-Json -Depth 30 -Compress
Assert-Contains '"analysis_type":"annotation_identification"' $json "JSON analysis type"
Assert-Contains '"overlap_policy":"independent_capability_results_may_overlap"' $json `
    "JSON overlap policy"
Assert-Contains '"deletion_status":"recognition_only_no_entities_modified"' $json `
    "JSON deletion boundary"
Assert-Contains '"annotation_type":"direction_marker"' $json "JSON direction marker"
$markdown = $pqDocument.ToMarkdown()
Assert-Contains '# 全图标注识别' $markdown "Markdown heading"
Assert-Contains 'P/Q 当前只确认' $markdown "Markdown P/Q boundary"

[pscustomobject]@{
    Drawings = $documents.Count
    DirectAnnotations = 743 + 178 + 177 + 10 + 6 + 87 + 2
    DirectionMarkers = ($documents.Values | ForEach-Object { $_.CountOf("direction_marker") } | Measure-Object -Sum).Sum
    CenterlineTextLeaders = $centerlineLabels.Count
    Status = "passed"
} | Format-List
