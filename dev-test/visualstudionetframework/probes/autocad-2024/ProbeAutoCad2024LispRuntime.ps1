param(
    [string]$OutputPath = "",
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -OutputPath $OutputPath -TimeoutSeconds $TimeoutSeconds
    exit $LASTEXITCODE
}

. (Join-Path (Split-Path -Parent $PSCommandPath) "AutoCad2024Host.ps1")

function Wait-AutoCadIdle {
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
    throw "Timed out waiting for AutoCAD to become idle."
}

$hostInfo = Confirm-AutoCad2024Host
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Split-Path -Parent $PSCommandPath) ".tmp-lisp-runtime.txt"
}
$resolvedParent = [IO.Path]::GetFullPath((Split-Path -Parent $OutputPath))
New-Item -ItemType Directory -Force -Path $resolvedParent | Out-Null
if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
}

$app = [Runtime.InteropServices.Marshal]::GetActiveObject($hostInfo.com_rot.prog_id)
if ([string]$app.Name -notmatch "(?i)autocad" -or [string]$app.Name -match "(?i)thcad|bricscad") {
    throw "LISP probe attached to a non-AutoCAD host: $($app.Name)"
}
$document = $null
try {
    $document = $app.ActiveDocument
}
catch {
}
if ($null -eq $document) {
    $document = $app.Documents.Add()
}
if ($null -eq $document) {
    throw "AutoCAD has no active document after Documents.Add()."
}
Wait-AutoCadIdle -Document $document -Deadline (Get-Date).AddSeconds($TimeoutSeconds)

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
Wait-AutoCadIdle -Document $document -Deadline $deadline

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

$result = [ordered]@{
    captured_at = [DateTime]::UtcNow.ToString("o")
    host = [string]$app.Name
    version = [string]$app.Version
    drawing = [string]$document.Name
    atoms = $sections.ATOMS
    arx = $sections.ARX
    vlx = $sections.VLX
    variables = $sections.VARS
    raw_output = [IO.Path]::GetFileName($OutputPath)
}
$jsonPath = [IO.Path]::ChangeExtension($OutputPath, ".json")
$json = $result | ConvertTo-Json -Depth 8 -Compress
[IO.File]::WriteAllText($jsonPath, $json, [Text.UTF8Encoding]::new($false))
Write-Output $jsonPath
