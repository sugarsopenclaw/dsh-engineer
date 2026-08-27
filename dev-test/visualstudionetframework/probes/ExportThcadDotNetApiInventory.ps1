param(
    [string]$ThcadDirectory = "D:\THSOFT\THCAD V24_Mechanical2D\THCAD",
    [string]$OutputPath = "D:\dev\dsh-engineer\docs\dev\2026-08-27-THCAD-V24-DotNet公开能力盘点.md"
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core") {
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $source = Get-Content -LiteralPath $PSCommandPath -Raw -Encoding UTF8
    $windowsScript = Join-Path $env:TEMP "ExportThcadDotNetApiInventory.windows.ps1"
    [IO.File]::WriteAllText($windowsScript, $source, [Text.Encoding]::Unicode)
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $windowsScript `
        -ThcadDirectory $ThcadDirectory -OutputPath $OutputPath
    exit $LASTEXITCODE
}

function Get-PublicTypes {
    param([Reflection.Assembly]$Assembly, [System.Collections.Generic.List[string]]$Errors)

    try {
        return @($Assembly.GetExportedTypes())
    }
    catch [Reflection.ReflectionTypeLoadException] {
        foreach ($loaderError in $_.Exception.LoaderExceptions) {
            if ($null -ne $loaderError) {
                $Errors.Add($Assembly.GetName().Name + ": " + $loaderError.Message)
            }
        }
        return @($_.Exception.Types | Where-Object { $null -ne $_ })
    }
}

function Get-TypeKind {
    param([Type]$Type)

    if ($Type.IsEnum) { return "enum" }
    if ([MulticastDelegate].IsAssignableFrom($Type)) { return "delegate" }
    if ($Type.IsInterface) { return "interface" }
    if ($Type.IsValueType) { return "struct" }
    if ($Type.IsAbstract -and $Type.IsSealed) { return "static class" }
    if ($Type.IsAbstract) { return "abstract class" }
    return "class"
}

function Get-MethodNames {
    param([Type]$Type, [Reflection.BindingFlags]$Flags)

    $methods = @($Type.GetMethods($Flags) | Where-Object {
        -not $_.IsSpecialName -or $_.Name -like "op_*"
    })
    $names = @()
    foreach ($group in $methods | Group-Object Name | Sort-Object Name) {
        $names += if ($group.Count -gt 1) {
            "``$($group.Name)``×$($group.Count)"
        }
        else {
            "``$($group.Name)``"
        }
    }
    return @($names)
}

function Get-PropertyNames {
    param([Type]$Type, [Reflection.BindingFlags]$Flags)

    $names = @()
    foreach ($property in $Type.GetProperties($Flags) | Sort-Object Name) {
        $access = @()
        if ($null -ne $property.GetGetMethod($false)) { $access += "get" }
        if ($null -ne $property.GetSetMethod($false)) { $access += "set" }
        $names += "``$($property.Name){$($access -join '/')}``"
    }
    return @($names)
}

function Get-EventNames {
    param([Type]$Type, [Reflection.BindingFlags]$Flags)
    return @($Type.GetEvents($Flags) | Sort-Object Name | ForEach-Object { "``$($_.Name)``" })
}

function Get-FieldNames {
    param([Type]$Type, [Reflection.BindingFlags]$Flags)

    if ($Type.IsEnum) {
        return @()
    }
    return @($Type.GetFields($Flags) |
        Where-Object { -not $_.IsSpecialName } |
        Sort-Object Name |
        ForEach-Object { "``$($_.Name)``" })
}

function Join-Members {
    param([object[]]$Values)
    return ($Values -join ", ")
}

if (-not (Test-Path -LiteralPath $ThcadDirectory -PathType Container)) {
    throw "THCAD directory not found: $ThcadDirectory"
}

$managedFiles = @()
foreach ($file in Get-ChildItem -LiteralPath $ThcadDirectory -Filter "*.dll" -File) {
    try {
        $assemblyName = [Reflection.AssemblyName]::GetAssemblyName($file.FullName)
        $managedFiles += [pscustomobject]@{
            File = $file
            AssemblyName = $assemblyName
        }
    }
    catch {
        # Native DLL: not part of the managed API inventory.
    }
}
$managedFiles = @($managedFiles | Sort-Object { $_.AssemblyName.Name })

$targetAssemblies = @()
foreach ($managed in $managedFiles) {
    $targetAssemblies += [Reflection.Assembly]::ReflectionOnlyLoadFrom($managed.File.FullName)
}

$loadQueue = [System.Collections.Generic.Queue[Reflection.Assembly]]::new()
foreach ($assembly in $targetAssemblies) {
    $loadQueue.Enqueue($assembly)
}
while ($loadQueue.Count -gt 0) {
    $assembly = $loadQueue.Dequeue()
    foreach ($reference in $assembly.GetReferencedAssemblies()) {
        $alreadyLoaded = [AppDomain]::CurrentDomain.ReflectionOnlyGetAssemblies() |
            Where-Object { $_.FullName -eq $reference.FullName } |
            Select-Object -First 1
        if ($null -ne $alreadyLoaded) {
            continue
        }

        $localPath = Join-Path $ThcadDirectory ($reference.Name + ".dll")
        try {
            $dependency = if (Test-Path -LiteralPath $localPath) {
                [Reflection.Assembly]::ReflectionOnlyLoadFrom($localPath)
            }
            else {
                [Reflection.Assembly]::ReflectionOnlyLoad($reference.FullName)
            }
            if ($null -ne $dependency) {
                $loadQueue.Enqueue($dependency)
            }
        }
        catch {
            # GetExportedTypes below records any dependency that is actually needed.
        }
    }
}

$flags = [Reflection.BindingFlags](
    [Reflection.BindingFlags]::Public -bor
    [Reflection.BindingFlags]::Instance -bor
    [Reflection.BindingFlags]::Static -bor
    [Reflection.BindingFlags]::DeclaredOnly)
$loadErrors = [System.Collections.Generic.List[string]]::new()
$assemblyRows = @()
$typesByAssembly = @{}
$namespaceRows = @()

foreach ($assembly in $targetAssemblies | Sort-Object { $_.GetName().Name }) {
    $types = @(Get-PublicTypes -Assembly $assembly -Errors $loadErrors | Sort-Object FullName)
    $typesByAssembly[$assembly.GetName().Name] = $types
    $methodOverloads = 0
    $properties = 0
    $events = 0
    $constructors = 0
    $fields = 0
    $enums = 0
    $delegates = 0
    $methodNameSet = @{}

    foreach ($type in $types) {
        try {
            if ($type.IsEnum) { $enums++ }
            if ([MulticastDelegate].IsAssignableFrom($type)) { $delegates++ }
            $methods = @($type.GetMethods($flags) | Where-Object {
                -not $_.IsSpecialName -or $_.Name -like "op_*"
            })
            $methodOverloads += $methods.Count
            foreach ($method in $methods) { $methodNameSet[$method.Name] = $true }
            $properties += @($type.GetProperties($flags)).Count
            $events += @($type.GetEvents($flags)).Count
            $constructors += @($type.GetConstructors($flags)).Count
            $fields += @($type.GetFields($flags)).Count
        }
        catch {
            $loadErrors.Add($type.FullName + ": " + $_.Exception.Message)
        }
    }

    $file = $managedFiles |
        Where-Object { $_.AssemblyName.Name -eq $assembly.GetName().Name } |
        Select-Object -First 1
    $assemblyRows += [pscustomobject]@{
        Assembly = $assembly.GetName().Name
        File = $file.File.Name
        Version = $assembly.GetName().Version.ToString()
        Sha256 = (Get-FileHash -LiteralPath $file.File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Types = $types.Count
        Enums = $enums
        Delegates = $delegates
        MethodOverloads = $methodOverloads
        MethodNames = $methodNameSet.Count
        Properties = $properties
        Events = $events
        Constructors = $constructors
        Fields = $fields
    }

    foreach ($namespaceGroup in $types | Group-Object Namespace | Sort-Object Name) {
        $namespaceRows += [pscustomobject]@{
            Assembly = $assembly.GetName().Name
            Namespace = if ([string]::IsNullOrWhiteSpace($namespaceGroup.Name)) {
                "(global)"
            }
            else {
                $namespaceGroup.Name
            }
            Types = $namespaceGroup.Count
        }
    }
}

$totalTypes = ($assemblyRows | Measure-Object Types -Sum).Sum
$totalMethodOverloads = ($assemblyRows | Measure-Object MethodOverloads -Sum).Sum
$totalProperties = ($assemblyRows | Measure-Object Properties -Sum).Sum
$totalEvents = ($assemblyRows | Measure-Object Events -Sum).Sum
$totalConstructors = ($assemblyRows | Measure-Object Constructors -Sum).Sum
$totalFields = ($assemblyRows | Measure-Object Fields -Sum).Sum

$text = [Text.StringBuilder]::new()
[void]$text.AppendLine("# THCAD V24 .NET 公开能力盘点")
[void]$text.AppendLine()
[void]$text.AppendLine("> 生成日期：2026-08-27  ")
[void]$text.AppendLine("> 实测安装目录：``$ThcadDirectory``  ")
[void]$text.AppendLine("> 生成器：``dev-test/visualstudionetframework/probes/ExportThcadDotNetApiInventory.ps1``")
[void]$text.AppendLine()
[void]$text.AppendLine("## 0. 结论和口径")
[void]$text.AppendLine()
[void]$text.AppendLine("本机 THCAD V24 安装目录中可识别出 **$($assemblyRows.Count) 个托管程序集、$totalTypes 个公开类型、$totalMethodOverloads 个公开方法重载、$totalProperties 个公开属性、$totalEvents 个公开事件、$totalConstructors 个公开构造器、$totalFields 个公开字段**。字段总数包含枚举常量；完整成员索引不展开枚举值。本盘点没有排除写入、创建、修改、删除、变换、保存、事务、编辑器交互等能力。")
[void]$text.AppendLine()
[void]$text.AppendLine("这里盘的是 **公开 .NET API 能力面**，与 ``docs/thcad-extract-fields/`` 的 **JSON 键级库存** 是两条不同维度：字段库存回答「当前抽取器已经保存了什么」，本篇回答「本机程序集还公开了哪些可调用入口」。``ExplodeGeometry`` 正是后一个维度中的方法，旧字段库存不会自动出现它的计算结果。")
[void]$text.AppendLine()
[void]$text.AppendLine("附录按程序集、命名空间、类型列出全部公开声明成员。为保持可读性：方法重载合并为同一个名字并用 ``×N`` 标出数量；属性标明 ``get`` / ``set``；构造器只记数量；枚举类型全部列出但不展开每个枚举值；继承成员只在声明它的基类列一次。不存在「只读白名单」。")
[void]$text.AppendLine()
[void]$text.AppendLine("边界也要说清：这是安装目录中 **公开托管 .NET 程序集** 的完整元数据盘点，不包含原生 C++/BRX/ARX 导出、COM Automation、LISP/命令表或天河未公开的私有实现；这些属于另外的能力面，不应假装已被本篇覆盖。")
[void]$text.AppendLine()
[void]$text.AppendLine("API 被列出不等于每个天河专业对象都实现了相同行为。例如 ``TH_XuHaoEntity`` 的 ``Entity.Explode`` 返回 ``eNotApplicable``，但 ``Entity.ExplodeGeometry`` 成功。是否对具体 ``runtime_class`` 有效，需要另做运行时支持矩阵；这不影响它作为公开能力被完整登记。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 1. 程序集规模")
[void]$text.AppendLine()
[void]$text.AppendLine("| 程序集 | 版本 | 公开类型 | 方法重载 / 方法名 | 属性 | 事件 | 构造器 | 字段 |")
[void]$text.AppendLine("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |")
foreach ($row in $assemblyRows) {
    [void]$text.AppendLine("| ``$($row.Assembly)`` | $($row.Version) | $($row.Types) | $($row.MethodOverloads) / $($row.MethodNames) | $($row.Properties) | $($row.Events) | $($row.Constructors) | $($row.Fields) |")
}
[void]$text.AppendLine()
[void]$text.AppendLine("程序集 SHA-256：")
[void]$text.AppendLine()
foreach ($row in $assemblyRows) {
    [void]$text.AppendLine("- ``$($row.File)``：``$($row.Sha256)``")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 2. 能力总览（包含读取与写入）")
[void]$text.AppendLine()
[void]$text.AppendLine("下面只做导航，完整方法名在附录。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.1 DWG / DXF / 数据库生命周期")
[void]$text.AppendLine()
[void]$text.AppendLine("``Database`` 公开了 ``ReadDwgFile``、``ReadDwgFileFromMemory``、``Save``、``SaveAs``、``DxfIn``、``DxfOut``、``Wblock``、``Insert``、``AttachXref``、``OverlayXref``、``BindXrefs``、``DetachXref``、``ReloadXrefs``、``UnloadXrefs``、``Audit``、``Purge``、``Undo``、``Redo``、``AddDBObject``、``DeepCloneObjects``、``WblockCloneObjects`` 等。也就是说文件读取、写回、另存、导入导出、外参、清理、审计、克隆和撤销并未从盘点中排除。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.2 对象生命周期、事务与持久化")
[void]$text.AppendLine()
[void]$text.AppendLine("``DBObject`` / ``Transaction`` / ``TransactionManager`` 包含 ``GetObject``、``AddNewlyCreatedDBObject``、``Commit``、``Abort``、``UpgradeOpen``、``DowngradeOpen``、``Erase``、``DeepClone``、``WblockClone``、``HandOverTo``、``SwapIdWith``、``SetField``、``RemoveField``、``CreateExtensionDictionary``、``ReleaseExtensionDictionary``、``DwgIn`` / ``DwgOut``、``DxfIn`` / ``DxfOut``、XData 和 reactor 操作。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.3 实体几何、计算、分解和直接修改")
[void]$text.AppendLine()
[void]$text.AppendLine("``Entity`` 同时公开 ``GeometricExtents``、``Explode``、``ExplodeGeometry``、``ExplodeGeometryToBlock``、``ExplodeGeometryToOwnerSpace``、``GetGripPoints``、``MoveGripPointsAt``、``GetStretchPoints``、``MoveStretchPointsAt``、``GetObjectSnapPoints``、``IntersectWith``、``BoundingBoxIntersectWith``、``JoinEntity`` / ``JoinEntities``、``TransformBy``、``GetTransformedCopy``、``SetPropertiesFrom``、``SetDatabaseDefaults``、高亮、拖拽和子实体路径操作。这里既有计算，也有明确的修改能力。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.4 曲线计算与编辑")
[void]$text.AppendLine()
[void]$text.AppendLine("``Curve`` 公开最近点、点↔参数↔距离互算、一二阶导数、投影、正交投影、偏移、分割、延伸、反向及 ``SetFromGeCurve``：``GetClosestPointTo``、``GetPointAtParameter``、``GetPointAtDist``、``GetParameterAtPoint``、``GetParameterAtDistance``、``GetDistanceAtParameter``、``GetDistAtPoint``、``GetFirstDerivative``、``GetSecondDerivative``、``GetProjectedCurve``、``GetOrthoProjectedCurve``、``GetOffsetCurves``、``GetSplitCurves``、``Extend``、``ReverseCurve``。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.5 块、属性、图层、字典和表")
[void]$text.AppendLine()
[void]$text.AppendLine("包含 ``BlockTableRecord.AppendEntity``、``AssumeOwnershipOf``、``BlockReference.ExplodeToOwnerSpace``、``ConvertToStaticBlock``、``ResetBlock``、动态块属性集合、Attribute / AttributeDefinition、Layer / Linetype / TextStyle / DimStyle 等符号表、``DBDictionary`` / ``Xrecord``、Group、Layout、DataLink 和表格对象的增删改查入口。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.6 二维图元、文字、标注、填充和打印")
[void]$text.AppendLine()
[void]$text.AppendLine("Line、Polyline、Arc、Circle、Ellipse、Spline、Region、Hatch、DBText、MText、Dimension、Leader、MLeader、Table、Viewport、PlotSettings 等类型均在完整索引中。``Hatch`` 例如同时提供 ``AppendLoop``、``InsertLoopAt``、``RemoveLoopAt``、``EvaluateHatch``、``SetHatchPattern``、``SetGradient`` 以及边界和图案读取。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.7 三维实体、曲面、网格和 B-Rep")
[void]$text.AppendLine()
[void]$text.AppendLine("``Solid3d`` 具备布尔运算、拉伸、旋转、放样、扫掠、倒角、圆角、抽壳、切片、干涉检查、投影、面/边复制与材料修改；``Surface`` 具备布尔、偏移、修剪、加厚、切片、投影和 NURBS 转换；``TD_MgdBrep`` 另外公开 B-Rep 拓扑遍历类型。创建和修改能力均已登记。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.8 参数与几何约束")
[void]$text.AppendLine()
[void]$text.AppendLine("``TD_MgdDbConstraints`` 公开几何约束、尺寸约束、约束组、变量和值依赖相关类型与方法。它不仅能查询，也包含添加、删除、求值和更新类入口；完整名称见该程序集附录。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.9 编辑器、选择、命令与交互")
[void]$text.AppendLine()
[void]$text.AppendLine("``Bricscad.EditorInput.Editor`` 公开 ``Command`` / ``CommandAsync``、各种 ``Get*`` 输入、``GetSelection``、``SelectAll``、窗口/交叉/围栏/多边形选择、``SetImpliedSelection``、``Drag``、``Snap``、``TraceBoundary``、视图切换、重生成和屏幕更新。``Document`` / ``DocumentCollection`` 还提供打开、创建、关闭保存、关闭丢弃、锁文档和应用上下文执行。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.10 应用、事件、图形系统和插件入口")
[void]$text.AppendLine()
[void]$text.AppendLine("``BrxMgd`` 包含 Application / Document / Window / Runtime / EditorInput / GraphicsSystem / PlottingServices 等命名空间，既有命令注册与事件，也有文档、视图、绘制、打印和宿主交互能力。122 个公开事件已完整计数并在类型索引中列名。")
[void]$text.AppendLine()
[void]$text.AppendLine("### 2.11 TA 建筑与结构扩展")
[void]$text.AppendLine()
[void]$text.AppendLine("``TA_Mgd``、``TA_MgdArch``、``TA_MgdStructure`` 共公开 75 个类型，覆盖 AEC / 建筑 / 结构相关对象接口。它们与天河机械 ``TH_*`` 私有业务对象不是同一层，但属于本机 THCAD 安装公开的托管能力，因此没有删除。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 3. 已经实测过的方法能力")
[void]$text.AppendLine()
[void]$text.AppendLine("- ``Entity.Explode``：普通部分专业对象可用；``TH_XuHaoEntity`` 实测 ``eNotApplicable``。")
[void]$text.AppendLine("- ``Entity.ExplodeGeometry``：``TH_XuHaoEntity`` 可用；七图 178 个对象全部取得序号圆中心，162 个有真实指向端，16 个对象只有序号圆和文字。")
[void]$text.AppendLine("- ``Entity.GetGripPoints``（旧重载）：当前序号对象取得 6 个夹点。")
[void]$text.AppendLine("- ``Entity.GetStretchPoints``：当前序号对象取得同一组 6 个拉伸点。")
[void]$text.AppendLine("- ``Entity.GetObjectSnapPoints``：当前序号对象取得端点和圆心捕捉点。")
[void]$text.AppendLine("- ``Entity.GeometricExtents`` 属性：当前序号对象读取时返回 ``eInvalidExtents``，说明成员存在但该对象实现不可用。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 4. 命名空间索引")
[void]$text.AppendLine()
[void]$text.AppendLine("| 程序集 | 命名空间 | 公开类型数 |")
[void]$text.AppendLine("| --- | --- | ---: |")
foreach ($row in $namespaceRows | Sort-Object Assembly, Namespace) {
    [void]$text.AppendLine("| ``$($row.Assembly)`` | ``$($row.Namespace)`` | $($row.Types) |")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 5. 完整公开类型与成员名索引")
[void]$text.AppendLine()
[void]$text.AppendLine("下面是本次元数据扫描的完整索引。方法只合并重载，不按主观用途删减；属性的 ``set`` 能直接暴露写入面。枚举值本身不展开。")
[void]$text.AppendLine()

foreach ($assemblyRow in $assemblyRows) {
    $assemblyName = $assemblyRow.Assembly
    [void]$text.AppendLine("### $assemblyName")
    [void]$text.AppendLine()
    $types = @($typesByAssembly[$assemblyName])
    foreach ($namespaceGroup in $types | Group-Object Namespace | Sort-Object Name) {
        $namespaceName = if ([string]::IsNullOrWhiteSpace($namespaceGroup.Name)) {
            "(global)"
        }
        else {
            $namespaceGroup.Name
        }
        [void]$text.AppendLine("#### ``$namespaceName``")
        [void]$text.AppendLine()
        foreach ($type in $namespaceGroup.Group | Sort-Object FullName) {
            try {
                $kind = Get-TypeKind -Type $type
                $constructors = @($type.GetConstructors($flags)).Count
                if ($type.IsEnum) {
                    $enumValues = @($type.GetFields($flags) | Where-Object { $_.IsLiteral }).Count
                    [void]$text.AppendLine("- ``$($type.FullName)`` — $kind；枚举值：$enumValues")
                    continue
                }

                $methodNames = @(Get-MethodNames -Type $type -Flags $flags)
                $propertyNames = @(Get-PropertyNames -Type $type -Flags $flags)
                $eventNames = @(Get-EventNames -Type $type -Flags $flags)
                $fieldNames = @(Get-FieldNames -Type $type -Flags $flags)
                $summary = "- ``$($type.FullName)`` — $kind；构造器：$constructors"
                if ($methodNames.Count -gt 0) {
                    $summary += "；方法：" + (Join-Members $methodNames)
                }
                if ($propertyNames.Count -gt 0) {
                    $summary += "；属性：" + (Join-Members $propertyNames)
                }
                if ($eventNames.Count -gt 0) {
                    $summary += "；事件：" + (Join-Members $eventNames)
                }
                if ($fieldNames.Count -gt 0) {
                    $summary += "；字段：" + (Join-Members $fieldNames)
                }
                [void]$text.AppendLine($summary)
            }
            catch {
                $loadErrors.Add($type.FullName + ": " + $_.Exception.Message)
                [void]$text.AppendLine("- ``$($type.FullName)`` — 成员读取失败，见完整性检查")
            }
        }
        [void]$text.AppendLine()
    }
}

[void]$text.AppendLine("## 6. 完整性检查")
[void]$text.AppendLine()
[void]$text.AppendLine("- 托管程序集：$($assemblyRows.Count)")
[void]$text.AppendLine("- 公开类型：$totalTypes")
[void]$text.AppendLine("- 公开方法重载：$totalMethodOverloads")
[void]$text.AppendLine("- 公开属性：$totalProperties")
[void]$text.AppendLine("- 公开事件：$totalEvents")
[void]$text.AppendLine("- 公开构造器：$totalConstructors")
[void]$text.AppendLine("- 公开字段：$totalFields")
[void]$text.AppendLine("- 反射/成员读取错误：$($loadErrors.Count)")
if ($loadErrors.Count -gt 0) {
    [void]$text.AppendLine()
    foreach ($errorMessage in $loadErrors | Sort-Object -Unique) {
        [void]$text.AppendLine("  - " + $errorMessage.Replace("`r", " ").Replace("`n", " "))
    }
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    [void](New-Item -ItemType Directory -Path $outputDirectory)
}
[IO.File]::WriteAllText(
    [IO.Path]::GetFullPath($OutputPath),
    $text.ToString(),
    [Text.UTF8Encoding]::new($false))

Write-Host ("Wrote {0:N0} characters to {1}" -f $text.Length, $OutputPath)
Write-Host ("Assemblies={0} Types={1} Methods={2} Properties={3} Errors={4}" -f `
    $assemblyRows.Count, $totalTypes, $totalMethodOverloads, $totalProperties, $loadErrors.Count)
