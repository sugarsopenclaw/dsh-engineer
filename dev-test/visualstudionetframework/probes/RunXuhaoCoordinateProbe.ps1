param(
    [Parameter(Mandatory = $true)]
    [string]$DllPath,

    [string]$Handle = "6A3C",

    [string]$CommandName = "SHBPROBEXUHAO2"
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -DllPath $DllPath -Handle $Handle -CommandName $CommandName
    exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $DllPath)) {
    throw "Probe DLL not found: $DllPath"
}

$app = [Runtime.InteropServices.Marshal]::GetActiveObject("BricscadApp.AcadApplication")
$doc = $app.ActiveDocument
if ($null -eq $doc) {
    throw "THCAD has no active document."
}

$dllForCad = ([IO.Path]::GetFullPath($DllPath)).Replace("\", "/")
$escapedHandle = $Handle.Replace('"', '')
$commands = "(command `"_NETLOAD`" `"$dllForCad`")`n" +
    "(progn (setq shb_ss (ssadd)) " +
    "(if (setq shb_e (handent `"$escapedHandle`")) (ssadd shb_e shb_ss)) " +
    "(sssetfirst nil shb_ss) (princ))`n" +
    "$CommandName`n"

$doc.SendCommand($commands)
Write-Host ("Queued {0} for {1} in {2}." -f $CommandName, $Handle, $doc.Name)

[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
