param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
$extractorSource = Join-Path $scriptRoot "TechnicalRequirementsExtractor.cs"
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}

if ($null -eq ("Shb.Cad.Core.TechnicalRequirementsExtractor" -as [type])) {
    Add-Type -Path $extractorSource
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message expected=$Expected actual=$Actual"
    }
}

function Assert-Contains {
    param([string]$ExpectedSubstring, [string]$Actual, [string]$Message)
    if ($Actual -notlike "*$ExpectedSubstring*") {
        throw "$Message missing=[$ExpectedSubstring]"
    }
}

function Get-PlainText {
    param($Record)
    if ($Record.text -is [string]) {
        return [string]$Record.text
    }
    if ($null -ne $Record.text -and $null -ne $Record.text.plain) {
        return [string]$Record.text.plain
    }
    return ""
}

function New-TextObservation {
    param($Record)
    if ($null -eq $Record.bbox) {
        return $null
    }
    return [Shb.Cad.Core.TechnicalRequirementTextObservation]::new(
        [string]$Record.handle,
        [string]$Record.layer,
        (Get-PlainText $Record),
        [double]$Record.bbox.min[0],
        [double]$Record.bbox.min[1],
        [double]$Record.bbox.max[0],
        [double]$Record.bbox.max[1])
}

$expected = [ordered]@{
    "5TBC.384.A110050.1_1"   = @{ Bounds = @(0, 0, 16120, 11480); Titles = 1; Sections = 1; Items = 12; Maximum = 13; Missing = "6" }
    "5TBC.384.A110050.2_1"   = @{ Bounds = @(0, 0, 16120, 11480); Titles = 1; Sections = 1; Items = 12; Maximum = 12; Missing = "" }
    "5TBC.426.A110050.1_1"   = @{ Bounds = @(0, 0, 20150, 14350); Titles = 1; Sections = 1; Items = 7;  Maximum = 7;  Missing = "" }
    "5TBC.457.A110050.1_1"   = @{ Bounds = @(0, 0, 20150, 14350); Titles = 1; Sections = 1; Items = 8;  Maximum = 8;  Missing = "" }
    "5TBC.709.A110050.1_1"   = @{ Bounds = @(0, 0, 20150, 14350); Titles = 1; Sections = 1; Items = 12; Maximum = 12; Missing = "" }
    "5TBC.709.A110050.1_2"   = @{ Bounds = @(0, 0, 20150, 14350); Titles = 0; Sections = 0; Items = 0;  Maximum = 0;  Missing = "" }
    "8TBC.312.A110050.101_1" = @{ Bounds = @(0, 0, 7800, 5740);   Titles = 1; Sections = 1; Items = 3;  Maximum = 3;  Missing = "" }
}

$documents = @{}
$rows = @()
$totalItems = 0
$totalContinuationLines = 0
foreach ($drawingId in $expected.Keys) {
    $entitiesPath = Join-Path $ExtractionRoot "$drawingId\entities.jsonl"
    if (-not (Test-Path -LiteralPath $entitiesPath)) {
        throw "Missing extraction: $entitiesPath"
    }

    $texts = [System.Collections.Generic.List[Shb.Cad.Core.TechnicalRequirementTextObservation]]::new()
    foreach ($line in Get-Content -LiteralPath $entitiesPath) {
        if ($line -notlike '*"owner_scope":"model_space"*' `
            -or ($line -notlike '*"managed_type":"DBText"*' `
                -and $line -notlike '*"managed_type":"MText"*')) {
            continue
        }
        $record = $line | ConvertFrom-Json
        $observation = New-TextObservation $record
        if ($null -ne $observation) {
            $texts.Add($observation)
        }
    }

    $spec = $expected[$drawingId]
    $bounds = $spec.Bounds
    $frames = [System.Collections.Generic.List[Shb.Cad.Core.TechnicalRequirementsFrameBounds]]::new()
    $frames.Add([Shb.Cad.Core.TechnicalRequirementsFrameBounds]::new(
        "drawing-area-frame-1",
        $bounds[0],
        $bounds[1],
        $bounds[2],
        $bounds[3]))
    $document = [Shb.Cad.Core.TechnicalRequirementsExtractor]::Extract(
        $drawingId,
        $frames,
        $texts,
        $null)
    $documents[$drawingId] = $document

    Assert-Equal $spec.Titles $document.TitleCandidateCount "$drawingId title candidates"
    Assert-Equal $spec.Sections $document.Sections.Count "$drawingId sections"
    Assert-Equal $spec.Items $document.ItemCount "$drawingId items"
    if ($spec.Sections -eq 1) {
        $section = $document.Sections[0]
        Assert-Equal 1 $section.MinimumNumber "$drawingId minimum number"
        Assert-Equal $spec.Maximum $section.MaximumNumber "$drawingId maximum number"
        Assert-Equal $spec.Missing ($section.MissingNumbers -join ",") "$drawingId missing numbers"
        Assert-Equal 0 $section.DuplicateNumbers.Count "$drawingId duplicate numbers"
        Assert-Equal $true $section.SpatialOrderIsStrictlyIncreasing "$drawingId spatial order"
        Assert-Equal ([string]::IsNullOrEmpty($spec.Missing)) $section.SequenceIsContiguous "$drawingId contiguous sequence"
        foreach ($item in $section.Items) {
            $totalContinuationLines += $item.RawLines.Count - 1
        }
    }

    $json = $document.ToMap() | ConvertTo-Json -Depth 20 -Compress
    Assert-Contains '"knowledge_type":"technical_requirements"' $json "$drawingId JSON"
    $markdown = $document.ToMarkdown()
    Assert-Contains '# 技术要求' $markdown "$drawingId Markdown heading"
    if ($spec.Sections -eq 0) {
        Assert-Contains '未检测到包含“技术要求”的标题' $markdown "$drawingId no-title Markdown"
    }

    $totalItems += $document.ItemCount
    $rows += [pscustomobject]@{
        Drawing = $drawingId
        Titles = $document.TitleCandidateCount
        Sections = $document.Sections.Count
        Items = $document.ItemCount
        Missing = if ($document.Sections.Count -eq 1) { $document.Sections[0].MissingNumbers -join "," } else { "-" }
    }
}

Assert-Equal 54 $totalItems "seven-drawing technical requirement items"
Assert-Equal 5 $totalContinuationLines "seven-drawing continuation lines"

$upper384 = $documents["5TBC.384.A110050.1_1"].Sections[0]
$upperItem10 = @($upper384.Items | Where-Object Number -eq 10)[0]
Assert-Equal 2 $upperItem10.RawLines.Count "upper 384 item 10 source lines"
Assert-Equal '通用件表面粗糙度及棱角倒角尺寸按Q/TT J31.070200.5-2021和Q/TT J31.070200.6-2021实施；' $upperItem10.Content "upper 384 item 10 merged content"
Assert-Contains '缺号 6' $documents["5TBC.384.A110050.1_1"].ToMarkdown() "upper 384 missing-number Markdown"

$lower384 = $documents["5TBC.384.A110050.2_1"].Sections[0]
$lowerItem6 = @($lower384.Items | Where-Object Number -eq 6)[0]
Assert-Equal '33EE' $lowerItem6.SourceHandles[0] "lower 384 item 6 handle"
$lowerItem11 = @($lower384.Items | Where-Object Number -eq 11)[0]
Assert-Equal 2 $lowerItem11.RawLines.Count "lower 384 item 11 source lines"
Assert-Contains '深度5mm' $lowerItem11.Content "lower 384 item 11 merged content"

$connection457 = $documents["5TBC.457.A110050.1_1"].Sections[0]
$connectionItem8 = @($connection457.Items | Where-Object Number -eq 8)[0]
Assert-Equal 2 $connectionItem8.RawLines.Count "457 item 8 source lines"
Assert-Contains '按Q/TT J31.070200.5-2021' $connectionItem8.Content "457 item 8 merged content"

$general709 = $documents["5TBC.709.A110050.1_1"].Sections[0]
$generalItem8 = @($general709.Items | Where-Object Number -eq 8)[0]
Assert-Equal 2 $generalItem8.RawLines.Count "709 item 8 source lines"
Assert-Contains '深度5mm' $generalItem8.Content "709 item 8 merged content"

# Synthetic regression: the title only needs to contain the marker; a missing
# number is reported, an indented continuation is joined, and distant numbered
# noise is not pulled into the section.
$syntheticFrames = [System.Collections.Generic.List[Shb.Cad.Core.TechnicalRequirementsFrameBounds]]::new()
$syntheticFrames.Add([Shb.Cad.Core.TechnicalRequirementsFrameBounds]::new("f", 0, 0, 1000, 800))
$syntheticTexts = [System.Collections.Generic.List[Shb.Cad.Core.TechnicalRequirementTextObservation]]::new()
$syntheticTexts.Add([Shb.Cad.Core.TechnicalRequirementTextObservation]::new("title", "文字", "一、技术要求（续）", 700, 720, 880, 760))
$syntheticTexts.Add([Shb.Cad.Core.TechnicalRequirementTextObservation]::new("one", "文字", "1.第一条", 620, 670, 850, 710))
$syntheticTexts.Add([Shb.Cad.Core.TechnicalRequirementTextObservation]::new("continuation", "文字", "续行内容；", 635, 645, 850, 665))
$syntheticTexts.Add([Shb.Cad.Core.TechnicalRequirementTextObservation]::new("three", "文字", "3.第三条", 622, 610, 850, 650))
$syntheticTexts.Add([Shb.Cad.Core.TechnicalRequirementTextObservation]::new("noise", "文字", "4.远处编号噪声", 100, 540, 300, 580))
$synthetic = [Shb.Cad.Core.TechnicalRequirementsExtractor]::Extract("synthetic", $syntheticFrames, $syntheticTexts, $null)
Assert-Equal 1 $synthetic.Sections.Count "synthetic section"
Assert-Equal 2 $synthetic.ItemCount "synthetic items"
Assert-Equal "2" ($synthetic.Sections[0].MissingNumbers -join ",") "synthetic missing number"
Assert-Equal "第一条续行内容；" $synthetic.Sections[0].Items[0].Content "synthetic continuation"

$rows | Format-Table -AutoSize
Write-Host "PASS: 7/7 drawings; 6 sections; 54 items; 5 continuation lines; true missing 6 reported; JSON and Markdown views."
