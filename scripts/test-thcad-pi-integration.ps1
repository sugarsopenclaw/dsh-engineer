param(
    [switch]$LiveStatus,
    [switch]$LiveProject
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build-thcad-agent-bridge.ps1')
if ($LASTEXITCODE -ne 0) { throw "AgentBridge build failed: $LASTEXITCODE" }

& (Join-Path $PSScriptRoot 'verify-pi.ps1')
if ($LASTEXITCODE -ne 0) { throw "Pi verification failed: $LASTEXITCODE" }

$tsx = Join-Path $repositoryRoot 'pi\node_modules\.bin\tsx.cmd'
& $tsx --test `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\artifact-store.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\documents.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\review-store.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\text-index.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\bom-visual-subagent-runner.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\topology-semantics.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\vision-model-routing.test.ts') `
    (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\visual-subagent-runner.test.ts')
if ($LASTEXITCODE -ne 0) { throw "THCAD artifact tests failed: $LASTEXITCODE" }

& (Join-Path $repositoryRoot 'local-dev\cad\core\04-mechanical-bom-knowledge\test-mechanical-bom-knowledge.ps1')
if ($LASTEXITCODE -ne 0) { throw "Seven-drawing BOM regression failed: $LASTEXITCODE" }

if ($LiveStatus) {
    & $tsx (Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\doctor-cli.ts')
    if ($LASTEXITCODE -ne 0) { throw "Live THCAD status failed: $LASTEXITCODE" }
}

if ($LiveProject) {
    $documentsCli = Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\documents-cli.ts'
    $textIndexCli = Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\text-index-cli.ts'
    $status = (& $tsx $documentsCli status | Out-String) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $null -eq $status.active_document) {
        throw 'Live THCAD project test requires an active drawing.'
    }
    $originalPath = [string]$status.active_document.path
    $drawingRoot = Join-Path $repositoryRoot 'client-data\transformer-design-drawings'
    $sample = Get-ChildItem -LiteralPath $drawingRoot -Filter '*.dwg' -File |
        Where-Object { $_.Name -ine [string]$status.active_document.name } |
        Select-Object -First 1
    if ($null -eq $sample) { throw 'No secondary DWG is available for the live project test.' }

    $workspaceTarget = $null
    try {
        $opened = (& $tsx $documentsCli open $sample.FullName | Out-String) | ConvertFrom-Json
        if (-not $opened.forced_read_only -or -not $opened.document.read_only) {
            throw 'Client-data drawing was not forced read-only.'
        }
        & $tsx $documentsCli activate $originalPath | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not reactivate original drawing.' }
        & $tsx $documentsCli close $sample.FullName discard | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not close secondary read-only drawing.' }

        $copied = (& $tsx $documentsCli copy_to_workspace $sample.FullName | Out-String) | ConvertFrom-Json
        $workspaceTarget = [string]$copied.target_path
        if ($copied.copy_mode -ne 'saved_disk_state' -or -not $workspaceTarget) {
            throw 'Workspace disk-state copy failed.'
        }
        $workspaceOpened = (& $tsx $documentsCli open $workspaceTarget | Out-String) | ConvertFrom-Json
        if ($workspaceOpened.document.read_only) { throw 'Workspace copy unexpectedly opened read-only.' }
        & $tsx $documentsCli activate $originalPath | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restore original drawing after workspace open.' }
        & $tsx $documentsCli close $workspaceTarget discard | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not close workspace test drawing.' }

        $index = (& $tsx $textIndexCli build | Out-String) | ConvertFrom-Json
        if ($index.failed_count -ne 0 -or $index.drawing_count -lt 7) {
            throw 'Seven-drawing text index build failed.'
        }
        $search = (& $tsx $textIndexCli search '法兰' | Out-String) | ConvertFrom-Json
        $bomHits = @($search.drawings.matches | Where-Object { $_.source -eq 'bom_row' -and $null -ne $_.bom_item_number })
        if ($bomHits.Count -lt 1) { throw 'Flange search returned no structured BOM hit.' }
    }
    finally {
        try { & $tsx $documentsCli activate $originalPath | Out-Null } catch { }
        try {
            $cleanupStatus = (& $tsx $documentsCli status | Out-String) | ConvertFrom-Json
            $openNames = @($cleanupStatus.documents | ForEach-Object { [string]$_.name })
            if ($workspaceTarget -and $openNames -contains [IO.Path]::GetFileName($workspaceTarget)) {
                & $tsx $documentsCli close $workspaceTarget discard | Out-Null
            }
            if ($openNames -contains $sample.Name) {
                & $tsx $documentsCli close $sample.FullName discard | Out-Null
            }
            if ($workspaceTarget) {
                $workspaceFile = if ([IO.Path]::IsPathRooted($workspaceTarget)) {
                    $workspaceTarget
                } else {
                    Join-Path $repositoryRoot $workspaceTarget
                }
                if (Test-Path -LiteralPath $workspaceFile -PathType Leaf) {
                    Remove-Item -LiteralPath $workspaceFile -Force
                }
                & $tsx $textIndexCli build | Out-Null
            }
        } catch { }
    }
    Write-Host 'PASS: live THCAD open/activate/close/copy and seven-drawing text-index checks completed.'
}

Write-Host 'PASS: Pi THCAD mechanical subagent integration checks completed.'
