param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$ThcadDir = 'D:\THSOFT\THCAD V24_Mechanical2D\THCAD'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repositoryRoot 'local-dev\cad\hosts\thcad-dotnet-bridge\ThcadAgentBridge.csproj'
$bridgeRoot = Join-Path $repositoryRoot '.pi\runtime\thcad-bridge'
$deploymentRoot = Join-Path $bridgeRoot 'deployments'
if (-not (Test-Path -LiteralPath $project)) {
    throw "THCAD Agent Bridge project not found: $project"
}
if (-not (Test-Path -LiteralPath (Join-Path $ThcadDir 'TD_Mgd.dll'))) {
    throw "THCAD .NET assemblies not found under: $ThcadDir"
}

$deploymentId = '{0}-{1}' -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), $PID
$deploymentDirectory = Join-Path $deploymentRoot $deploymentId
[IO.Directory]::CreateDirectory($deploymentDirectory) | Out-Null
$outputPath = $deploymentDirectory + [IO.Path]::DirectorySeparatorChar

& dotnet msbuild $project /t:Build /p:Configuration=$Configuration /p:Platform=x64 "/p:ThcadDir=$ThcadDir" "/p:OutputPath=$outputPath" /v:minimal
if ($LASTEXITCODE -ne 0) {
    throw "THCAD Agent Bridge build failed with exit code $LASTEXITCODE"
}

$dll = Join-Path $deploymentDirectory 'Shb.Thcad.AgentBridge.dll'
if (-not (Test-Path -LiteralPath $dll)) {
    throw "Build completed without expected DLL: $dll"
}

$pointer = Join-Path $bridgeRoot 'current-dll.txt'
$temporaryPointer = "$pointer.tmp-$PID"
$relativeDll = "$deploymentId/Shb.Thcad.AgentBridge.dll"
[IO.File]::WriteAllText(
    $temporaryPointer,
    $relativeDll + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))
if (Test-Path -LiteralPath $pointer) {
    $backupPointer = "$pointer.bak-$PID"
    [IO.File]::Replace($temporaryPointer, $pointer, $backupPointer)
    Remove-Item -LiteralPath $backupPointer -Force
} else {
    [IO.File]::Move($temporaryPointer, $pointer)
}

Write-Host "THCAD Agent Bridge ready: $dll"
