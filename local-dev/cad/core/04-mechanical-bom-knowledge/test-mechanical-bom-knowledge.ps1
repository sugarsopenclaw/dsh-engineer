param(
    [string]$ExtractionRoot
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot "..\..\..\.."))
$builderSource = Join-Path $scriptRoot "MechanicalBomKnowledgeBuilder.cs"
if ([string]::IsNullOrWhiteSpace($ExtractionRoot)) {
    $ExtractionRoot = Join-Path $repoRoot "dev-test\visualstudionetframework\out-thcad"
}

if ($null -eq ("Shb.Cad.Core.MechanicalBomKnowledgeBuilder" -as [type])) {
    Add-Type -Path $builderSource
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message expected=$Expected actual=$Actual"
    }
}

function Get-Coordinate {
    param($Values, [int]$Index, [double]$Fallback = 0)
    if ($null -eq $Values -or $Values.Count -le $Index) {
        return $Fallback
    }
    return [double]$Values[$Index]
}

function Get-ThXuhaoItemNumber {
    param($Record)
    if ($null -eq $Record.xdata) {
        return ""
    }
    $property = $Record.xdata.PSObject.Properties["TH_XUHAO"]
    if ($null -eq $property) {
        return ""
    }
    foreach ($typedValue in $property.Value) {
        if ([int]$typedValue.code -eq 1000) {
            return [string]$typedValue.value
        }
    }
    return ""
}

function New-BomObservation {
    param($Record)

    $cells = [System.Collections.Generic.List[Shb.Cad.Core.MechanicalBomCellObservation]]::new()
    foreach ($attribute in $Record.attributes) {
        $cells.Add([Shb.Cad.Core.MechanicalBomCellObservation]::new(
            [string]$attribute.tag,
            [string]$attribute.value,
            [string]$attribute.handle,
            (Get-Coordinate $attribute.position 0 ([double]::NaN)),
            (Get-Coordinate $attribute.position 1 ([double]::NaN))))
    }

    $positionX = Get-Coordinate $Record.geometry.position 0 0
    $positionY = Get-Coordinate $Record.geometry.position 1 0
    return [Shb.Cad.Core.MechanicalBomRowObservation]::new(
        [string]$Record.handle,
        $positionX,
        $positionY,
        (Get-Coordinate $Record.bbox.min 0 $positionX),
        (Get-Coordinate $Record.bbox.min 1 $positionY),
        (Get-Coordinate $Record.bbox.max 0 $positionX),
        (Get-Coordinate $Record.bbox.max 1 $positionY),
        (Get-ThXuhaoItemNumber $Record),
        $cells)
}

function New-SyntheticObservation {
    param(
        [string]$Handle,
        [string]$ItemNumber,
        [string]$XDataItemNumber,
        [string]$Quantity = "1",
        [switch]$OmitRemark,
        [switch]$DuplicateName
    )

    $values = [ordered]@{
        "序号" = $ItemNumber
        "代号" = "PART-$ItemNumber"
        "名称" = "零件$ItemNumber"
        "数量" = $Quantity
        "材料" = "Q235B"
        "单重" = "1.25"
        "总重" = "2.5"
        "备注" = ""
    }
    $cells = [System.Collections.Generic.List[Shb.Cad.Core.MechanicalBomCellObservation]]::new()
    $index = 0
    foreach ($pair in $values.GetEnumerator()) {
        if ($OmitRemark -and $pair.Key -eq "备注") {
            continue
        }
        $cells.Add([Shb.Cad.Core.MechanicalBomCellObservation]::new(
            [string]$pair.Key,
            [string]$pair.Value,
            "$Handle-$index",
            [double]$index,
            [double]$ItemNumber))
        $index++
    }
    if ($DuplicateName) {
        $cells.Add([Shb.Cad.Core.MechanicalBomCellObservation]::new(
            "名称", "重复名称", "$Handle-duplicate", 2, [double]$ItemNumber))
    }
    return [Shb.Cad.Core.MechanicalBomRowObservation]::new(
        $Handle, 100, [double]$ItemNumber, 0, [double]$ItemNumber,
        100, [double]$ItemNumber + 1, $XDataItemNumber, $cells)
}

$expectedRowCounts = [ordered]@{
    "5TBC.384.A110050.1_1"   = 45
    "5TBC.384.A110050.2_1"   = 24
    "5TBC.426.A110050.1_1"   = 18
    "5TBC.457.A110050.1_1"   = 57
    "5TBC.709.A110050.1_1"   = 0
    "5TBC.709.A110050.1_2"   = 64
    "8TBC.312.A110050.101_1" = 0
}
$expectedLabels = @("序号", "代号", "名称", "数量", "材料", "单重", "总重", "备注")
$results = @()
$documents = @{}
$totalRows = 0

foreach ($drawingId in $expectedRowCounts.Keys) {
    $entitiesPath = Join-Path $ExtractionRoot "$drawingId\entities.jsonl"
    if (-not (Test-Path -LiteralPath $entitiesPath)) {
        throw "Missing extraction: $entitiesPath"
    }

    $observations = [System.Collections.Generic.List[Shb.Cad.Core.MechanicalBomRowObservation]]::new()
    foreach ($line in Get-Content -LiteralPath $entitiesPath) {
        if ($line -notlike '*"owner_scope":"model_space"*' `
            -or $line -notlike '*"block_name":"PC_MXB_BLOCK"*') {
            continue
        }
        $record = $line | ConvertFrom-Json
        $observations.Add((New-BomObservation $record))
    }

    $document = [Shb.Cad.Core.MechanicalBomKnowledgeBuilder]::Build($drawingId, $observations)
    $documents[$drawingId] = $document
    $expectedRows = $expectedRowCounts[$drawingId]
    Assert-Equal $expectedRows $document.RowCount "$drawingId BOM row count"
    Assert-Equal ([int]($expectedRows -gt 0)) $document.Tables.Count "$drawingId BOM table count"

    if ($expectedRows -gt 0) {
        $table = $document.Tables[0]
        Assert-Equal 8 $table.Columns.Count "$drawingId column count"
        Assert-Equal ($expectedLabels -join "|") (($table.Columns | ForEach-Object Label) -join "|") "$drawingId labels"
        Assert-Equal 1 $table.MinimumItemNumber "$drawingId minimum item number"
        Assert-Equal $expectedRows $table.MaximumItemNumber "$drawingId maximum item number"
        Assert-Equal $true $table.SequenceIsContiguous "$drawingId contiguous sequence"
        Assert-Equal 0 $table.SequenceGaps.Count "$drawingId sequence gaps"
        Assert-Equal 0 $table.DuplicateItemNumbers.Count "$drawingId duplicate item numbers"
        Assert-Equal $expectedRows $table.XDataComparableRowCount "$drawingId TH_XUHAO comparable rows"
        Assert-Equal $expectedRows $table.XDataMatchingRowCount "$drawingId TH_XUHAO matching rows"
        foreach ($row in $table.Rows) {
            Assert-Equal 8 $row.Values.Count "$drawingId row $($row.Id) normalized cell count"
            Assert-Equal 0 $row.MissingColumns.Count "$drawingId row $($row.Id) missing columns"
            Assert-Equal 0 $row.DuplicateLabels.Count "$drawingId row $($row.Id) duplicate labels"
        }
    }

    $json = $document.ToMap() | ConvertTo-Json -Depth 20 -Compress
    if ($json -notlike '*"knowledge_type":"mechanical_bill_of_materials"*') {
        throw "$drawingId knowledge document did not serialize"
    }

    $totalRows += $document.RowCount
    $results += [pscustomobject]@{
        Drawing = $drawingId
        Tables = $document.Tables.Count
        Rows = $document.RowCount
        Sequence = if ($expectedRows -gt 0) { "1-$expectedRows" } else { "-" }
        ThXuhaoMatches = if ($expectedRows -gt 0) { "$expectedRows/$expectedRows" } else { "-" }
    }
}

Assert-Equal 208 $totalRows "seven-drawing total BOM rows"

# The table visible in the user's screenshot is the 24-row BOM in the lower
# 5TBC.384 drawing. Keep exact raw strings, including notation such as (1).
$lower384 = $documents["5TBC.384.A110050.2_1"].Tables[0]
$row24 = @($lower384.Rows | Where-Object ItemNumber -eq 24)
Assert-Equal 1 $row24.Count "lower 384 row 24"
Assert-Equal "8TBT.166.T00003.1" $row24[0].Values["part_number"] "lower 384 row 24 part number"
Assert-Equal "方钢12×13600" $row24[0].Values["name"] "lower 384 row 24 name"
Assert-Equal "1" $row24[0].Values["quantity"] "lower 384 row 24 quantity"

$row20 = @($lower384.Rows | Where-Object ItemNumber -eq 20)
Assert-Equal 1 $row20.Count "lower 384 row 20"
Assert-Equal "(1)" $row20[0].Values["quantity"] "lower 384 row 20 raw quantity"
$row20Quantity = $row20[0].ParsedValues["quantity"]
Assert-Equal 1 $row20Quantity["value"] "lower 384 row 20 parsed quantity"
Assert-Equal "parenthesized" $row20Quantity["notation"] "lower 384 row 20 quantity notation"

# Synthetic regression: report gaps, duplicates, XData mismatches, missing
# columns, and duplicate attribute labels instead of silently normalizing them.
$problemRows = [System.Collections.Generic.List[Shb.Cad.Core.MechanicalBomRowObservation]]::new()
$problemRows.Add((New-SyntheticObservation "r1" "1" "1"))
$problemRows.Add((New-SyntheticObservation "r3a" "3" "3"))
$problemRows.Add((New-SyntheticObservation "r3b" "3" "99"))
$problem = [Shb.Cad.Core.MechanicalBomKnowledgeBuilder]::Build("synthetic-problem", $problemRows).Tables[0]
Assert-Equal $false $problem.SequenceIsContiguous "synthetic non-contiguous sequence"
Assert-Equal "2" ($problem.SequenceGaps -join ",") "synthetic sequence gap"
Assert-Equal "3" ($problem.DuplicateItemNumbers -join ",") "synthetic duplicate item number"
Assert-Equal 3 $problem.XDataComparableRowCount "synthetic comparable XData"
Assert-Equal 2 $problem.XDataMatchingRowCount "synthetic matching XData"

$qualityRows = [System.Collections.Generic.List[Shb.Cad.Core.MechanicalBomRowObservation]]::new()
$qualityRows.Add((New-SyntheticObservation "quality" "1" "1" -OmitRemark -DuplicateName))
$quality = [Shb.Cad.Core.MechanicalBomKnowledgeBuilder]::Build("synthetic-quality", $qualityRows).Tables[0].Rows[0]
Assert-Equal "remark" ($quality.MissingColumns -join ",") "synthetic missing column"
Assert-Equal "名称" ($quality.DuplicateLabels -join ",") "synthetic duplicate label"

$results | Format-Table -AutoSize
Write-Host "PASS: 7/7 drawings; 5 native BOM tables; 208 rows; 8 fields per row; all TH_XUHAO values match; quality regressions."
