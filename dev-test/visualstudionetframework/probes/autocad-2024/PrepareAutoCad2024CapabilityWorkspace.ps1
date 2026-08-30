param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDirectory = Split-Path -Parent $PSCommandPath
    $RepoRoot = (Resolve-Path (Join-Path $scriptDirectory "..\..\..\..")).Path
}
else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

$requiredPaths = @(
    (Join-Path $RepoRoot "AGENTS.md"),
    (Join-Path $RepoRoot "data\pipelines\cad_capabilities"),
    (Join-Path $RepoRoot "specs\007-autocad-2024-capability-catalog")
)
foreach ($path in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Resolved path is not the dsh-engineer repository root: $RepoRoot"
    }
}

$stagingRoot = Join-Path $RepoRoot "data\datasets\staging\cad-capabilities"
$inventoryIds = @(
    "autocad-2024.com",
    "autocad-2024.dotnet",
    "autocad-2024.lisp",
    "autocad-2024.command",
    "autocad-2024.native"
)

$created = New-Object 'System.Collections.Generic.List[string]'
foreach ($inventoryId in $inventoryIds) {
    if ($inventoryId -like "thcad-*") {
        throw "AutoCAD workspace preparation refused THCAD inventory: $inventoryId"
    }
    $target = Join-Path $stagingRoot $inventoryId
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $created.Add($target)
}

[ordered]@{
    observed_host_id = "autocad-2024"
    staging_root = $stagingRoot
    inventories = $inventoryIds
    directories = @($created)
} | ConvertTo-Json -Depth 4
