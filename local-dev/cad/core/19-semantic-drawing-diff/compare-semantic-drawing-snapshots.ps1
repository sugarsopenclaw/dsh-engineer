param(
    [Parameter(Mandatory = $true)]
    [string]$BaselinePath,
    [Parameter(Mandatory = $true)]
    [string]$CurrentPath,
    [string]$OutputDirectory,
    [switch]$AllowUnverifiedIdentity,
    [double]$AbsoluteCoordinateTolerance = 0.05,
    [double]$RelativeCoordinateTolerance = 0.000001
)

$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'SemanticDrawingDiffAnalyzer.cs')

function Get-PropertyValue($Object, [string]$Name, $Default = $null) {
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Add-StringMap($Element, $Object, [string]$Kind) {
    if ($null -eq $Object) { return }
    foreach ($property in $Object.PSObject.Properties) {
        if ($Kind -eq 'semantic') {
            $Element.AddSemanticValue($property.Name, [string]$property.Value) | Out-Null
        } elseif ($Kind -eq 'style') {
            $Element.AddStyleValue($property.Name, [string]$property.Value) | Out-Null
        }
    }
}

function Add-NumberMap($Element, $Object, [string]$Kind) {
    if ($null -eq $Object) { return }
    foreach ($property in $Object.PSObject.Properties) {
        if ($null -eq $property.Value) { continue }
        if ($Kind -eq 'semantic') {
            $Element.AddSemanticNumber($property.Name, [double]$property.Value) | Out-Null
        } elseif ($Kind -eq 'geometry') {
            $Element.AddGeometryMetric($property.Name, [double]$property.Value) | Out-Null
        }
    }
}

function Read-SemanticSnapshot([string]$Path) {
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $raw = [IO.File]::ReadAllText(
        $resolved,
        [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json
    if ([string](Get-PropertyValue $raw 'analysis_type' '') -ne 'semantic_drawing_snapshot') {
        throw "Not a semantic_drawing_snapshot: $resolved"
    }
    $rawIdentity = Get-PropertyValue $raw 'identity'
    $identity = [Shb.Cad.Core.SemanticDrawingIdentityObservation]::new(
        [string](Get-PropertyValue $rawIdentity 'drawing_id' ''))
    $drawingNumber = [string](Get-PropertyValue $rawIdentity 'drawing_number' '')
    $drawingName = [string](Get-PropertyValue $rawIdentity 'drawing_name' '')
    $revision = [string](Get-PropertyValue $rawIdentity 'revision' '')
    $stage = [string](Get-PropertyValue $rawIdentity 'stage' '')
    $sheet = [string](Get-PropertyValue $rawIdentity 'sheet' '')
    $sheetCount = [string](Get-PropertyValue $rawIdentity 'sheet_count' '')
    $productModel = [string](Get-PropertyValue $rawIdentity 'product_model' '')
    if (-not [string]::IsNullOrWhiteSpace($drawingNumber)) {
        $identity.SetDrawingNumber($drawingNumber, 'snapshot_json') | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($drawingName)) {
        $identity.SetDrawingName($drawingName, 'snapshot_json') | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($revision)) {
        $identity.SetRevision($revision, 'snapshot_json') | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($stage)) {
        $identity.SetStage($stage, 'snapshot_json') | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($sheet) -or
        -not [string]::IsNullOrWhiteSpace($sheetCount)) {
        $identity.SetSheet($sheet, $sheetCount, 'snapshot_json') | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($productModel)) {
        $identity.SetProductModel($productModel, 'snapshot_json') | Out-Null
    }
    $identity.SetSource(
        [string](Get-PropertyValue $rawIdentity 'source_path' ''),
        [string](Get-PropertyValue $rawIdentity 'source_fingerprint' '')) | Out-Null

    $snapshot = [Shb.Cad.Core.SemanticDrawingSnapshotDocument]::new(
        [string](Get-PropertyValue $raw 'snapshot_id' ''),
        $identity,
        [string](Get-PropertyValue $raw 'source_status' 'computed'))
    $maximum = [Math]::Max(1, @((Get-PropertyValue $raw 'elements' @())).Count + 1)
    foreach ($rawElement in @((Get-PropertyValue $raw 'elements' @()))) {
        $element = [Shb.Cad.Core.SemanticDrawingElementObservation]::new(
            [string](Get-PropertyValue $rawElement 'element_id' ''),
            [string](Get-PropertyValue $rawElement 'domain' 'unknown'),
            [string](Get-PropertyValue $rawElement 'kind' 'unknown'),
            [string](Get-PropertyValue $rawElement 'stable_key' ''),
            [string](Get-PropertyValue $rawElement 'match_signature' ''))
        $element.SetEvidenceStatus(
            [string](Get-PropertyValue $rawElement 'evidence_status' 'computed')) | Out-Null
        $element.SetGeometrySignature(
            [string](Get-PropertyValue $rawElement 'geometry_signature' '')) | Out-Null
        $bounds = @(Get-PropertyValue $rawElement 'bounds' @())
        if ($bounds.Count -ge 4) {
            $element.SetBounds(
                [double]$bounds[0], [double]$bounds[1],
                [double]$bounds[2], [double]$bounds[3]) | Out-Null
        }
        $anchor = @(Get-PropertyValue $rawElement 'anchor' @())
        if ($anchor.Count -ge 2) {
            $element.SetAnchor([double]$anchor[0], [double]$anchor[1]) | Out-Null
        }
        Add-StringMap $element (Get-PropertyValue $rawElement 'semantic_values') 'semantic'
        Add-StringMap $element (Get-PropertyValue $rawElement 'style_values') 'style'
        Add-NumberMap $element (Get-PropertyValue $rawElement 'semantic_numbers') 'semantic'
        Add-NumberMap $element (Get-PropertyValue $rawElement 'geometry_metrics') 'geometry'
        $associations = Get-PropertyValue $rawElement 'associations'
        if ($null -ne $associations) {
            foreach ($property in $associations.PSObject.Properties) {
                foreach ($value in @($property.Value)) {
                    $element.AddAssociation($property.Name, [string]$value) | Out-Null
                }
            }
        }
        foreach ($value in @((Get-PropertyValue $rawElement 'relation_keys' @()))) {
            $element.AddRelationKey([string]$value) | Out-Null
        }
        foreach ($value in @((Get-PropertyValue $rawElement 'source_ids' @()))) {
            $element.AddSourceId([string]$value) | Out-Null
        }
        foreach ($value in @((Get-PropertyValue $rawElement 'source_handles' @()))) {
            $element.AddSourceHandle([string]$value) | Out-Null
        }
        if (-not $snapshot.AddElement($element, $maximum)) {
            throw "Snapshot reconstruction unexpectedly truncated: $resolved"
        }
    }
    foreach ($rawIssue in @((Get-PropertyValue $raw 'audit_issues' @()))) {
        $issue = [Shb.Cad.Core.SemanticDrawingIssueObservation]::new(
            [string](Get-PropertyValue $rawIssue 'issue_key' ''),
            [string](Get-PropertyValue $rawIssue 'issue_type' 'review_candidate'),
            [string](Get-PropertyValue $rawIssue 'state' 'open'),
            [string](Get-PropertyValue $rawIssue 'severity' 'review'),
            [string](Get-PropertyValue $rawIssue 'message' ''))
        foreach ($value in @((Get-PropertyValue $rawIssue 'source_ids' @()))) {
            $issue.AddSourceId([string]$value) | Out-Null
        }
        $snapshot.AddIssue($issue) | Out-Null
    }
    foreach ($rawDiagnostic in @((Get-PropertyValue $raw 'diagnostics' @()))) {
        $snapshot.AddDiagnostic([Shb.Cad.Core.SemanticDrawingSnapshotDiagnosticRecord]::new(
            [string](Get-PropertyValue $rawDiagnostic 'code' ''),
            [string](Get-PropertyValue $rawDiagnostic 'status' 'ambiguous'),
            [string](Get-PropertyValue $rawDiagnostic 'source_id' ''),
            [string](Get-PropertyValue $rawDiagnostic 'message' ''))) | Out-Null
    }
    if ([bool](Get-PropertyValue $raw 'truncated' $false)) {
        $snapshot.MarkTruncated(
            'SNAPSHOT_SOURCE_WAS_TRUNCATED',
            $resolved,
            'The serialized source snapshot was marked truncated; unmatched absence remains unknown.') | Out-Null
    }
    return $snapshot
}

$baseline = Read-SemanticSnapshot $BaselinePath
$current = Read-SemanticSnapshot $CurrentPath
$config = [Shb.Cad.Core.SemanticDrawingDiffConfig]::new()
$config.AllowUnverifiedIdentity = $AllowUnverifiedIdentity.IsPresent
$config.AbsoluteCoordinateTolerance = $AbsoluteCoordinateTolerance
$config.RelativeCoordinateTolerance = $RelativeCoordinateTolerance
$diff = [Shb.Cad.Core.SemanticDrawingDiffAnalyzer]::Analyze($baseline, $current, $config)

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Split-Path -Parent (Resolve-Path -LiteralPath $CurrentPath).Path
}
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$jsonPath = Join-Path $OutputDirectory 'semantic-drawing-diff.json'
$markdownPath = Join-Path $OutputDirectory 'semantic-drawing-diff.md'
[IO.File]::WriteAllText(
    $jsonPath,
    (($diff.ToMap() | ConvertTo-Json -Depth 16) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText(
    $markdownPath,
    ($diff.ToMarkdown() + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false))

Write-Host ("SEMANTIC DIFF status={0} identity={1} matched={2} changed={3} added={4} removed={5} ambiguous={6}" -f
    $diff.Status,
    $diff.Identity.Status,
    $diff.MatchedElementCount,
    $diff.ChangedElementCount,
    $diff.AddedCandidateCount,
    $diff.RemovedCandidateCount,
    $diff.AmbiguousMatches.Count)
Write-Host "JSON: $jsonPath"
Write-Host "Markdown: $markdownPath"
