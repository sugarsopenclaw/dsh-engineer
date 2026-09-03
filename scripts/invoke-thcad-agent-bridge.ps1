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

function Test-ThcadQuiescent {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Application,
        [Parameter(Mandatory = $true)]
        [int]$Seconds
    )

    try {
        Wait-ThcadQuiescent -Application $Application -Seconds $Seconds -FailureCode 'THCAD_BUSY'
        return $true
    } catch {
        if ($_.Exception.Message -notlike 'THCAD_BUSY:*') {
            throw
        }
        return $false
    }
}

function Get-ThcadCommandNames {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Document
    )

    return @(
        ([string]$Document.GetVariable('CMDNAMES') -split "'") |
            ForEach-Object { $_.Trim().ToUpperInvariant() } |
            Where-Object { $_ }
    )
}

function Restore-StaleShenbianCommand {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Application,
        [Parameter(Mandatory = $true)]
        [object]$Document,
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    if (Test-ThcadQuiescent -Application $Application -Seconds 5) {
        return
    }

    $ownedCommands = @('SHBTHCADAGENTV4', 'SHBTHCADAGENTV4APP')
    $activeCommands = @(Get-ThcadCommandNames -Document $Document)
    $foreignCommands = @($activeCommands | Where-Object { $ownedCommands -notcontains $_ })
    $shenbianCommands = @($activeCommands | Where-Object { $ownedCommands -contains $_ })
    if ($shenbianCommands.Count -eq 0 -or $foreignCommands.Count -gt 0) {
        $displayNames = if ($activeCommands.Count -gt 0) { $activeCommands -join ',' } else { '<unknown>' }
        throw "THCAD_BUSY: active command is not an orphaned Shenbian bridge command ($displayNames)"
    }

    $runningDirectory = Join-Path $Root 'running'
    $runningRequests = @(
        Get-ChildItem -LiteralPath $runningDirectory -Filter '*.json' -File -ErrorAction SilentlyContinue
    )
    if ($runningRequests.Count -gt 0) {
        throw "THCAD_BRIDGE_ACTIVE: $($runningRequests.Count) bridge request(s) are still running"
    }

    # BricsCAD COM accepts character 27 as Escape. Only send it after proving
    # that every active command belongs to this bridge and no request is running.
    $Document.SendCommand([string][char]27)
    if (-not (Test-ThcadQuiescent -Application $Application -Seconds 2)) {
        $remainingCommands = @(Get-ThcadCommandNames -Document $Document)
        $remainingForeign = @($remainingCommands | Where-Object { $ownedCommands -notcontains $_ })
        if ($remainingForeign.Count -gt 0) {
            throw "THCAD_STALE_COMMAND_RECOVERY_FAILED: command ownership changed during recovery"
        }
        $Document.SendCommand([string][char]27)
        Wait-ThcadQuiescent `
            -Application $Application `
            -Seconds 3 `
            -FailureCode 'THCAD_STALE_COMMAND_RECOVERY_FAILED'
    }
}

function Test-SameBridgeBinary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Left,
        [Parameter(Mandatory = $true)]
        [string]$Right
    )

    if ([string]::Equals($Left, $Right, [StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    if (-not (Test-Path -LiteralPath $Left) -or -not (Test-Path -LiteralPath $Right)) {
        return $false
    }
    return (Get-FileHash -LiteralPath $Left -Algorithm SHA256).Hash -eq
        (Get-FileHash -LiteralPath $Right -Algorithm SHA256).Hash
}

$app = $null
$document = $null
$dispatchMutex = $null
$dispatchMutexAcquired = $false
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

    $dispatchMutex = [Threading.Mutex]::new(
        $false,
        "Local\Shenbian.Thcad.AgentBridge.$hostProcessId")
    try {
        $dispatchMutexAcquired = $dispatchMutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))
    } catch [Threading.AbandonedMutexException] {
        $dispatchMutexAcquired = $true
    }
    if (-not $dispatchMutexAcquired) {
        throw "THCAD_BRIDGE_ACTIVE: another bridge request did not finish within $TimeoutSeconds seconds"
    }

    Restore-StaleShenbianCommand -Application $app -Document $document -Root $resolvedRoot

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
            $loadedCommandsMatch =
                [string]$loaded.commands.modal -eq 'SHBTHCADAGENTV4' -and
                [string]$loaded.commands.application -eq 'SHBTHCADAGENTV4APP'
            $loadedInCurrentHost =
                [DateTimeOffset]::Parse([string]$loaded.loaded_at_utc).UtcDateTime -ge
                $hostProcess.StartTime.ToUniversalTime()
            if ($loadedCommandsMatch -and (
                $loadedInCurrentHost -or
                (Test-SameBridgeBinary -Left $loadedAssembly -Right $resolvedDll))) {
                $dispatchMode = [string]$loaded.dispatch_mode
            }
        } catch {
            $dispatchMode = ''
        }
    }
    if ($dispatchMode -ne 'request_id_prompt_v1') {
        throw 'BRIDGE_DISPATCH_UNAVAILABLE: loaded bridge did not publish the request-id dispatch contract'
    }
    $commandText = "$commandName`n$RequestId`n"
    $document.SendCommand($commandText)

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $responsePath)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "RESPONSE_TIMEOUT: no response for $RequestId within $TimeoutSeconds seconds"
        }
        Start-Sleep -Milliseconds 100
    }

    # The response is published just before the managed command returns. Keep
    # ownership until THCAD has actually left that command so the next request
    # cannot mistake this short tail for an orphan.
    Wait-ThcadQuiescent `
        -Application $app `
        -Seconds 15 `
        -FailureCode 'BRIDGE_COMMAND_COMPLETION_TIMEOUT'

    # The response can contain a multi-megabyte side-database text inventory.
    # The TypeScript client reads the authoritative response file directly;
    # stdout stays bounded so process control cannot hit maxBuffer.
    [Console]::Out.WriteLine($responsePath)
} finally {
    if ($dispatchMutexAcquired -and $null -ne $dispatchMutex) {
        try { $dispatchMutex.ReleaseMutex() } catch { }
    }
    if ($null -ne $dispatchMutex) {
        $dispatchMutex.Dispose()
    }
    foreach ($comObject in @($document, $app)) {
        if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) } catch { }
        }
    }
}
