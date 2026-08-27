param()

$ErrorActionPreference = "Stop"

if ([Environment]::Is64BitProcess) {
    $windowsPowerShell32 = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell32 -NoProfile -Sta -ExecutionPolicy Bypass -File $PSCommandPath
    exit $LASTEXITCODE
}

$result = [ordered]@{
    captured_at = [DateTime]::UtcNow.ToString("o")
    process_bitness = "32-bit"
    components = @()
    error = $null
}

foreach ($progId in @(
    "THCADComReport.ReportConfig",
    "THCADReport.ReportConfig",
    "THCADPickUp.PickUpConfig",
    "THCADPickUpEngine.IPickUpEngine",
    "THCADsCardEngine.ICardEngine",
    "THCADsCardInfoX.CardInfo")) {
    $instance = $null
    try {
        $instance = New-Object -ComObject $progId
        $result.components += [ordered]@{
            prog_id = $progId
            created = $true
            is_com_object = [Runtime.InteropServices.Marshal]::IsComObject($instance)
            runtime_type = $instance.GetType().FullName
            error = $null
        }
    }
    catch {
        $result.components += [ordered]@{
            prog_id = $progId
            created = $false
            is_com_object = $false
            runtime_type = $null
            error = $_.Exception.Message
        }
    }
    finally {
        if ($null -ne $instance -and
            [Runtime.InteropServices.Marshal]::IsComObject($instance)) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($instance)
        }
    }
}

$result | ConvertTo-Json -Depth 8 -Compress
