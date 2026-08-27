param(
    [string]$MechanicalRoot = "D:\THSOFT\THCAD V24_Mechanical2D",
    [string]$OutputPath = "D:\dev\dsh-engineer\docs\dev\2026-08-27-THCAD-V24-原生BRX-ARX与PE导出能力盘点.md",
    [string]$RawOutputPath = "D:\dev\dsh-engineer\dev-test\visualstudionetframework\probes\.tmp-native-exports.json"
)

$ErrorActionPreference = "Stop"

function MdCode {
    param([object]$Value)
    if ($null -eq $Value -or [string]$Value -eq "") { return "-" }
    return "``" + ([string]$Value).Replace('`', '``') + "``"
}

function RelativeToRoot {
    param([string]$Path)
    $root = [IO.Path]::GetFullPath($MechanicalRoot).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath($Path)
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        return $full.Substring($root.Length)
    }
    return $full
}

if (-not (Test-Path -LiteralPath $MechanicalRoot)) {
    throw "THCAD mechanical root not found: $MechanicalRoot"
}

$readerPath = Join-Path (Split-Path -Parent $PSCommandPath) "PeExportReader.cs"
if (-not ("Shb.Thcad.Probes.PeExportReader" -as [Type])) {
    Add-Type -Path $readerPath
}

$thcadDirectory = Join-Path $MechanicalRoot "THCAD"
$pluginFiles = @(Get-ChildItem -LiteralPath $MechanicalRoot -Recurse -File |
    Where-Object { $_.Extension -in ".arx", ".brx" })
$hostNames = @(
    "thcad.exe",
    "brx23.dll",
    "bricscadapi.dll",
    "commands.dll",
    "commandsregistry.dll",
    "lispex.dll",
    "axbricscadapp1.dll",
    "axbricscaddb1.dll",
    "axbricscadsm.dll")
$hostFiles = @($hostNames | ForEach-Object {
    Get-Item -LiteralPath (Join-Path $thcadDirectory $_) -ErrorAction Stop
})

$allFilesByPath = @{}
foreach ($file in @($pluginFiles) + @($hostFiles)) {
    $allFilesByPath[$file.FullName.ToLowerInvariant()] = $file
}

$moduleRows = @()
$rawRows = @()
foreach ($file in $allFilesByPath.Values | Sort-Object FullName) {
    $category = if ($file.Extension -eq ".arx") {
        "mechanical_arx"
    }
    elseif ($file.Extension -eq ".brx") {
        "brx_plugin"
    }
    else {
        "host_runtime"
    }
    try {
        $inventory = [Shb.Thcad.Probes.PeExportReader]::Read($file.FullName)
        $exports = @($inventory.Exports)
        $named = @($exports | Where-Object { $_.Name })
        $standard = @($named | Where-Object {
            $_.Name -match '^(Dll|acrx|odrx)'
        })
        $decorated = @($named | Where-Object { $_.Name.StartsWith("?") })
        $sample = @($named | Select-Object -First 16 | ForEach-Object { $_.Name })
        $moduleRows += [ordered]@{
            file = RelativeToRoot $file.FullName
            full_path = $file.FullName
            category = $category
            bytes = $file.Length
            version = $file.VersionInfo.FileVersion
            machine = "0x{0:X4}" -f $inventory.Machine
            pe32_plus = $inventory.IsPe32Plus
            export_count = $exports.Count
            named_export_count = $named.Count
            decorated_export_count = $decorated.Count
            standard_entry_count = $standard.Count
            sample = $sample
            error = $null
        }
        $rawRows += [ordered]@{
            file = RelativeToRoot $file.FullName
            full_path = $file.FullName
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            exporting_module_name = $inventory.ExportingModuleName
            machine = "0x{0:X4}" -f $inventory.Machine
            pe32_plus = $inventory.IsPe32Plus
            exports = @($exports | ForEach-Object {
                [ordered]@{
                    name = $_.Name
                    ordinal = $_.Ordinal
                    rva = "0x{0:X8}" -f $_.RelativeVirtualAddress
                    forwarder = $_.Forwarder
                }
            })
        }
    }
    catch {
        $moduleRows += [ordered]@{
            file = RelativeToRoot $file.FullName
            full_path = $file.FullName
            category = $category
            bytes = $file.Length
            version = $file.VersionInfo.FileVersion
            machine = ""
            pe32_plus = $null
            export_count = 0
            named_export_count = 0
            decorated_export_count = 0
            standard_entry_count = 0
            sample = @()
            error = $_.Exception.Message
        }
    }
}

$sdkHeaders = @(Get-ChildItem -LiteralPath $MechanicalRoot -Recurse -File |
    Where-Object { $_.Extension -in ".h", ".hpp", ".idl" })
$libRows = @()
foreach ($file in Get-ChildItem -LiteralPath $MechanicalRoot -Recurse -File -Filter *.lib) {
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $length = [Math]::Min(8, $bytes.Length)
    $header = [Text.Encoding]::ASCII.GetString($bytes, 0, $length)
    $libRows += [ordered]@{
        file = RelativeToRoot $file.FullName
        bytes = $file.Length
        coff_archive = $header -eq "!<arch>``n"
    }
}

$rawDirectory = Split-Path -Parent $RawOutputPath
New-Item -ItemType Directory -Force -Path $rawDirectory | Out-Null
[IO.File]::WriteAllText(
    $RawOutputPath,
    ($rawRows | ConvertTo-Json -Depth 8),
    [Text.UTF8Encoding]::new($false))

$pluginRows = @($moduleRows | Where-Object { $_.category -ne "host_runtime" })
$hostRows = @($moduleRows | Where-Object { $_.category -eq "host_runtime" })
$totalPluginExports = 0
$totalHostExports = 0
foreach ($row in $pluginRows) { $totalPluginExports += [int]$row.export_count }
foreach ($row in $hostRows) { $totalHostExports += [int]$row.export_count }

$text = [Text.StringBuilder]::new()
[void]$text.AppendLine("# THCAD V24 原生 BRX/ARX 与 PE 导出能力盘点")
[void]$text.AppendLine()
[void]$text.AppendLine("> 生成日期：$(Get-Date -Format yyyy-MM-dd)  ")
[void]$text.AppendLine("> 实测安装：``$MechanicalRoot``  ")
[void]$text.AppendLine("> 生成器：``dev-test/visualstudionetframework/probes/ExportThcadNativeApiInventory.ps1``")
[void]$text.AppendLine()
[void]$text.AppendLine("## 0. 结论和口径")
[void]$text.AppendLine()
[void]$text.AppendLine("原生能力面确实存在，但必须把三件事分开：")
[void]$text.AppendLine()
[void]$text.AppendLine("1. **公开 BRX/ARX SDK API**：需要官方头文件、导入库、ABI/版本和文档；")
[void]$text.AppendLine("2. **PE 导出符号**：二进制确实导出了某个名字，但没有参数、对象布局、所有权和线程约定时，不等于可安全调用的公开 API；")
[void]$text.AppendLine("3. **ARX/BRX 插件命令与业务行为**：很多命令在模块加载时动态注册，命令名通常不是 PE 导出。")
[void]$text.AppendLine()
[void]$text.AppendLine("本机扫描 **$($pluginRows.Count) 个 ARX/BRX 插件模块**，共见 **$totalPluginExports 个 PE 导出**；另扫描 **$($hostRows.Count) 个关键宿主二进制**，共见 **$totalHostExports 个 PE 导出**。完整逐符号原始结果写在 $(MdCode ([IO.Path]::GetFullPath($RawOutputPath)))。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 1. 公开 SDK 是否随安装存在")
[void]$text.AppendLine()
[void]$text.AppendLine("- ``.h/.hpp/.idl``：$($sdkHeaders.Count) 个；")
[void]$text.AppendLine("- ``.lib``：$($libRows.Count) 个，但其中 COFF 导入库为 $(@($libRows | Where-Object { $_.coff_archive }).Count) 个。当前 8 个 ``.LIB`` 都是 PCCAD 符号/公差资源库，不是 C++ 链接导入库；")
[void]$text.AppendLine("- 结论：当前产品安装目录没有一套可直接编译插件的公开 BRX/ARX SDK。若以后要写原生插件，应另取与 THCAD/BricsCAD 版本严格匹配的 SDK，而不是从 DLL 导出名猜函数签名。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 2. 关键发现")
[void]$text.AppendLine()
[void]$text.AppendLine("- ``brx23.dll`` 是最大的宿主原生 ABI 面，导出数量见下表；大量 MSVC C++ 修饰名能证明类/函数实现存在，但不能单靠名字安全调用；")
[void]$text.AppendLine("- 机械 ``.arx`` 多数至少导出 ``acrxEntryPoint`` / ``acrxGetApiVersion``，这是插件装载协议，不是其业务命令清单；")
[void]$text.AppendLine("- ``THCadToolKit.arx`` 的 PE 层只有少量标准加载/COM 导出，但它嵌入的 COM 类型库却公开了明细表、序号、图幅和标题栏业务接口；这是不同能力面不能互相代替的直接例子；")
[void]$text.AppendLine("- 模块文件名显示还存在批量改标题、查找替换、批量打印、标准检查、图幅、明细数据、重量统计、孔/圆弧/倒角等业务模块。这里只把文件名当线索，不能据此臆造函数签名或命令协议。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 3. 关键宿主二进制")
[void]$text.AppendLine()
[void]$text.AppendLine("| 文件 | 版本 | PE | 导出 | C++ 修饰名 | 标准入口 | 示例 |")
[void]$text.AppendLine("| --- | --- | --- | ---: | ---: | ---: | --- |")
foreach ($row in $hostRows | Sort-Object { $_["file"] }) {
    [void]$text.AppendLine("| $(MdCode $row.file) | $(MdCode $row.version) | $(MdCode $row.machine) | $($row.export_count) | $($row.decorated_export_count) | $($row.standard_entry_count) | $(MdCode ($row.sample -join ', ')) |")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 4. ARX/BRX 插件模块")
[void]$text.AppendLine()
[void]$text.AppendLine("| 文件 | 字节 | 版本 | 导出 | C++ 修饰名 | 标准入口 | 示例 |")
[void]$text.AppendLine("| --- | ---: | --- | ---: | ---: | ---: | --- |")
foreach ($row in $pluginRows | Sort-Object { $_["file"] }) {
    [void]$text.AppendLine("| $(MdCode $row.file) | $($row.bytes) | $(MdCode $row.version) | $($row.export_count) | $($row.decorated_export_count) | $($row.standard_entry_count) | $(MdCode ($row.sample -join ', ')) |")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 5. 为什么不把 2 万个 brx23 导出直接写成能力目录")
[void]$text.AppendLine()
[void]$text.AppendLine("成员名不是完整 ABI 合同。C++ 修饰名最多带出部分类型线索，仍缺头文件中的类布局、模板、枚举值、宏、内联实现、内存释放方、异常/RTTI、编译器和运行时版本。把这些名字逐条包装成可调用方法会制造比盲区更危险的假能力。")
[void]$text.AppendLine()
[void]$text.AppendLine("所以本篇在 Markdown 中保留每个模块的完整计数和样例，逐符号明细由同一生成器输出 JSON。将来取得匹配 SDK 后，再单独生成真正的「公开原生 SDK 成员盘点」；两者不能混叫。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 6. 私有实现边界")
[void]$text.AppendLine()
[void]$text.AppendLine("未导出的 C++ 函数、类内部实现、动态生成命令、私有协议和对象内存布局不能通过 PE 导出表完整枚举。可以继续用字符串、反汇编、调试器、运行时探针观察线索，但这些结果应标成「私有实现研究」，逐功能验证，不能自动升级为稳定 API。")

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
[IO.File]::WriteAllText($OutputPath, $text.ToString(), [Text.UTF8Encoding]::new($false))
Write-Host "Wrote $OutputPath"
Write-Host "Wrote $RawOutputPath"
