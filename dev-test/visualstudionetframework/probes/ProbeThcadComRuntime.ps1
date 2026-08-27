param()

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
    exit $LASTEXITCODE
}

function Read-ComValue {
    param([scriptblock]$Action)

    try {
        return [ordered]@{
            success = $true
            value = & $Action
            error = $null
        }
    }
    catch {
        return [ordered]@{
            success = $false
            value = $null
            error = $_.Exception.Message
        }
    }
}

$result = [ordered]@{
    captured_at = [DateTime]::UtcNow.ToString("o")
    prog_id = "BricscadApp.AcadApplication"
    attached = $false
    application = $null
    active_document = $null
    system_variables = [ordered]@{}
    thcad_toolkit = @()
    error = $null
}

$app = $null
$document = $null
try {
    $app = [Runtime.InteropServices.Marshal]::GetActiveObject(
        "BricscadApp.AcadApplication")
    $result.attached = $true
    $result.application = [ordered]@{
        name = [string]$app.Name
        version = [string]$app.Version
        full_name = [string]$app.FullName
        path = [string]$app.Path
        visible = [bool]$app.Visible
        caption = [string]$app.Caption
    }

    $document = $app.ActiveDocument
    if ($null -ne $document) {
        $result.active_document = [ordered]@{
            name = [string]$document.Name
            full_name = [string]$document.FullName
            read_only = [bool]$document.ReadOnly
            saved = [bool]$document.Saved
            model_space_count = [int]$document.ModelSpace.Count
            paper_space_count = [int]$document.PaperSpace.Count
            layer_count = [int]$document.Layers.Count
            block_count = [int]$document.Blocks.Count
            selection_set_count = [int]$document.SelectionSets.Count
            pickfirst_count = [int]$document.PickfirstSelectionSet.Count
        }

        foreach ($name in @(
            "CMDNAMES",
            "DWGNAME",
            "DWGPREFIX",
            "LISPENABLED",
            "SECURELOAD",
            "TRUSTEDPATHS",
            "ACADLSPASDOC")) {
            $value = Read-ComValue { $document.GetVariable($name) }
            $result.system_variables[$name] = $value
        }
    }

    foreach ($progId in @(
        "THCadToolKit.Application",
        "THCadToolKit.THDatabase",
        "THCadToolKit.THDbPaperRecorder",
        "THCadToolKit.Application.V24",
        "THCadToolKit.THDatabase.V24",
        "THCadToolKit.THDbPaperRecorder.V24")) {
        $toolkitObject = $null
        try {
            $toolkitObject = $app.GetInterfaceObject($progId)
            $properties = [ordered]@{}
            if ($progId -like "THCadToolKit.Application*") {
                $properties.Caption = Read-ComValue { [string]$toolkitObject.Caption }
                $properties.CmdLine = Read-ComValue { [string]$toolkitObject.CmdLine }
            }
            elseif ($progId -like "THCadToolKit.THDatabase*") {
                $properties.FileName = Read-ComValue { [string]$toolkitObject.FileName }
                $properties.AcadDatabasePtr = Read-ComValue { $toolkitObject.AcadDatabasePtr }
            }
            elseif ($progId -like "THCadToolKit.THDbPaperRecorder*") {
                $properties.Count = Read-ComValue { [int]$toolkitObject.Count }
                $properties.TitleName = Read-ComValue { [string]$toolkitObject.TitleName }
                $properties.MxbName = Read-ComValue { [string]$toolkitObject.MxbName }
            }

            $result.thcad_toolkit += [ordered]@{
                prog_id = $progId
                created = $true
                properties = $properties
                error = $null
            }
        }
        catch {
            $result.thcad_toolkit += [ordered]@{
                prog_id = $progId
                created = $false
                properties = $null
                error = $_.Exception.Message
            }
        }
        finally {
            if ($null -ne $toolkitObject -and
                [Runtime.InteropServices.Marshal]::IsComObject($toolkitObject)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject(
                    $toolkitObject)
            }
        }
    }
}
catch {
    $result.error = $_.Exception.Message
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

$result | ConvertTo-Json -Depth 12 -Compress
