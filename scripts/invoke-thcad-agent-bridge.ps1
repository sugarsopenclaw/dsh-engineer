param(
    [Parameter(Mandatory = $true)]
    [string]$BridgeRoot,
    [Parameter(Mandatory = $true)]
    [string]$BridgeDll,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9-]{1,80}$')]
    [string]$RequestId,
    [ValidateRange(1, 1800)]
    [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -BridgeRoot $BridgeRoot -BridgeDll $BridgeDll -RequestId $RequestId `
        -TimeoutSeconds $TimeoutSeconds
    exit $LASTEXITCODE
}

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

if (-not ('Shenbian.NativeWindowProcess' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;

namespace Shenbian {
    public static class NativeWindowProcess {
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    }
}
'@
}

$resolvedRoot = [IO.Path]::GetFullPath($BridgeRoot)
$resolvedDll = [IO.Path]::GetFullPath($BridgeDll)
$requestPath = Join-Path $resolvedRoot "pending\$RequestId.json"
$responsePath = Join-Path $resolvedRoot "responses\$RequestId.json"

if (-not (Test-Path -LiteralPath $resolvedDll)) {
    throw "BRIDGE_NOT_BUILT: $resolvedDll"
}
if (-not (Test-Path -LiteralPath $requestPath)) {
    throw "REQUEST_MISSING: $requestPath"
}

[IO.Directory]::CreateDirectory($resolvedRoot) | Out-Null
[IO.File]::WriteAllText(
    (Join-Path (Split-Path -Parent $resolvedDll) 'bridge-root.txt'),
    $resolvedRoot + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))

$app = $null
$document = $null
$state = $null
try {
    try {
        $app = [Runtime.InteropServices.Marshal]::GetActiveObject('BricscadApp.AcadApplication')
    } catch {
        throw 'THCAD_NOT_RUNNING: no active BricscadApp.AcadApplication instance'
    }

    [uint32]$hostProcessId = 0
    [void][Shenbian.NativeWindowProcess]::GetWindowThreadProcessId(
        [IntPtr][int64]$app.HWND,
        [ref]$hostProcessId)
    $hostProcess = Get-Process -Id $hostProcessId -ErrorAction Stop
    if ($hostProcess.ProcessName -ine 'thcad') {
        throw "WRONG_CAD_HOST: expected thcad.exe, got $($hostProcess.ProcessName)"
    }
    $document = $app.ActiveDocument
    if ($null -eq $document) {
        throw 'NO_ACTIVE_DOCUMENT: THCAD has no active document'
    }

    $quiescentDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $state = $app.GetAcadState()
        if ([bool]$state.IsQuiescent) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $quiescentDeadline)
    if (-not [bool]$state.IsQuiescent) {
        throw 'THCAD_BUSY: command line did not become quiescent within 5 seconds'
    }

    $cadPath = $resolvedDll.Replace('\', '/')
    if ($cadPath.Contains('"')) {
        throw 'INVALID_BRIDGE_PATH: quote characters are not supported'
    }
    $document.SendCommand("(command `"_NETLOAD`" `"$cadPath`")`nSHBTHCADAGENT`n")

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $responsePath)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "RESPONSE_TIMEOUT: no response for $RequestId within $TimeoutSeconds seconds"
        }
        Start-Sleep -Milliseconds 100
    }

    [Console]::Out.Write([IO.File]::ReadAllText($responsePath, [Text.Encoding]::UTF8))
} finally {
    foreach ($comObject in @($state, $document, $app)) {
        if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) } catch { }
        }
    }
}
