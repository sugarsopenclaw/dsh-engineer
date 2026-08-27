param(
    [string]$OutputPath = "D:\dev\dsh-engineer\dev-test\visualstudionetframework\probes\.tmp-lisp-runtime.txt",
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -OutputPath $OutputPath -TimeoutSeconds $TimeoutSeconds
    exit $LASTEXITCODE
}

function Wait-ThcadIdle {
    param($Document, [datetime]$Deadline)

    Start-Sleep -Milliseconds 250
    while ((Get-Date) -lt $Deadline) {
        try {
            if ([string]$Document.GetVariable("CMDNAMES") -eq "") {
                return
            }
        }
        catch {
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Timed out waiting for THCAD to become idle."
}

$resolvedParent = [IO.Path]::GetFullPath((Split-Path -Parent $OutputPath))
New-Item -ItemType Directory -Force -Path $resolvedParent | Out-Null
if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
}

$app = $null
$document = $null
try {
    $app = [Runtime.InteropServices.Marshal]::GetActiveObject(
        "BricscadApp.AcadApplication")
    $document = $app.ActiveDocument
    if ($null -eq $document) {
        throw "THCAD has no active document."
    }
    Wait-ThcadIdle -Document $document -Deadline (Get-Date).AddSeconds($TimeoutSeconds)

    $lispPath = ([IO.Path]::GetFullPath($OutputPath)).Replace("\", "/").Replace('"', '\"')
    $expression = @"
(progn
  (vl-load-com)
  (setq shb_f (open "$lispPath" "w"))
  (write-line "[ATOMS]" shb_f)
  (foreach shb_x (atoms-family 1) (write-line shb_x shb_f))
  (write-line "[ARX]" shb_f)
  (foreach shb_x (arx) (write-line shb_x shb_f))
  (write-line "[VLX]" shb_f)
  (if (member "VL-LIST-LOADED-VLX" (atoms-family 1))
    (foreach shb_x (vl-list-loaded-vlx) (write-line shb_x shb_f)))
  (write-line "[VARS]" shb_f)
  (foreach shb_x '("LISPENABLED" "ACADLSPASDOC" "SECURELOAD" "TRUSTEDPATHS")
    (progn
      (setq shb_v (vl-catch-all-apply 'getvar (list shb_x)))
      (if (vl-catch-all-error-p shb_v)
        (write-line (strcat shb_x "=<ERROR>") shb_f)
        (write-line (strcat shb_x "=" (vl-princ-to-string shb_v)) shb_f))))
  (write-line "[DONE]" shb_f)
  (close shb_f)
  (setq shb_f nil shb_x nil shb_v nil)
  (princ))
"@
    $document.SendCommand($expression + "`n")
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    Wait-ThcadIdle -Document $document -Deadline $deadline

    $completed = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $OutputPath) {
            $tail = Get-Content -LiteralPath $OutputPath -Tail 1 -ErrorAction SilentlyContinue
            if ($tail -eq "[DONE]") {
                $completed = $true
                break
            }
        }
        Start-Sleep -Milliseconds 100
    }
    if (-not $completed) {
        throw "Timed out waiting for LISP runtime inventory: $OutputPath"
    }

    $sections = [ordered]@{
        ATOMS = @()
        ARX = @()
        VLX = @()
        VARS = @()
    }
    $current = ""
    foreach ($line in Get-Content -LiteralPath $OutputPath) {
        if ($line -match '^\[([A-Z]+)\]$') {
            $current = $Matches[1]
            continue
        }
        if ($sections.Contains($current)) {
            $sections[$current] += [string]$line
        }
    }

    [ordered]@{
        captured_at = [DateTime]::UtcNow.ToString("o")
        host = [string]$app.Name
        version = [string]$app.Version
        drawing = [string]$document.Name
        atoms = $sections.ATOMS
        arx = $sections.ARX
        vlx = $sections.VLX
        variables = $sections.VARS
        raw_output = [IO.Path]::GetFullPath($OutputPath)
    } | ConvertTo-Json -Depth 8 -Compress
}
finally {
    if ($null -ne $document -and
        [Runtime.InteropServices.Marshal]::IsComObject($document)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
    }
    if ($null -ne $app -and
        [Runtime.InteropServices.Marshal]::IsComObject($app)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
    }
}
