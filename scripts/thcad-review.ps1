param(
    [ValidateSet('list', 'verify', 'export-candidates')]
    [string]$Action = 'list',
    [string]$Argument
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$tsx = Join-Path $repositoryRoot 'pi\node_modules\.bin\tsx.cmd'
$cli = Join-Path $repositoryRoot 'plugins\shenbian-pi\runtime\thcad\review-cli.ts'
if (-not (Test-Path -LiteralPath $tsx)) {
    throw 'Pi dependencies are missing. Run .\scripts\bootstrap-pi.ps1 first.'
}

$arguments = @($cli, $Action)
if (-not [string]::IsNullOrWhiteSpace($Argument)) {
    $arguments += $Argument
}
& $tsx @arguments
if ($LASTEXITCODE -ne 0) {
    throw "THCAD review command failed with exit code $LASTEXITCODE"
}
