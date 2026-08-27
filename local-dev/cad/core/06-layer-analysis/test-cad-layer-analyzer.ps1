param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
$analyzerSource = Join-Path $scriptRoot "CadLayerAnalyzer.cs"
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}

if ($null -eq ("Shb.Cad.Core.CadLayerAnalyzer" -as [type])) {
    Add-Type -Path $analyzerSource
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message expected=$Expected actual=$Actual"
    }
}

function Assert-Contains {
    param([string]$ExpectedSubstring, [string]$Actual, [string]$Message)
    if (-not $Actual.Contains($ExpectedSubstring)) {
        throw "$Message missing=[$ExpectedSubstring]"
    }
}

function New-LayerDefinition {
    param($Record)
    return [Shb.Cad.Core.CadLayerDefinitionObservation]::new(
        [string]$Record.name,
        [string]$Record.handle,
        [bool]$Record.off,
        [bool]$Record.frozen,
        [bool]$Record.locked,
        [string]$Record.color,
        [string]$Record.linetype)
}

function New-LayerEntity {
    param($Record)
    $blockName = ""
    if ($Record.managed_type -eq "BlockReference" -and $null -ne $Record.geometry) {
        $blockName = [string]$Record.geometry.block_name
    }
    return [Shb.Cad.Core.CadLayerEntityObservation]::new(
        [string]$Record.handle,
        [string]$Record.layer,
        [string]$Record.owner_scope,
        [string]$Record.owner_block_name,
        [string]$Record.managed_type,
        [bool]$Record.visible,
        ($Record.decode_status -eq "proxy"),
        $blockName)
}

$expected = [ordered]@{
    "5TBC.384.A110050.1_1"   = @{ Defined = 60; Used = 50; Entities = 25532; Model = 3243; Block = 22289; OffModel = 24; BlockRefs = 229; Layer0Refs = 144; Layer0Block = 1738 }
    "5TBC.384.A110050.2_1"   = @{ Defined = 36; Used = 30; Entities = 3570;  Model = 1487; Block = 2083;  OffModel = 25; BlockRefs = 71;  Layer0Refs = 39;  Layer0Block = 206 }
    "5TBC.426.A110050.1_1"   = @{ Defined = 58; Used = 50; Entities = 26038; Model = 666;  Block = 25372; OffModel = 24; BlockRefs = 86;  Layer0Refs = 56;  Layer0Block = 1790 }
    "5TBC.457.A110050.1_1"   = @{ Defined = 65; Used = 50; Entities = 15622; Model = 2642; Block = 12980; OffModel = 33; BlockRefs = 207; Layer0Refs = 128; Layer0Block = 1871 }
    "5TBC.709.A110050.1_1"   = @{ Defined = 56; Used = 49; Entities = 15417; Model = 2823; Block = 12594; OffModel = 24; BlockRefs = 157; Layer0Refs = 134; Layer0Block = 2086 }
    "5TBC.709.A110050.1_2"   = @{ Defined = 33; Used = 27; Entities = 4013;  Model = 981;  Block = 3032;  OffModel = 24; BlockRefs = 122; Layer0Refs = 36;  Layer0Block = 266 }
    "8TBC.312.A110050.101_1" = @{ Defined = 27; Used = 16; Entities = 1413;  Model = 323;  Block = 1090;  OffModel = 8;  BlockRefs = 9;   Layer0Refs = 4;   Layer0Block = 48 }
}

$documents = @{}
$rows = @()
$layerPresence = @{}
$totalEntities = 0
$totalModel = 0
$totalBlock = 0
$totalOffModel = 0
foreach ($drawingId in $expected.Keys) {
    $drawingDir = Join-Path $ExtractionRoot $drawingId
    $tablesPath = Join-Path $drawingDir "tables.json"
    $entitiesPath = Join-Path $drawingDir "entities.jsonl"
    if (-not (Test-Path -LiteralPath $tablesPath) -or -not (Test-Path -LiteralPath $entitiesPath)) {
        throw "Missing extraction for $drawingId"
    }

    $tables = Get-Content -LiteralPath $tablesPath -Raw | ConvertFrom-Json
    $definitions = [System.Collections.Generic.List[Shb.Cad.Core.CadLayerDefinitionObservation]]::new()
    foreach ($layer in $tables.layers) {
        $definitions.Add((New-LayerDefinition $layer))
        $key = ([string]$layer.name).ToUpperInvariant()
        if (-not $layerPresence.ContainsKey($key)) {
            $layerPresence[$key] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        }
        [void]$layerPresence[$key].Add($drawingId)
    }

    $entities = [System.Collections.Generic.List[Shb.Cad.Core.CadLayerEntityObservation]]::new()
    foreach ($line in Get-Content -LiteralPath $entitiesPath) {
        $entities.Add((New-LayerEntity ($line | ConvertFrom-Json)))
    }
    $document = [Shb.Cad.Core.CadLayerAnalyzer]::Analyze(
        $drawingId,
        $definitions,
        $entities,
        8)
    $documents[$drawingId] = $document
    $spec = $expected[$drawingId]

    Assert-Equal $spec.Defined $document.DefinedLayerCount "$drawingId defined layers"
    Assert-Equal $spec.Used $document.UsedDefinedLayerCount "$drawingId used layers"
    Assert-Equal ($spec.Defined - $spec.Used) $document.UnusedDefinedLayerNames.Count "$drawingId unused layers"
    Assert-Equal $spec.Entities $document.EntityCount "$drawingId entities"
    Assert-Equal $spec.Model $document.ModelSpaceEntityCount "$drawingId model entities"
    Assert-Equal $spec.Block $document.BlockDefinitionEntityCount "$drawingId block definition entities"
    Assert-Equal $spec.OffModel $document.LayerSuppressedModelEntityCount "$drawingId layer-suppressed model entities"
    Assert-Equal ($spec.Model - $spec.OffModel) $document.DirectlyDisplayableModelEntityCount "$drawingId directly displayable model entities"
    Assert-Equal 0 $document.ExplicitlyInvisibleModelEntityCount "$drawingId explicitly invisible model entities"
    Assert-Equal 0 $document.EntityWithoutLayerCount "$drawingId entities without layer"
    Assert-Equal 0 $document.UndefinedReferencedLayerNames.Count "$drawingId undefined layer references"
    Assert-Equal 0 $document.DuplicateDefinitionNames.Count "$drawingId duplicate layer definitions"
    Assert-Equal $spec.BlockRefs $document.ModelSpaceBlockReferenceCount "$drawingId model block references"
    Assert-Equal $spec.Layer0Refs $document.LayerZeroModelBlockReferenceCount "$drawingId layer 0 model block references"
    Assert-Equal $spec.Layer0Block $document.LayerZeroBlockDefinitionEntityCount "$drawingId layer 0 block definition entities"

    $offLayers = @($document.Layers | Where-Object IsOff)
    Assert-Equal 1 $offLayers.Count "$drawingId off layer count"
    Assert-Equal "消隐层" $offLayers[0].Name "$drawingId off layer name"
    Assert-Equal $spec.OffModel $offLayers[0].ModelSpaceEntityCount "$drawingId hidden-layer model count"
    Assert-Equal 0 @($document.Layers | Where-Object IsFrozen).Count "$drawingId frozen layers"
    Assert-Equal 0 @($document.Layers | Where-Object IsLocked).Count "$drawingId locked layers"
    Assert-Equal $spec.OffModel $document.FindEntityHandles("消隐层", "model_space").Count "$drawingId layer handle query"

    $json = $document.ToMap() | ConvertTo-Json -Depth 20 -Compress
    Assert-Contains '"analysis_type":"cad_layers"' $json "$drawingId JSON"
    $markdown = $document.ToMarkdown()
    Assert-Contains '# 图层分析' $markdown "$drawingId Markdown heading"
    Assert-Contains '`消隐层` **[关闭]**' $markdown "$drawingId Markdown off layer"
    Assert-Contains '图层引用完整' $markdown "$drawingId Markdown reference integrity"

    $totalEntities += $document.EntityCount
    $totalModel += $document.ModelSpaceEntityCount
    $totalBlock += $document.BlockDefinitionEntityCount
    $totalOffModel += $document.LayerSuppressedModelEntityCount
    $rows += [pscustomobject]@{
        Drawing = $drawingId
        Defined = $document.DefinedLayerCount
        Used = $document.UsedDefinedLayerCount
        Model = $document.ModelSpaceEntityCount
        BlockDefs = $document.BlockDefinitionEntityCount
        OffLayerEntities = $document.LayerSuppressedModelEntityCount
    }
}

Assert-Equal 91605 $totalEntities "seven-drawing entities"
Assert-Equal 12165 $totalModel "seven-drawing model entities"
Assert-Equal 79440 $totalBlock "seven-drawing block definition entities"
Assert-Equal 162 $totalOffModel "seven-drawing off-layer model entities"
Assert-Equal 95 $layerPresence.Count "seven-drawing distinct layer names"
Assert-Equal 22 @($layerPresence.Values | Where-Object Count -eq 7).Count "layers common to seven drawings"

# Synthetic regression: distinguish layer suppression from entity.Visible,
# retain undefined/missing references, and expose a handle query without
# duplicating every handle in the JSON summary.
$syntheticDefinitions = [System.Collections.Generic.List[Shb.Cad.Core.CadLayerDefinitionObservation]]::new()
$syntheticDefinitions.Add([Shb.Cad.Core.CadLayerDefinitionObservation]::new("0", "10", $false, $false, $false, "white", "Continuous"))
$syntheticDefinitions.Add([Shb.Cad.Core.CadLayerDefinitionObservation]::new("A", "11", $true, $false, $false, "red", "Continuous"))
$syntheticDefinitions.Add([Shb.Cad.Core.CadLayerDefinitionObservation]::new("B", "12", $false, $false, $true, "green", "Dashed"))
$syntheticEntities = [System.Collections.Generic.List[Shb.Cad.Core.CadLayerEntityObservation]]::new()
$syntheticEntities.Add([Shb.Cad.Core.CadLayerEntityObservation]::new("a1", "A", "model_space", "*Model_Space", "Line", $true, $false, ""))
$syntheticEntities.Add([Shb.Cad.Core.CadLayerEntityObservation]::new("a2", "A", "block_definition", "BLOCK", "Line", $true, $false, ""))
$syntheticEntities.Add([Shb.Cad.Core.CadLayerEntityObservation]::new("a3", "A", "model_space", "*Model_Space", "Circle", $false, $false, ""))
$syntheticEntities.Add([Shb.Cad.Core.CadLayerEntityObservation]::new("u1", "UNKNOWN", "model_space", "*Model_Space", "Line", $true, $false, ""))
$syntheticEntities.Add([Shb.Cad.Core.CadLayerEntityObservation]::new("missing", "", "model_space", "*Model_Space", "Line", $true, $false, ""))
$syntheticEntities.Add([Shb.Cad.Core.CadLayerEntityObservation]::new("br", "0", "model_space", "*Model_Space", "BlockReference", $true, $false, "BLOCK"))
$syntheticEntities.Add([Shb.Cad.Core.CadLayerEntityObservation]::new("child", "0", "block_definition", "BLOCK", "Line", $true, $false, ""))
$synthetic = [Shb.Cad.Core.CadLayerAnalyzer]::Analyze("synthetic", $syntheticDefinitions, $syntheticEntities, 2)
Assert-Equal 3 $synthetic.DefinedLayerCount "synthetic defined layers"
Assert-Equal 2 $synthetic.UsedDefinedLayerCount "synthetic used definitions"
Assert-Equal "B" ($synthetic.UnusedDefinedLayerNames -join ",") "synthetic unused definition"
Assert-Equal "UNKNOWN" ($synthetic.UndefinedReferencedLayerNames -join ",") "synthetic undefined reference"
Assert-Equal 1 $synthetic.EntityWithoutLayerCount "synthetic missing layer"
Assert-Equal 5 $synthetic.ModelSpaceEntityCount "synthetic model entities"
Assert-Equal 2 $synthetic.BlockDefinitionEntityCount "synthetic block definition entities"
Assert-Equal 2 $synthetic.LayerSuppressedModelEntityCount "synthetic layer suppression"
Assert-Equal 1 $synthetic.ExplicitlyInvisibleModelEntityCount "synthetic explicit visibility"
Assert-Equal 2 $synthetic.DirectlyDisplayableModelEntityCount "synthetic directly displayable"
Assert-Equal "a1,a3" ($synthetic.FindEntityHandles("a", "model_space") -join ",") "synthetic case-insensitive handle query"

$rows | Format-Table -AutoSize
Write-Host "PASS: 7/7 drawings; 95 distinct and 22 common layers; 91,605 entities all resolve; 162 model entities on the off layer; block semantics and handle queries."
