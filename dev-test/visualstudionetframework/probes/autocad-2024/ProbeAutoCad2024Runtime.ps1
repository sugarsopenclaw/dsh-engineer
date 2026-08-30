param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -OutputPath $OutputPath
    exit $LASTEXITCODE
}

. (Join-Path (Split-Path -Parent $PSCommandPath) "AutoCad2024Host.ps1")

$hostInfo = Confirm-AutoCad2024Host
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Split-Path -Parent $PSCommandPath) "autocad-2024-host.json"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
($hostInfo | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$hostInfo | ConvertTo-Json -Depth 8
