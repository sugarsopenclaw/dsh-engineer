param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [string]$Target,

    [int]$SaveAsType = 61
)

$ErrorActionPreference = "Stop"

function Invoke-ComRetry {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Operation,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )
    $lastError = $null
    for ($attempt = 1; $attempt -le 80; $attempt++) {
        try {
            return & $Operation
        }
        catch [System.Runtime.InteropServices.COMException] {
            $lastError = $_
            Start-Sleep -Milliseconds 250
        }
    }
    throw "AutoCAD COM remained busy during $Label after 20 seconds: $lastError"
}

$sourcePath = [System.IO.Path]::GetFullPath($Source)
$targetPath = [System.IO.Path]::GetFullPath($Target)
if (-not [System.IO.File]::Exists($sourcePath)) {
    throw "DWG source does not exist: $sourcePath"
}
if ([System.IO.File]::Exists($targetPath)) {
    throw "Refusing to overwrite DXF target: $targetPath"
}
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($targetPath)) | Out-Null

$application = Invoke-ComRetry {
    [Runtime.InteropServices.Marshal]::GetActiveObject("AutoCAD.Application")
} "GetActiveObject"
$autocadVersion = Invoke-ComRetry { [string]$application.Version } "Version"
$document = $null
$openedHere = $false
try {
    $documents = Invoke-ComRetry { $application.Documents } "Documents"
    foreach ($candidate in @($documents)) {
        if ([string]::Equals(
                [string]$candidate.FullName,
                $sourcePath,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            throw "Refusing to SaveAs a drawing already open in AutoCAD: $sourcePath"
        }
    }
    $document = Invoke-ComRetry {
        $application.Documents.Open($sourcePath, $true)
    } "Documents.Open"
    $openedHere = $true
    Invoke-ComRetry { $document.SaveAs($targetPath, $SaveAsType) } "Document.SaveAs"
    if (-not [System.IO.File]::Exists($targetPath)) {
        throw "AutoCAD SaveAs did not produce: $targetPath"
    }
    [PSCustomObject]@{
        source = $sourcePath
        target = $targetPath
        autocad_version = $autocadVersion
        save_as_type = $SaveAsType
        source_sha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
        output_sha256 = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    } | ConvertTo-Json -Compress
}
finally {
    if ($openedHere -and $null -ne $document) {
        Invoke-ComRetry { $document.Close($false) } "Document.Close"
    }
}
