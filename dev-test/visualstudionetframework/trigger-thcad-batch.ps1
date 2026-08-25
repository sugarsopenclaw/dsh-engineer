# Drive the already-running THCAD GUI instance via COM: NETLOAD the extractor, then SHBEXTRACTALL.
# The batch command reads DWGs as side databases, so nothing is opened in the editor.
param(
    [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dll = (Join-Path $root "ThcadExtractor\bin\x64\$Configuration\Shb.Thcad.Extractor.dll").Replace("\", "/")
if (-not (Test-Path $dll)) { throw "DLL not found: $dll" }

$app = [Runtime.InteropServices.Marshal]::GetActiveObject("BricscadApp.AcadApplication")
$doc = $app.ActiveDocument
Write-Host ("Host: {0} | active doc: {1}" -f $app.Name, $doc.Name)
$doc.SendCommand("(command `"_NETLOAD`" `"$dll`")`nSHBEXTRACTALL`n")
Write-Host "Queued: NETLOAD + SHBEXTRACTALL. Watch out-thcad\_batch-log.txt for progress."
