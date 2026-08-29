param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}
if ($null -eq ("Shb.Cad.Core.EngineeringLineSemanticAnalyzer" -as [type])) {
    Add-Type -Path (Join-Path $scriptRoot "EngineeringLineSemanticAnalyzer.cs")
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

function New-LayerStyle {
    param(
        [string]$Name,
        [string]$Color,
        [int]$ColorIndex,
        [string]$Linetype)
    return [Shb.Cad.Core.EngineeringLayerStyleObservation]::new(
        $Name,
        $Color,
        [Nullable[int]]$ColorIndex,
        $false,
        $false,
        "ByAci",
        $null,
        $null,
        $null,
        $Linetype,
        [Nullable[int]]25)
}

function New-Linetype {
    param(
        [string]$Name,
        [double[]]$Dashes)
    $dashList = [System.Collections.Generic.List[double]]::new()
    foreach ($dash in $Dashes) {
        $dashList.Add($dash)
    }
    $patternLength = if ($dashList.Count -eq 0) {
        [Nullable[double]]0
    }
    else {
        [Nullable[double]](([Math]::Abs(($Dashes | Measure-Object -Sum).Sum)))
    }
    return [Shb.Cad.Core.EngineeringLinetypeDefinitionObservation]::new(
        $Name,
        "test pattern",
        "synthetic regression",
        $patternLength,
        $dashList)
}

function New-LineObservation {
    param(
        [string]$Handle,
        [string]$Layer,
        [string]$Owner,
        [double]$StartX,
        [double]$StartY,
        [double]$EndX,
        [double]$EndY,
        [string]$Linetype = "ByLayer",
        [int]$ColorIndex = 256,
        [bool]$ByLayer = $true,
        [bool]$ByBlock = $false,
        [string]$OwnerScope = "model_space")
    $observation = [Shb.Cad.Core.EngineeringLineObservation]::new(
        $Handle,
        "AcDbLine",
        "Line",
        $Layer,
        $OwnerScope,
        $Owner,
        "line",
        $true)
    $null = $observation.SetEntityColor(
        [Nullable[int]]$ColorIndex,
        $ByLayer,
        $ByBlock,
        $(if ($ByLayer) { "ByLayer" } elseif ($ByBlock) { "ByBlock" } else { "ACI $ColorIndex" }),
        $(if ($ByLayer) { "ByLayer" } elseif ($ByBlock) { "ByBlock" } else { "ByAci" }),
        $null,
        $null,
        $null)
    $null = $observation.SetEntityStyle($Linetype, [Nullable[int]]-1)
    $null = $observation.SetLine($StartX, $StartY, $EndX, $EndY)
    return $observation
}

function Add-Square {
    param(
        $Values,
        [string]$Prefix,
        [double]$MinX,
        [double]$MinY,
        [double]$Size)
    $maxX = $MinX + $Size
    $maxY = $MinY + $Size
    $Values.Add((New-LineObservation "$Prefix-1" "1轮廓实线层" "assembly" $MinX $MinY $maxX $MinY))
    $Values.Add((New-LineObservation "$Prefix-2" "1轮廓实线层" "assembly" $maxX $MinY $maxX $maxY))
    $Values.Add((New-LineObservation "$Prefix-3" "1轮廓实线层" "assembly" $maxX $maxY $MinX $maxY))
    $Values.Add((New-LineObservation "$Prefix-4" "1轮廓实线层" "assembly" $MinX $maxY $MinX $MinY))
}

$layers = [System.Collections.Generic.List[Shb.Cad.Core.EngineeringLayerStyleObservation]]::new()
$layers.Add((New-LayerStyle "0" "white" 7 "Continuous"))
$layers.Add((New-LayerStyle "1轮廓实线层" "white" 7 "Continuous"))
$layers.Add((New-LayerStyle "2细线层" "cyan" 4 "Continuous"))
$layers.Add((New-LayerStyle "3中心线层" "red" 1 "CENTER"))
$layers.Add((New-LayerStyle "4虚线层" "yellow" 2 "DASHED"))
$layers.Add((New-LayerStyle "5剖面线层" "yellow" 2 "Continuous"))
$layers.Add((New-LayerStyle "7标注层" "cyan" 4 "Continuous"))
$layers.Add((New-LayerStyle "9双点划线层" "magenta" 6 "DIVIDE"))
$layers.Add((New-LayerStyle "CUSTOM_UNKNOWN" "rgb(12,34,56)" 257 "MYSTERY"))

$linetypes = [System.Collections.Generic.List[Shb.Cad.Core.EngineeringLinetypeDefinitionObservation]]::new()
$linetypes.Add((New-Linetype "Continuous" @()))
$linetypes.Add((New-Linetype "DASHED" @(5, -2)))
$linetypes.Add((New-Linetype "CENTER" @(10, -2, 2, -2)))
$linetypes.Add((New-Linetype "DIVIDE" @(10, -2, 0, -2, 0, -2)))
$linetypes.Add((New-Linetype "MYSTERY" @(1, -1, 1, -1)))
$linetypes.Add((New-Linetype "CUSTOM_PATTERN_42" @(10, -2, 1, -2, 1, -2)))

$observations = [System.Collections.Generic.List[Shb.Cad.Core.EngineeringLineObservation]]::new()
Add-Square $observations "left" 2 0 4
Add-Square $observations "right" 14 0 4
$observations.Add((New-LineObservation "hidden-left" "4虚线层" "assembly" 3 2 5 2))
$observations.Add((New-LineObservation "hidden-right" "4虚线层" "assembly" 15 2 17 2))
$observations.Add((New-LineObservation "center-axis" "3中心线层" "symbols" 0 -2 0 6))
$observations.Add((New-LineObservation "double-chain" "9双点划线层" "symbols" -2 10 2 10))
$observations.Add((New-LineObservation "pattern-double" "CUSTOM_UNKNOWN" "patterns" 0 0 4 0 "CUSTOM_PATTERN_42" 7 $false $false))
$observations.Add((New-LineObservation "annotation-line" "7标注层" "assembly" 0 8 2 8))

$unknown = New-LineObservation "unknown-rgb" "CUSTOM_UNKNOWN" "unknown" 0 0 3 1 "MYSTERY" 257 $false $false
$null = $unknown.SetEntityColor(
    [Nullable[int]]257,
    $false,
    $false,
    "ByColor",
    "ByColor",
    [Nullable[int]]12,
    [Nullable[int]]34,
    [Nullable[int]]56)
$observations.Add($unknown)

$unknownSecond = New-LineObservation "unknown-rgb-2" "CUSTOM_UNKNOWN" "unknown" 0 2 3 3 "MYSTERY" 257 $false $false
$null = $unknownSecond.SetEntityColor(
    [Nullable[int]]257,
    $false,
    $false,
    "ByColor",
    "ByColor",
    [Nullable[int]]13,
    [Nullable[int]]34,
    [Nullable[int]]56)
$observations.Add($unknownSecond)

$blockLayerZero = New-LineObservation `
    "block-layer-zero" "0" "BLOCK_A" 0 0 1 0 "ByLayer" 256 $true $false "block_definition"
$observations.Add($blockLayerZero)

$solid = [Shb.Cad.Core.EngineeringLineObservation]::new(
    "solid-unsupported",
    "AcDbSolid",
    "Solid",
    "5剖面线层",
    "model_space",
    "assembly",
    "solid",
    $true)
$null = $solid.SetEntityColor([Nullable[int]]256, $true, $false, "ByLayer", "ByLayer", $null, $null, $null)
$null = $solid.SetEntityStyle("ByLayer", [Nullable[int]]-1)
$null = $solid.SetBounds(7, 0, 8, 1)
$observations.Add($solid)

$annotations = [System.Collections.Generic.List[string]]::new()
$annotations.Add("annotation-line")
$centers = [System.Collections.Generic.List[string]]::new()
$centers.Add("center-axis")
$axes = [System.Collections.Generic.List[Shb.Cad.Core.EngineeringReferenceAxisObservation]]::new()
$axis = [Shb.Cad.Core.EngineeringReferenceAxisObservation]::new(
    "named-axis",
    "器身中心线",
    "model_space",
    "assembly",
    0,
    -2,
    0,
    6)
$null = $axis.AddCandidateShift(10, 0, "09_dimension_datum_profile:test")
$axes.Add($axis)

$config = [Shb.Cad.Core.EngineeringLineSemanticConfig]::new()
$config.GeometryTolerance = 0.001
$config.SymmetryMatchTolerance = 0.001
$config.SymmetryMinimumFeatureCount = 4
$document = [Shb.Cad.Core.EngineeringLineSemanticAnalyzer]::Analyze(
    "synthetic-engineering-lines",
    $observations,
    $layers,
    $linetypes,
    $annotations,
    $centers,
    $axes,
    $config)

$visibleComponents = @($document.Components | Where-Object Role -eq "visible_contour")
$closedVisible = @($visibleComponents | Where-Object IsClosed)
Assert-Equal 2 $closedVisible.Count "two endpoint-closed visible contours"
$repeat = @($document.RepeatedPatterns | Where-Object Role -eq "visible_contour")
Assert-Equal 1 $repeat.Count "repeated square topology"
Assert-Equal 2 $repeat[0].InstanceCount "two repeated square instances"

$hiddenRelations = @($document.Relations | Where-Object RelationType -eq "hidden_inside_visible_envelope_candidate")
Assert-Equal 2 $hiddenRelations.Count "hidden strokes linked to containing visible envelopes"

$symmetry = @($document.SymmetryEvaluations | Where-Object AxisHandle -eq "named-axis")
Assert-Equal 1 $symmetry.Count "named axis evaluated"
Assert-Equal "symmetric_about_parallel_offset_axis" $symmetry[0].Status `
    "dimension-derived offset axis beats named axis"
Assert-Near 1 $symmetry[0].BestCoverage 0.000001 "offset symmetry coverage"
Assert-Near 10 ([Math]::Abs($symmetry[0].SignedNormalOffset)) 0.000001 `
    "offset magnitude retained"

$annotationStroke = @($document.Strokes | Where-Object Handle -eq "annotation-line")
Assert-Equal 1 $annotationStroke.Count "annotation stroke retained"
Assert-Equal "annotation_geometry" $annotationStroke[0].PrimaryRole "08 evidence reused"
Assert-True ([string]::IsNullOrEmpty($annotationStroke[0].TopologyComponentId)) `
    "annotation excluded from object topology"

$centerStroke = @($document.Strokes | Where-Object Handle -eq "center-axis")
Assert-Equal "center_reference" $centerStroke[0].PrimaryRole "07 evidence reused"
$patternStroke = @($document.Strokes | Where-Object Handle -eq "pattern-double")
Assert-Equal "double_chain_reference" $patternStroke[0].PrimaryRole `
    "raw dash rhythm classifies an unfamiliar name"

$unknownStyle = @($document.StyleProfiles | Where-Object {
    $_.SampleHandles -contains "unknown-rgb"
})
$unknownLayerDefinition = @($document.LayerStyles | Where-Object Name -eq "CUSTOM_UNKNOWN")
Assert-Equal 1 $unknownLayerDefinition.Count "unused-or-used unknown layer definition retained"
Assert-Equal "MYSTERY" $unknownLayerDefinition[0].Linetype "unknown layer linetype retained"
Assert-Equal 1 $unknownStyle.Count "unknown RGB style profile retained"
Assert-Equal "other" $unknownStyle[0].LinetypeFamily "unknown line family remains open"
Assert-True $unknownStyle[0].RequiresFutureAnalysis "unknown style queued for future analysis"
Assert-True (@($document.UnresolvedStyleProfiles | Where-Object Id -eq $unknownStyle[0].Id).Count -eq 1) `
    "unknown style appears in unresolved profiles"
$unknownColor = @($document.Colors | Where-Object {
    $_.HasRgb -and $_.Red -eq 12 -and $_.Green -eq 34 -and $_.Blue -eq 56
})
Assert-Equal 1 $unknownColor.Count "unknown true color retained"
$sameNameRgbProfiles = @($document.StyleProfiles | Where-Object EffectiveColorName -eq "ByColor")
Assert-Equal 2 $sameNameRgbProfiles.Count "distinct RGB values never collapse by display name"

$blockStyle = @($document.StyleProfiles | Where-Object {
    $_.SampleHandles -contains "block-layer-zero"
})
Assert-Equal 1 $blockStyle.Count "block layer-zero style retained"
Assert-Equal "requires_block_instance" $blockStyle[0].ColorResolutionStatus `
    "block layer-zero color is not falsely flattened"
Assert-Equal "requires_block_instance" $blockStyle[0].LinetypeResolutionStatus `
    "block layer-zero linetype is not falsely flattened"

$customPattern = @($document.Linetypes | Where-Object Name -eq "CUSTOM_PATTERN_42")
Assert-Equal 1 $customPattern.Count "custom linetype catalog entry retained"
Assert-Equal "double_chain" $customPattern[0].Family "custom name classified from dash pattern"
Assert-Equal 6 $customPattern[0].DashLengths.Count "raw custom dash pattern retained"
Assert-True $document.UnsupportedGeometryCounts.ContainsKey("solid") `
    "unsupported geometry kind is counted instead of discarded"

$json = $document.ToMap() | ConvertTo-Json -Depth 30 -Compress
Assert-Contains '"analysis_type":"engineering_line_semantics"' $json "JSON analysis type"
Assert-Contains '"no_style_is_discarded":true' $json "open vocabulary contract"
Assert-Contains '"unknown_colors":"retained_with_usage_and_source_handles"' $json `
    "future colors contract"
$markdown = $document.ToMarkdown()
Assert-Contains "开放词汇保留" $markdown "markdown unresolved style section"
Assert-Contains "法向偏置" $markdown "markdown offset symmetry"

$sampleNames = @(
    "5TBC.384.A110050.1_1",
    "5TBC.384.A110050.2_1",
    "5TBC.426.A110050.1_1",
    "5TBC.457.A110050.1_1",
    "5TBC.709.A110050.1_1",
    "5TBC.709.A110050.1_2",
    "8TBC.312.A110050.101_1"
)
$expectedLayerStyles = @{
    "1轮廓实线层" = [pscustomobject]@{ Colors = @("white"); Linetype = "Continuous" }
    "2细线层" = [pscustomobject]@{ Colors = @("cyan", "green"); Linetype = "Continuous" }
    "3中心线层" = [pscustomobject]@{ Colors = @("red"); Linetype = "CENTER" }
    "4虚线层" = [pscustomobject]@{ Colors = @("yellow", "magenta"); Linetype = "DASHED" }
    "5剖面线层" = [pscustomobject]@{ Colors = @("yellow"); Linetype = "Continuous" }
    "6文字层" = [pscustomobject]@{ Colors = @("green"); Linetype = "Continuous" }
    "7标注层" = [pscustomobject]@{ Colors = @("cyan"); Linetype = "Continuous" }
    "9双点划线层" = [pscustomobject]@{ Colors = @("magenta"); Linetype = "DIVIDE" }
}
$validatedDrawings = 0
if (Test-Path -LiteralPath $ExtractionRoot) {
    foreach ($sampleName in $sampleNames) {
        $tablesPath = Join-Path (Join-Path $ExtractionRoot $sampleName) "tables.json"
        if (-not (Test-Path -LiteralPath $tablesPath)) {
            continue
        }
        $tables = Get-Content -LiteralPath $tablesPath -Raw | ConvertFrom-Json
        foreach ($entry in $expectedLayerStyles.GetEnumerator()) {
            $matched = @($tables.layers | Where-Object name -eq $entry.Key)
            Assert-Equal 1 $matched.Count "$sampleName layer $($entry.Key)"
            Assert-True ($entry.Value.Colors -contains [string]$matched[0].color) `
                "$sampleName preserves observed color variant for $($entry.Key)"
            Assert-Equal $entry.Value.Linetype ([string]$matched[0].linetype) `
                "$sampleName linetype $($entry.Key)"
        }
        $validatedDrawings++
    }
}

Write-Host "Engineering line semantics test passed."
Write-Host "Synthetic observations: $($observations.Count)"
Write-Host "Style profiles: $($document.StyleProfiles.Count)"
Write-Host "Unresolved profiles: $($document.UnresolvedStyleProfiles.Count)"
Write-Host "Topology components: $($document.Components.Count)"
Write-Host "Repeated patterns: $($document.RepeatedPatterns.Count)"
Write-Host "Symmetry evaluations: $($document.SymmetryEvaluations.Count)"
Write-Host "Existing THCAD drawings checked: $validatedDrawings"
