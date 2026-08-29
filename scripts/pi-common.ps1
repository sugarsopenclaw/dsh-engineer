Set-StrictMode -Version Latest

function Get-PiBaseline {
    $baselinePath = Join-Path $PSScriptRoot "pi-baseline.psd1"
    if (-not (Test-Path -LiteralPath $baselinePath)) {
        throw "Pi baseline file not found: $baselinePath"
    }
    return Import-PowerShellDataFile -LiteralPath $baselinePath
}

function Get-RequiredCommand {
    param([Parameter(Mandatory = $true)][string]$Name)

    $commands = @(Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)
    if ($commands.Count -eq 0) {
        throw "$Name was not found on PATH."
    }
    return $commands[0].Source
}

function Assert-PiNodeVersion {
    param([Parameter(Mandatory = $true)][string]$MinimumVersion)

    $nodePath = Get-RequiredCommand -Name "node"
    $rawVersion = (& $nodePath --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $rawVersion -notmatch '^v(?<version>\d+\.\d+\.\d+)') {
        throw "Unable to determine Node.js version from: $rawVersion"
    }

    $current = [version]$Matches.version
    $minimum = [version]$MinimumVersion
    if ($current -lt $minimum) {
        throw "Pi requires Node.js >= $minimum; found $current."
    }
    return $nodePath
}

function Import-RepositoryEnvironment {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return 0
    }

    $loaded = 0
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*(?:export\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)$') {
            $name = $Matches.name
            $value = $Matches.value.Trim()
            if ($value.Length -ge 2) {
                $first = $value[0]
                $last = $value[$value.Length - 1]
                if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
            $loaded += 1
        }
    }
    return $loaded
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}
