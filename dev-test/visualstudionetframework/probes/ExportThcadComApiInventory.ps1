param(
    [string]$ThcadDirectory = "D:\THSOFT\THCAD V24_Mechanical2D\THCAD",
    [string]$MechanicalRoot = "D:\THSOFT\THCAD V24_Mechanical2D",
    [string]$ThsoftSharedDirectory = "C:\Program Files (x86)\Common Files\THSOFT Shared",
    [string]$OutputPath = "D:\dev\dsh-engineer\docs\dev\2026-08-27-THCAD-V24-COM-Automation能力盘点.md",
    [string]$TlbImpPath = "C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\x64\TlbImp.exe",
    [string]$TlbImp32Path = "C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\TlbImp.exe"
)

$ErrorActionPreference = "Stop"

function MdCode {
    param([object]$Value)
    if ($null -eq $Value -or [string]$Value -eq "") {
        return "-"
    }
    return "``" + ([string]$Value).Replace('`', '``') + "``"
}

function MethodNames {
    param([Type]$Type)
    $methods = @($Type.GetMethods(
        [Reflection.BindingFlags]"Public,Instance,DeclaredOnly") |
        Where-Object { -not $_.IsSpecialName } |
        Group-Object Name |
        Sort-Object Name)
    return @($methods | ForEach-Object {
        if ($_.Count -gt 1) {
            "``$($_.Name)``×$($_.Count)"
        }
        else {
            "``$($_.Name)``"
        }
    })
}

function PropertyNames {
    param([Type]$Type)
    return @($Type.GetProperties(
        [Reflection.BindingFlags]"Public,Instance,DeclaredOnly") |
        Sort-Object Name |
        ForEach-Object {
            $access = @()
            if ($_.CanRead) { $access += "get" }
            if ($_.CanWrite) { $access += "set" }
            "``$($_.Name){$($access -join '/')}``"
        })
}

function EventNames {
    param([Type]$Type)
    return @($Type.GetEvents(
        [Reflection.BindingFlags]"Public,Instance,DeclaredOnly") |
        Sort-Object Name |
        ForEach-Object { "``$($_.Name)``" })
}

function FriendlyTypeName {
    param([Type]$Type)
    if ($Type.IsByRef) {
        return (FriendlyTypeName $Type.GetElementType()) + "&"
    }
    if ($Type.IsArray) {
        return (FriendlyTypeName $Type.GetElementType()) + "[]"
    }
    return $Type.Name
}

function MethodSignature {
    param([Reflection.MethodInfo]$Method)
    $parameters = @($Method.GetParameters() | ForEach-Object {
        $direction = if ($_.IsOut) { "out " } elseif ($_.ParameterType.IsByRef) { "ref " } else { "" }
        $parameterType = if ($_.ParameterType.IsByRef) {
            $_.ParameterType.GetElementType()
        }
        else {
            $_.ParameterType
        }
        $direction + (FriendlyTypeName $parameterType) + " " + $_.Name
    })
    return (FriendlyTypeName $Method.ReturnType) + " " + $Method.Name +
        "(" + ($parameters -join ", ") + ")"
}

if (-not (Test-Path -LiteralPath $ThcadDirectory)) {
    throw "THCAD directory not found: $ThcadDirectory"
}
if (-not (Test-Path -LiteralPath $MechanicalRoot)) {
    throw "Mechanical root not found: $MechanicalRoot"
}
if (-not (Test-Path -LiteralPath $ThsoftSharedDirectory)) {
    throw "THSOFT shared directory not found: $ThsoftSharedDirectory"
}
if (-not (Test-Path -LiteralPath $TlbImpPath)) {
    throw "TlbImp not found: $TlbImpPath"
}
if (-not (Test-Path -LiteralPath $TlbImp32Path)) {
    throw "32-bit TlbImp not found: $TlbImp32Path"
}

$probeDirectory = Split-Path -Parent $PSCommandPath
$temporaryDirectory = Join-Path $probeDirectory ".tmp-com"
New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null

$sources = @(
    [ordered]@{
        label = "BricscadDb"
        source = Join-Path $ThcadDirectory "axbricscaddb1.dll"
        output = Join-Path $temporaryDirectory "BricscadDb.Interop.dll"
        bitness = "64-bit"
        tlb_imp = $TlbImpPath
    },
    [ordered]@{
        label = "BricscadApp"
        source = Join-Path $ThcadDirectory "axbricscadapp1.dll"
        output = Join-Path $temporaryDirectory "BricscadApp.Interop.dll"
        bitness = "64-bit"
        tlb_imp = $TlbImpPath
    },
    [ordered]@{
        label = "BricscadSm"
        source = Join-Path $ThcadDirectory "axbricscadsm.dll"
        output = Join-Path $temporaryDirectory "BricscadSm.Interop.dll"
        bitness = "64-bit"
        tlb_imp = $TlbImpPath
    },
    [ordered]@{
        label = "THCadToolKit"
        source = Join-Path $MechanicalRoot "V24\THCadToolKit.arx"
        output = Join-Path $temporaryDirectory "THCadToolKit.Interop.dll"
        bitness = "64-bit"
        tlb_imp = $TlbImpPath
    },
    [ordered]@{
        label = "THCADComReport"
        source = Join-Path $ThsoftSharedDirectory "THCADComReport.ocx"
        output = Join-Path $temporaryDirectory "THCADComReport.Interop.dll"
        bitness = "32-bit"
        tlb_imp = $TlbImp32Path
    },
    [ordered]@{
        label = "THCADsCardInfoX"
        source = Join-Path $ThsoftSharedDirectory "THCADsCardInfoX.dll"
        output = Join-Path $temporaryDirectory "THCADsCardInfoX.Interop.dll"
        bitness = "32-bit"
        tlb_imp = $TlbImp32Path
    },
    [ordered]@{
        label = "THCADsCardEngine"
        source = Join-Path $ThsoftSharedDirectory "THCADsCardEngine.dll"
        output = Join-Path $temporaryDirectory "THCADsCardEngine.Interop.dll"
        bitness = "32-bit"
        tlb_imp = $TlbImp32Path
    },
    [ordered]@{
        label = "THCADReport"
        source = Join-Path $ThsoftSharedDirectory "THCADReport.ocx"
        output = Join-Path $temporaryDirectory "THCADReport.Interop.dll"
        bitness = "32-bit"
        tlb_imp = $TlbImp32Path
    },
    [ordered]@{
        label = "THCADPickUp"
        source = Join-Path $ThsoftSharedDirectory "THCADPickUp.ocx"
        output = Join-Path $temporaryDirectory "THCADPickUp.Interop.dll"
        bitness = "32-bit"
        tlb_imp = $TlbImp32Path
    },
    [ordered]@{
        label = "THCADPickUpEngine"
        source = Join-Path $ThsoftSharedDirectory "THCADPickUpEngine.dll"
        output = Join-Path $temporaryDirectory "THCADPickUpEngine.Interop.dll"
        bitness = "32-bit"
        tlb_imp = $TlbImp32Path
    }
)

foreach ($source in $sources) {
    if (-not (Test-Path -LiteralPath $source.source)) {
        throw "COM type-library source not found: $($source.source)"
    }
    if (Test-Path -LiteralPath $source.output) {
        Remove-Item -LiteralPath $source.output -Force
    }
    $arguments = @(
        $source.source,
        "/out:$($source.output)",
        "/silent")
    if ($source.label -eq "BricscadApp") {
        $arguments += "/reference:$($sources[0].output)"
    }
    & $source.tlb_imp @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "TlbImp failed for $($source.source): $LASTEXITCODE"
    }
}

$assemblyRows = @()
$interfaceRows = @()
foreach ($source in $sources) {
    $assembly = [Reflection.Assembly]::LoadFrom($source.output)
    $types = @($assembly.GetTypes())
    $interfaces = @($types | Where-Object { $_.IsInterface })
    $classes = @($types | Where-Object { $_.IsClass })
    $enums = @($types | Where-Object { $_.IsEnum })
    $declaredMethods = @($interfaces | ForEach-Object {
        $_.GetMethods([Reflection.BindingFlags]"Public,Instance,DeclaredOnly") |
            Where-Object { -not $_.IsSpecialName }
    })
    $declaredProperties = @($interfaces | ForEach-Object {
        $_.GetProperties([Reflection.BindingFlags]"Public,Instance,DeclaredOnly")
    })
    $declaredEvents = @($interfaces | ForEach-Object {
        $_.GetEvents([Reflection.BindingFlags]"Public,Instance,DeclaredOnly")
    })
    $assemblyRows += [ordered]@{
        label = $source.label
        source = $source.source
        bitness = $source.bitness
        sha256 = (Get-FileHash -LiteralPath $source.source -Algorithm SHA256).Hash.ToLowerInvariant()
        type_count = $types.Count
        interface_count = $interfaces.Count
        class_count = $classes.Count
        enum_count = $enums.Count
        method_count = $declaredMethods.Count
        property_count = $declaredProperties.Count
        event_count = $declaredEvents.Count
    }
    foreach ($type in $interfaces) {
        $methodNames = MethodNames $type
        $propertyNames = PropertyNames $type
        $eventNames = EventNames $type
        if ($methodNames.Count + $propertyNames.Count + $eventNames.Count -eq 0) {
            continue
        }
        $interfaceRows += [ordered]@{
            library = $source.label
            type = $type
            full_name = $type.FullName
            methods = $methodNames
            properties = $propertyNames
            events = $eventNames
        }
    }
}

$registered = @()
$prefixPattern = "^(BricscadApp|BricscadDb|BricscadSm|THCadToolKit|THCAD)"
foreach ($key in Get-ChildItem -Path "Registry::HKEY_CLASSES_ROOT" -ErrorAction SilentlyContinue) {
    if ($key.PSChildName -notmatch $prefixPattern) {
        continue
    }
    $classIdPath = Join-Path $key.PSPath "CLSID"
    if (-not (Test-Path -LiteralPath $classIdPath)) {
        continue
    }
    $classId = (Get-ItemProperty -LiteralPath $classIdPath -ErrorAction SilentlyContinue)."(default)"
    if ([string]::IsNullOrWhiteSpace($classId)) {
        continue
    }
    $classPath = "Registry::HKEY_CLASSES_ROOT\CLSID\$classId"
    $registryView = "64-bit"
    if (-not (Test-Path -LiteralPath $classPath)) {
        $classPath = "Registry::HKEY_CLASSES_ROOT\WOW6432Node\CLSID\$classId"
        $registryView = "32-bit"
    }
    $inproc = (Get-ItemProperty -LiteralPath (Join-Path $classPath "InprocServer32") -ErrorAction SilentlyContinue)."(default)"
    $local = (Get-ItemProperty -LiteralPath (Join-Path $classPath "LocalServer32") -ErrorAction SilentlyContinue)."(default)"
    $typeLib = (Get-ItemProperty -LiteralPath (Join-Path $classPath "TypeLib") -ErrorAction SilentlyContinue)."(default)"
    $registered += [ordered]@{
        prog_id = $key.PSChildName
        description = (Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue)."(default)"
        clsid = $classId
        server = if ($inproc) { $inproc } else { $local }
        server_kind = if ($inproc) { "inproc" } elseif ($local) { "local" } else { "unknown" }
        type_lib = $typeLib
        registry_view = $registryView
    }
}
$registered = @($registered | Sort-Object { $_["prog_id"] })

$runtime = $null
$runtimeProbePath = Join-Path $probeDirectory "ProbeThcadComRuntime.ps1"
try {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $runtimeJson = & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $runtimeProbePath
    $runtime = $runtimeJson | ConvertFrom-Json
}
catch {
    $runtime = [pscustomobject]@{
        attached = $false
        error = $_.Exception.Message
    }
}

$runtime32 = $null
$runtime32ProbePath = Join-Path $probeDirectory "ProbeThcadCom32Runtime.ps1"
try {
    $windowsPowerShell32 = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
    $runtime32Json = & $windowsPowerShell32 -NoProfile -Sta -ExecutionPolicy Bypass -File $runtime32ProbePath
    $runtime32 = $runtime32Json | ConvertFrom-Json
}
catch {
    $runtime32 = [pscustomobject]@{
        process_bitness = "32-bit"
        components = @()
        error = $_.Exception.Message
    }
}

$totalInterfaces = 0
$totalMethods = 0
$totalProperties = 0
$totalEvents = 0
foreach ($row in $assemblyRows) {
    $totalInterfaces += [int]$row.interface_count
    $totalMethods += [int]$row.method_count
    $totalProperties += [int]$row.property_count
    $totalEvents += [int]$row.event_count
}

$text = [Text.StringBuilder]::new()
[void]$text.AppendLine("# THCAD V24 COM Automation 能力盘点")
[void]$text.AppendLine()
[void]$text.AppendLine("> 生成日期：$(Get-Date -Format yyyy-MM-dd)  ")
[void]$text.AppendLine("> 实测安装：``$MechanicalRoot``  ")
[void]$text.AppendLine("> 生成器：``dev-test/visualstudionetframework/probes/ExportThcadComApiInventory.ps1``")
[void]$text.AppendLine()
[void]$text.AppendLine("## 0. 结论和口径")
[void]$text.AppendLine()
[void]$text.AppendLine("COM 确实是独立能力面，不等同于 .NET 字段或 .NET 类型。当前 $($sources.Count) 个类型库共转换出 **$totalInterfaces 个接口、$totalMethods 个声明方法、$totalProperties 个声明属性、$totalEvents 个声明事件**；注册表中按 BricsCAD/THCAD 前缀找到 **$($registered.Count) 个 ProgID**（含版本化别名和 32/64 位注册）。")
[void]$text.AppendLine()
[void]$text.AppendLine("本盘点列出完整类型库成员，不排除创建、写入、删除、保存、打印、命令调度或 UI 配置能力。运行时验证只读取当前状态，是为了避免盘点动作本身改图；这不表示能力目录只收只读成员。")
[void]$text.AppendLine()
[void]$text.AppendLine("COM 与 .NET 大量重叠，但各有独有入口：COM 适合跨进程自动化、文档/选择集/模型空间对象操作；THCAD 进程内的大批量几何与专业对象解析仍通常由 .NET 更直接。是否采用取决于功能边界与实测性能，不能从一个能力面缺字段就断言另一个能力面也拿不到。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 1. 类型库规模")
[void]$text.AppendLine()
[void]$text.AppendLine("| 类型库 | 位数 | 源文件 | 接口 | 类 | 枚举 | 方法 | 属性 | 事件 |")
[void]$text.AppendLine("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |")
foreach ($row in $assemblyRows) {
    [void]$text.AppendLine("| ``$($row.label)`` | $($row.bitness) | ``$($row.source)`` | $($row.interface_count) | $($row.class_count) | $($row.enum_count) | $($row.method_count) | $($row.property_count) | $($row.event_count) |")
}
[void]$text.AppendLine()
[void]$text.AppendLine("这里的方法计数不含属性/事件生成的特殊访问器；64 位和 32 位类型库分别由对应位数的本机 ``TlbImp.exe`` 转换。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 2. 能力导航")
[void]$text.AppendLine()
[void]$text.AppendLine("- ``BricscadApp``：Application、Documents、Document、SelectionSet、Utility、Preferences、Plot、菜单/工具栏、状态与事件；")
[void]$text.AppendLine("- ``BricscadDb``：Database、ModelSpace/PaperSpace、基础实体、块/属性、图层和其他符号表、字典/XRecord、标注、填充、表格、三维实体与曲面；")
[void]$text.AppendLine("- ``BricscadSm``：图纸集、子集、图纸、视图、发布选项、资源与自定义属性；")
[void]$text.AppendLine("- ``THCadToolKit``（64 位）：PCCAD 路径与初始化、标题栏/明细表/图幅刷新、DWG 打开关闭、二维码、块属性写入、TH 数据库、明细与序号记录、图幅记录器；")
[void]$text.AppendLine("- ``THCADPickUp`` / ``THCADPickUpEngine``（32 位）：数据提取配置、文件队列、单文件/批量提取、无效文件与失败信息；")
[void]$text.AppendLine("- ``THCADsCardInfoX`` / ``THCADsCardEngine``（32 位）：卡片、表、字段结构，以及卡片批量生成和保存；")
[void]$text.AppendLine("- ``THCADReport`` / ``THCADComReport``（32 位）：报表连接、数据源、汇总类型、报表方法和刷新配置。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 3. 当前运行时验证")
[void]$text.AppendLine()
if ($runtime.attached) {
    [void]$text.AppendLine("已通过 ``BricscadApp.AcadApplication`` 附着当前 THCAD：")
    [void]$text.AppendLine()
    [void]$text.AppendLine("- 应用：$(MdCode $runtime.application.name)，版本 $(MdCode $runtime.application.version)；")
    [void]$text.AppendLine("- 当前图：$(MdCode $runtime.active_document.name)；")
    [void]$text.AppendLine("- COM ModelSpace 数：$($runtime.active_document.model_space_count)，图层数：$($runtime.active_document.layer_count)，当前 Pickfirst：$($runtime.active_document.pickfirst_count)；")
    [void]$text.AppendLine("- ``ActiveDocument``、``ModelSpace``、``Layers``、``SelectionSets``、``PickfirstSelectionSet``、``GetVariable`` 已实测可读；现有触发脚本还实测了 ``SendCommand``。")
    [void]$text.AppendLine()
    [void]$text.AppendLine("THCadToolKit 激活结果：")
    [void]$text.AppendLine()
    foreach ($item in $runtime.thcad_toolkit) {
        $state = if ($item.created) { "成功" } else { "失败：$($item.error)" }
        [void]$text.AppendLine("- $(MdCode $item.prog_id)：$state；")
    }
    [void]$text.AppendLine()
    $createdToolkit = @($runtime.thcad_toolkit | Where-Object { $_.created }).Count
    $failedToolkit = @($runtime.thcad_toolkit | Where-Object { -not $_.created }).Count
    [void]$text.AppendLine("本次六个 THCadToolKit ProgID 中成功创建 $createdToolkit 个、失败 $failedToolkit 个。这个结果与上方每项错误一起保留；「注册表有名字」仍需逐入口运行时验证，不能只看元数据。")
}
else {
    [void]$text.AppendLine("未能附着当前 THCAD：$(MdCode $runtime.error)。类型库与注册表静态盘点仍然有效。")
}
[void]$text.AppendLine()
[void]$text.AppendLine("32 位天河业务组件激活结果（由 32 位 Windows PowerShell 独立进程执行）：")
[void]$text.AppendLine()
if ($runtime32.error) {
    [void]$text.AppendLine("- 探针失败：$(MdCode $runtime32.error)")
}
else {
    foreach ($item in $runtime32.components) {
        $state = if ($item.created) { "成功" } else { "失败：$($item.error)" }
        [void]$text.AppendLine("- $(MdCode $item.prog_id)：$state；")
    }
    $created32 = @($runtime32.components | Where-Object { $_.created }).Count
    $failed32 = @($runtime32.components | Where-Object { -not $_.created }).Count
    [void]$text.AppendLine()
    [void]$text.AppendLine("本次 32 位代表性 ProgID 成功创建 $created32 个、失败 $failed32 个。它们注册为 32 位进程内 COM 服务器，不能直接装进 64 位 THCAD/.NET 进程；若正式复用，需要 32 位辅助进程、既有天河工作流或另行验证的跨进程封装。")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 4. THCadToolKit 完整接口")
[void]$text.AppendLine()
foreach ($row in $interfaceRows | Where-Object { $_.library -eq "THCadToolKit" } | Sort-Object full_name) {
    [void]$text.AppendLine("### ``$($row.full_name)``")
    [void]$text.AppendLine()
    foreach ($method in $row.type.GetMethods([Reflection.BindingFlags]"Public,Instance,DeclaredOnly") |
        Where-Object { -not $_.IsSpecialName } | Sort-Object Name) {
        [void]$text.AppendLine("- 方法：``$(MethodSignature $method)``")
    }
    foreach ($property in $row.type.GetProperties([Reflection.BindingFlags]"Public,Instance,DeclaredOnly") |
        Sort-Object Name) {
        $access = @()
        if ($property.CanRead) { $access += "get" }
        if ($property.CanWrite) { $access += "set" }
        [void]$text.AppendLine("- 属性：``$(FriendlyTypeName $property.PropertyType) $($property.Name){$($access -join '/')}``")
    }
    [void]$text.AppendLine()
}
[void]$text.AppendLine("这些名称已经暴露出目前 .NET 抽取尚未系统调用的一批高价值业务入口，尤其是 ``GetBomRecorder``、``GetXuHaoLabel``、``GetPaperRecorder``、标题栏/明细表刷新与块属性写入。成员存在不代表当前对象初始化条件已经满足，后续按具体需求逐个实测。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 5. 注册 ProgID 索引")
[void]$text.AppendLine()
[void]$text.AppendLine("| ProgID | 注册视图 | CLSID | 服务器 | 类型库 |")
[void]$text.AppendLine("| --- | --- | --- | --- | --- |")
foreach ($item in $registered) {
    [void]$text.AppendLine("| $(MdCode $item.prog_id) | $(MdCode $item.registry_view) | $(MdCode $item.clsid) | $(MdCode $item.server) | $(MdCode $item.type_lib) |")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 6. 完整接口成员索引")
[void]$text.AppendLine()
foreach ($group in $interfaceRows | Group-Object library | Sort-Object Name) {
    [void]$text.AppendLine("### $($group.Name)")
    [void]$text.AppendLine()
    foreach ($row in $group.Group | Sort-Object full_name) {
        $parts = @()
        if ($row.methods.Count -gt 0) { $parts += "方法：" + ($row.methods -join ", ") }
        if ($row.properties.Count -gt 0) { $parts += "属性：" + ($row.properties -join ", ") }
        if ($row.events.Count -gt 0) { $parts += "事件：" + ($row.events -join ", ") }
        [void]$text.AppendLine("- ``$($row.full_name)`` — " + ($parts -join "；"))
    }
    [void]$text.AppendLine()
}
[void]$text.AppendLine("## 7. 边界")
[void]$text.AppendLine()
[void]$text.AppendLine("- 本篇覆盖已注册 COM 类型库和 ProgID，不覆盖没有类型库的私有 IDispatch、LISP 函数、命令表或原生 C++ ABI；")
[void]$text.AppendLine("- 类型库成员存在不保证 THCAD 当前版本、当前许可证、当前图纸或某个专业对象都支持；")
[void]$text.AppendLine("- COM 跨进程逐实体调用通常比进程内 .NET 更重；性能结论需要实际基准，不能仅凭接口形态下结论；")
[void]$text.AppendLine("- 修改类成员应在明确功能里使用事务/撤销和保存策略；本盘点不删除它们，也不在扫描阶段盲目调用它们。")

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
[IO.File]::WriteAllText($OutputPath, $text.ToString(), [Text.UTF8Encoding]::new($false))
Write-Host "Wrote $OutputPath"
