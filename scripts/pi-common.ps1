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

function Test-PiLegacyWslBashPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $normalized = $Path.Replace("/", "\").ToLowerInvariant()
    return $normalized -match '^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$'
}

function Get-PiBashShellCandidates {
    $candidates = New-Object System.Collections.Generic.List[string]

    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA "Programs"))) {
        if (-not [string]::IsNullOrWhiteSpace($root)) {
            $candidates.Add((Join-Path $root "Git\bin\bash.exe"))
            $candidates.Add((Join-Path $root "Git\usr\bin\bash.exe"))
        }
    }

    $gitCommands = @(Get-Command git -CommandType Application -ErrorAction SilentlyContinue)
    foreach ($gitCommand in $gitCommands) {
        $gitDirectory = Split-Path -Parent $gitCommand.Source
        $gitParent = Split-Path -Parent $gitDirectory
        $candidates.Add((Join-Path $gitParent "bin\bash.exe"))
        $candidates.Add((Join-Path $gitParent "usr\bin\bash.exe"))
        $candidates.Add((Join-Path $gitDirectory "bash.exe"))
    }

    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $candidates.Add((Join-Path $env:USERPROFILE "scoop\apps\git\current\bin\bash.exe"))
        $candidates.Add((Join-Path $env:USERPROFILE "scoop\apps\git\current\usr\bin\bash.exe"))
    }

    $whereHits = @()
    try {
        $whereHits = @(& where.exe bash.exe 2>$null)
        if ($LASTEXITCODE -ne 0) {
            $whereHits = @()
        }
    } catch {
        $whereHits = @()
    }
    foreach ($hit in $whereHits) {
        if (-not [string]::IsNullOrWhiteSpace($hit)) {
            $candidates.Add($hit.Trim())
        }
    }

    return $candidates
}

function Resolve-PiBashShell {
    if ($env:OS -ne "Windows_NT") {
        return $null
    }

    $seen = @{}
    foreach ($candidate in Get-PiBashShellCandidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            continue
        }

        $resolved = [System.IO.Path]::GetFullPath($candidate)
        $key = $resolved.ToLowerInvariant()
        if ($seen.ContainsKey($key)) {
            continue
        }
        $seen[$key] = $true

        if (Test-PiLegacyWslBashPath $resolved) {
            continue
        }

        return $resolved
    }

    return $null
}

function Set-PiProcessBashPath {
    param([Parameter(Mandatory = $true)][string]$BashPath)

    $bashDirectory = Split-Path -Parent $BashPath
    $pathEntries = @($env:PATH -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $alreadyPresent = $pathEntries | Where-Object { $_.TrimEnd("\") -ieq $bashDirectory.TrimEnd("\") }
    if (-not $alreadyPresent) {
        $env:PATH = "$bashDirectory;$env:PATH"
    }
}

function Merge-PiRuntimeShellPath {
    param(
        [Parameter(Mandatory = $true)][string]$AgentDirectory,
        [Parameter(Mandatory = $true)][string]$BashPath
    )

    if (-not (Test-Path -LiteralPath $AgentDirectory)) {
        New-Item -ItemType Directory -Path $AgentDirectory -Force | Out-Null
    }

    $settingsPath = Join-Path $AgentDirectory "settings.json"
    $settings = [ordered]@{}
    if (Test-Path -LiteralPath $settingsPath) {
        $raw = Get-Content -Raw -LiteralPath $settingsPath
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            $parsed = $raw | ConvertFrom-Json
            foreach ($property in $parsed.PSObject.Properties) {
                $settings[$property.Name] = $property.Value
            }
        }
    }

    $current = [string]$settings["shellPath"]
    if ($current -and (Test-Path -LiteralPath $current) -and -not (Test-PiLegacyWslBashPath $current)) {
        return $current
    }

    $settings["shellPath"] = $BashPath
    Set-Content -LiteralPath $settingsPath -Value ($settings | ConvertTo-Json -Depth 20) -Encoding utf8
    return $BashPath
}
