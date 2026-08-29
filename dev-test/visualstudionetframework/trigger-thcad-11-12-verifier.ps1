param(
    [ValidateSet('One', 'Medium', 'Large1', 'Large2', 'All')]
    [string]$Scope = 'One',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Scope', $Scope)
    if ($SkipBuild) { $arguments += '-SkipBuild' }
    & $windowsPowerShell @arguments
    exit $LASTEXITCODE
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $root 'Thcad1112Verifier\Thcad1112Verifier.csproj'
$dll = Join-Path $root 'Thcad1112Verifier\bin\x64\Release\Shb.Thcad.Verifier1112.dll'
$msbuild = 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe'

if (-not $SkipBuild) {
    & $msbuild $project /t:Rebuild /p:Configuration=Release /p:Platform=x64 /nologo /v:minimal
    if ($LASTEXITCODE -ne 0) { throw "MSBuild failed: $LASTEXITCODE" }
}
if (-not (Test-Path $dll)) { throw "Verifier DLL not found: $dll" }

$app = [Runtime.InteropServices.Marshal]::GetActiveObject('BricscadApp.AcadApplication')
$document = $app.ActiveDocument
$command = if ($Scope -eq 'All') {
    'SHBVERIFY1112ALL'
} elseif ($Scope -eq 'Large1') {
    'SHBVERIFY1112LARGE1'
} elseif ($Scope -eq 'Large2') {
    'SHBVERIFY1112LARGE2'
} elseif ($Scope -eq 'Medium') {
    'SHBVERIFY1112MEDIUM'
} else {
    'SHBVERIFY1112ONE'
}
$cadPath = $dll.Replace('\', '/')
Write-Host ("Host: {0} | active doc: {1}" -f $app.Name, $document.Name)
$document.SendCommand("(command `"_NETLOAD`" `"$cadPath`")`n$command`n")
Write-Host "Queued $command; source DWGs are opened only as read-only side databases."
