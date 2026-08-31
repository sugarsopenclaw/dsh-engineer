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
$request = Get-Content -LiteralPath $requestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$applicationOperations = @(
    'open_document',
    'activate_document',
    'close_document',
    'save_document_as',
    'save_document'
)
$commandName = if ($applicationOperations -contains [string]$request.operation) {
    'SHBTHCADAGENTV4APP'
} else {
    'SHBTHCADAGENTV4'
}

[IO.Directory]::CreateDirectory($resolvedRoot) | Out-Null
[IO.File]::WriteAllText(
    (Join-Path (Split-Path -Parent $resolvedDll) 'bridge-root.txt'),
    $resolvedRoot + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))

function Wait-ThcadQuiescent {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Application,
        [Parameter(Mandatory = $true)]
        [int]$Seconds,
        [Parameter(Mandatory = $true)]
        [string]$FailureCode
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $currentState = $null
        try {
            $currentState = $Application.GetAcadState()
            if ([bool]$currentState.IsQuiescent) { return }
        } finally {
            if ($null -ne $currentState -and [Runtime.InteropServices.Marshal]::IsComObject($currentState)) {
                try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($currentState) } catch { }
            }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "${FailureCode}: command line did not become quiescent within $Seconds seconds"
}

$app = $null
$document = $null
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

    Wait-ThcadQuiescent -Application $app -Seconds 5 -FailureCode 'THCAD_BUSY'

    $cadPath = $resolvedDll.Replace('\', '/')
    if ($cadPath.Contains('"')) {
        throw 'INVALID_BRIDGE_PATH: quote characters are not supported'
    }
    # Load first, then inspect the marker written by the actually loaded assembly.
    # This keeps the current dirty V4 session compatible while making the next
    # normal THCAD process use request-scoped dispatch immediately.
    $document.SendCommand("(command `"_NETLOAD`" `"$cadPath`")`n")
    Wait-ThcadQuiescent -Application $app -Seconds 15 -FailureCode 'BRIDGE_LOAD_TIMEOUT'

    $dispatchMode = ''
    $loadedMarker = Join-Path $resolvedRoot 'state\bridge-loaded.json'
    if (Test-Path -LiteralPath $loadedMarker) {
        try {
            $loaded = Get-Content -LiteralPath $loadedMarker -Raw -Encoding UTF8 | ConvertFrom-Json
            $loadedAssembly = [IO.Path]::GetFullPath([string]$loaded.assembly)
            if ($loadedAssembly -eq $resolvedDll) {
                $dispatchMode = [string]$loaded.dispatch_mode
            }
        } catch {
            $dispatchMode = ''
        }
    }
    $commandText = "$commandName`n"
    if ($dispatchMode -eq 'request_id_prompt_v1') {
        $commandText += "$RequestId`n"
    }
    $document.SendCommand($commandText)

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $responsePath)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "RESPONSE_TIMEOUT: no response for $RequestId within $TimeoutSeconds seconds"
        }
        Start-Sleep -Milliseconds 100
    }

    # The response can contain a multi-megabyte side-database text inventory.
    # The TypeScript client reads the authoritative response file directly;
    # stdout stays bounded so process control cannot hit maxBuffer.
    [Console]::Out.WriteLine($responsePath)
} finally {
    foreach ($comObject in @($document, $app)) {
        if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) } catch { }
        }
    }
}
