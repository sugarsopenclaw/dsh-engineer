param(
    [string]$ExtractionDirectory
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
if ($null -eq ("Shb.Cad.Core.DimensionTopologyAnalyzer" -as [type])) {
    Add-Type -Path (Join-Path $scriptRoot "DimensionTopologyAnalyzer.cs")
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

function Assert-Near {
    param([double]$Expected, [double]$Actual, [double]$Tolerance, [string]$Message)
    if ([Math]::Abs($Expected - $Actual) -gt $Tolerance) {
        throw "$Message expected=$Expected actual=$Actual tolerance=$Tolerance"
    }
}

function Assert-Contains {
    param([string]$ExpectedSubstring, [string]$Actual, [string]$Message)
    if (-not $Actual.Contains($ExpectedSubstring)) {
        throw "$Message missing=[$ExpectedSubstring]"
    }
}

function Find-ScreenshotExtraction {
    $root = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
    $candidates = Get-ChildItem -LiteralPath $root -Directory |
        Where-Object Name -Like "5TBC.384.A110050.2_1*" |
        Sort-Object LastWriteTime -Descending
    foreach ($candidate in $candidates) {
        $entities = Join-Path $candidate.FullName "entities.jsonl"
        if (-not (Test-Path -LiteralPath $entities)) { continue }
        $hasDimension = Select-String -LiteralPath $entities -SimpleMatch `
            '"handle":"2740"' -Quiet
        $hasDefinitionPoints = Select-String -LiteralPath $entities -SimpleMatch `
            '"definition_points"' -Quiet
        if ($hasDimension -and $hasDefinitionPoints) {
            return $candidate.FullName
        }
    }
    throw "No extraction with the screenshot dimensions and definition points under $root"
}

function New-ObservationFromRecord {
    param($Record)
    $geometry = $Record.geometry
    $observation = [Shb.Cad.Core.DimensionTopologyObservation]::new(
        [string]$Record.handle,
        [string]$Record.runtime_class,
        [string]$geometry.dim_type,
        [string]$Record.layer,
        [string]$Record.owner_scope,
        [string]$Record.owner_block_name)
    $measurement = if ($null -eq $geometry.measurement) {
        $null
    }
    else {
        [Nullable[double]]([double]$geometry.measurement)
    }
    $null = $observation.SetMeasurement(
        $measurement,
        [string]$Record.text.dimension_text,
        [string]$geometry.dim_style)
    $rotation = if ($null -eq $geometry.rotation) {
        $null
    }
    else {
        [Nullable[double]]([double]$geometry.rotation)
    }
    foreach ($definition in @($geometry.definition_points)) {
        if ([string]$definition.role -eq "rotation") {
            $rotation = [Nullable[double]]([double]$definition.value)
            continue
        }
        $point = @($definition.point)
        if ($point.Count -lt 2) { continue }
        switch ([string]$definition.role) {
            "xline1" {
                $null = $observation.SetXLine1Point(
                    [double]$point[0],
                    [double]$point[1])
            }
            "xline2" {
                $null = $observation.SetXLine2Point(
                    [double]$point[0],
                    [double]$point[1])
            }
            "dimension_line" {
                $null = $observation.SetDimensionLinePoint(
                    [double]$point[0],
                    [double]$point[1])
            }
        }
    }
    if ($null -ne $rotation) {
        $null = $observation.SetAxisAngle($rotation)
    }
    if (@($geometry.text_position).Count -ge 2) {
        $null = $observation.SetTextPosition(
            [double]$geometry.text_position[0],
            [double]$geometry.text_position[1])
    }
    if (@($Record.bbox.min).Count -ge 2 -and @($Record.bbox.max).Count -ge 2) {
        $null = $observation.SetBounds(
            [double]$Record.bbox.min[0],
            [double]$Record.bbox.min[1],
            [double]$Record.bbox.max[0],
            [double]$Record.bbox.max[1])
    }
    $associationHandle = [string]$Record.extension_dictionary.items.ACAD_DIMASSOC.handle
    if (-not [string]::IsNullOrEmpty($associationHandle)) {
        $null = $observation.SetAssociationHandle($associationHandle)
    }
    return $observation
}

function New-SyntheticDimension {
    param(
        [string]$Handle,
        [double]$StartStation,
        [double]$EndStation,
        [double]$FeatureNormal,
        [double]$Lane,
        [double]$AxisAngle)
    $axisX = [Math]::Cos($AxisAngle)
    $axisY = [Math]::Sin($AxisAngle)
    $normalX = -$axisY
    $normalY = $axisX
    $x1 = @(
        ($axisX * $StartStation + $normalX * $FeatureNormal),
        ($axisY * $StartStation + $normalY * $FeatureNormal))
    $x2 = @(
        ($axisX * $EndStation + $normalX * $FeatureNormal),
        ($axisY * $EndStation + $normalY * $FeatureNormal))
    $dimensionLine = @(
        ($axisX * $EndStation + $normalX * $Lane),
        ($axisY * $EndStation + $normalY * $Lane))
    $observation = [Shb.Cad.Core.DimensionTopologyObservation]::new(
        $Handle,
        "AcDbRotatedDimension",
        "RotatedDimension",
        "DIM",
        "model_space",
        "*Model_Space")
    $null = $observation.SetMeasurement(
        [Nullable[double]]([Math]::Abs($EndStation - $StartStation)),
        "{<>}",
        "STANDARD")
    $null = $observation.SetAxisAngle([Nullable[double]]$AxisAngle)
    $null = $observation.SetXLine1Point($x1[0], $x1[1])
    $null = $observation.SetXLine2Point($x2[0], $x2[1])
    $null = $observation.SetDimensionLinePoint($dimensionLine[0], $dimensionLine[1])
    return $observation
}

if ([string]::IsNullOrWhiteSpace($ExtractionDirectory)) {
    $ExtractionDirectory = Find-ScreenshotExtraction
}
$entitiesPath = Join-Path $ExtractionDirectory "entities.jsonl"
$centerlinesPath = Join-Path $ExtractionDirectory "centerline-identification.json"
if (-not (Test-Path -LiteralPath $entitiesPath)) {
    throw "Missing entities: $entitiesPath"
}
if (-not (Test-Path -LiteralPath $centerlinesPath)) {
    throw "Missing centerline result: $centerlinesPath"
}

$expectedHandles = @("2740", "2750", "4D42", "4D52", "4CDB", "4CEB", "4CFB")
$observations = [System.Collections.Generic.List[Shb.Cad.Core.DimensionTopologyObservation]]::new()
foreach ($jsonLine in Get-Content -LiteralPath $entitiesPath) {
    if ($jsonLine -notmatch '"handle":"(?:2740|2750|4D42|4D52|4CDB|4CEB|4CFB)"') {
        continue
    }
    $record = $jsonLine | ConvertFrom-Json
    if ($expectedHandles -contains [string]$record.handle) {
        $observations.Add((New-ObservationFromRecord $record))
    }
}
Assert-Equal 7 $observations.Count "screenshot dimension observations"

$centerlineDocument = Get-Content -LiteralPath $centerlinesPath -Raw | ConvertFrom-Json
$reference = @($centerlineDocument.center_geometries | Where-Object handle -eq "15DA")
Assert-Equal 1 $reference.Count "named body centerline"
$referenceLabel = [string]$reference[0].label_bindings[0].text
$referenceAxes = [System.Collections.Generic.List[Shb.Cad.Core.DimensionReferenceAxisObservation]]::new()
$referenceAxes.Add([Shb.Cad.Core.DimensionReferenceAxisObservation]::new(
    [string]$reference[0].handle,
    $referenceLabel,
    [string]$reference[0].owner_scope,
    [string]$reference[0].owner_block_name,
    [double]$reference[0].geometry.start[0],
    [double]$reference[0].geometry.start[1],
    [double]$reference[0].geometry.end[0],
    [double]$reference[0].geometry.end[1]))

$document = [Shb.Cad.Core.DimensionTopologyAnalyzer]::Analyze(
    "5TBC.384.A110050.2_1-screenshot",
    $observations,
    $referenceAxes)
Assert-Equal 7 $document.Edges.Count "linear dimensions"
Assert-Equal 1 $document.Groups.Count "connected topology group"
Assert-Equal 3 $document.Chains.Count "strict continuous chains"
Assert-Equal 3 $document.Equations.Count "closure equations"
Assert-Equal 7 $document.DerivedDimensions.Count "derived distances"
Assert-Equal 1 $document.DatumProfiles.Count "common datum profile"
Assert-Equal 0 $document.IsolatedHandles.Count "isolated dimensions"

$chainKeys = @(
    foreach ($chain in $document.Chains) {
        $handles = @($chain.EdgeHandles | Sort-Object)
        [string]::Join("+", $handles)
    })
Assert-True ($chainKeys -contains "2740+2750") "170 + 230 chain"
Assert-True ($chainKeys -contains "4D42+4D52") "575 + 635 chain"
Assert-True ($chainKeys -contains "4CDB+4CEB") "825 + 885 chain"

$profile = $document.DatumProfiles[0]
Assert-Equal "matched_named_reference_axis" $profile.ReferenceAxisStatus `
    "named datum binding"
Assert-Equal "15DA" $profile.ReferenceAxisHandle "named datum handle"
Assert-Equal "器身中心线" $profile.ReferenceAxisName "named datum label"
Assert-Equal 3 $profile.Pairs.Count "opposite-side pairs"
Assert-True $profile.HasConstantMidpointOffset "constant midpoint offset"
Assert-Near 30 $profile.ConstantMidpointOffset 0.001 "eccentricity from named axis"
Assert-Equal 2 $profile.Increments.Count "consecutive layer increments"
Assert-Near 405 $profile.Increments[0].LeftIncrement 0.001 "first left increment"
Assert-Near 405 $profile.Increments[0].RightIncrement 0.001 "first right increment"
Assert-Near 250 $profile.Increments[1].LeftIncrement 0.001 "second left increment"
Assert-Near 250 $profile.Increments[1].RightIncrement 0.001 "second right increment"

$outerPair = @($profile.Pairs | Where-Object TotalSpan -eq 1710)
Assert-Equal 1 $outerPair.Count "outer envelope pair"
Assert-Equal "4CFB" $outerPair[0].ExplicitSpanHandle "explicit 1710 span"
Assert-Near 0 $outerPair[0].ExplicitSpanResidual 0.001 "1710 closure residual"
$closure = @($document.Equations | Where-Object EquationType -eq "explicit_parent_partition")
Assert-Equal 1 $closure.Count "explicit partition equation"
Assert-True $closure[0].WithinTolerance "825 + 885 = 1710"
Assert-Near 0 $closure[0].Residual 0.001 "partition residual"
$referenceDimension = @($document.Edges | Where-Object Handle -eq "4CDB")
Assert-True $referenceDimension[0].IsReferenceDimensionCandidate `
    "parenthesized 825 remains a reference candidate"

$json = $document.ToMap() | ConvertTo-Json -Depth 30 -Compress
Assert-Contains '"analysis_type":"dimension_topology"' $json "JSON analysis type"
Assert-Contains '"symmetry_status":"constant_eccentricity_from_reference_axis"' $json `
    "JSON asymmetry semantic"
Assert-Contains '"semantic_status":"derived_not_drawn_unless_explicit_handle_present"' $json `
    "JSON derived evidence boundary"
$markdown = $document.ToMarkdown()
Assert-Contains "# 尺寸拓扑与尺寸链分析" $markdown "Markdown heading"
Assert-Contains "恒定中点偏置 30" $markdown "Markdown eccentricity"

$angle = [Math]::PI / 4.0
$rotated = [System.Collections.Generic.List[Shb.Cad.Core.DimensionTopologyObservation]]::new()
$rotated.Add((New-SyntheticDimension "R1" 0 10 0 -5 $angle))
$rotated.Add((New-SyntheticDimension "R2" 10 25 0 -5 $angle))
$rotatedDocument = [Shb.Cad.Core.DimensionTopologyAnalyzer]::Analyze(
    "rotated-45-degrees",
    $rotated,
    $null)
Assert-Equal 1 $rotatedDocument.Chains.Count "rotated continuous chain"
Assert-Equal "angled" $rotatedDocument.Edges[0].OrientationClass `
    "dimension-local coordinates"
Assert-Near 25 `
    ($rotatedDocument.Chains[0].EndStation - $rotatedDocument.Chains[0].StartStation) `
    0.001 `
    "rotated chain span"

$remote = [System.Collections.Generic.List[Shb.Cad.Core.DimensionTopologyObservation]]::new()
$remote.Add((New-SyntheticDimension "N1" 0 10 0 0 0))
$remote.Add((New-SyntheticDimension "N2" 0 20 1000 1000 0))
$remoteDocument = [Shb.Cad.Core.DimensionTopologyAnalyzer]::Analyze(
    "same-station-remote-contexts",
    $remote,
    $null)
Assert-Equal 0 $remoteDocument.Relations.Count "remote same stations do not connect"
Assert-Equal 2 $remoteDocument.Groups.Count "remote dimensions remain separate"
Assert-Equal 2 $remoteDocument.IsolatedHandles.Count "remote dimensions stay isolated"

[pscustomobject]@{
    ExtractionDirectory = $ExtractionDirectory
    ScreenshotDimensions = $document.Edges.Count
    ContinuousChains = $document.Chains.Count
    ClosureEquations = $document.Equations.Count
    DatumPairs = $profile.Pairs.Count
    NamedAxisEccentricity = $profile.ConstantMidpointOffset
    RotatedDimensionChain = $rotatedDocument.Chains.Count
    RemoteFalsePositiveRelations = $remoteDocument.Relations.Count
    Status = "passed"
} | Format-List
