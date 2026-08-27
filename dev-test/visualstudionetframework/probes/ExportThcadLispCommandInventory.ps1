param(
    [string]$MechanicalRoot = "D:\THSOFT\THCAD V24_Mechanical2D",
    [string]$OutputPath = "D:\dev\dsh-engineer\docs\dev\2026-08-27-THCAD-V24-LISP与命令能力盘点.md"
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

$lispRows = @()
$definitionRows = @()
foreach ($file in Get-ChildItem -LiteralPath $MechanicalRoot -Recurse -File -Filter *.lsp |
    Sort-Object FullName) {
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $content = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
    $matches = [regex]::Matches(
        $content,
        '(?im)^\s*\(\s*defun(?:-q)?\s+([^\s()]+)')
    $fileDefinitions = @()
    foreach ($match in $matches) {
        $name = $match.Groups[1].Value
        $line = 1 + ([regex]::Matches($content.Substring(0, $match.Index), "`n")).Count
        $definition = [ordered]@{
            file = RelativeToRoot $file.FullName
            name = $name
            line = $line
            is_command = $name.StartsWith("C:", [StringComparison]::OrdinalIgnoreCase)
        }
        $definitionRows += $definition
        $fileDefinitions += $definition
    }
    $lispRows += [ordered]@{
        file = RelativeToRoot $file.FullName
        bytes = $file.Length
        definition_count = $fileDefinitions.Count
        command_count = @($fileDefinitions | Where-Object { $_.is_command }).Count
    }
}

$cuiRows = @()
$macroRows = @()
foreach ($file in Get-ChildItem -LiteralPath $MechanicalRoot -Recurse -File |
    Where-Object { $_.Extension -in ".cui", ".cuix" } |
    Sort-Object FullName) {
    $fileMacros = @()
    $parseError = $null
    try {
        [xml]$xml = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        foreach ($macro in @($xml.SelectNodes("//Macro"))) {
            $nameNode = $macro.SelectSingleNode("./Name")
            $commandNode = $macro.SelectSingleNode("./Command")
            if ($null -eq $commandNode) { continue }
            $name = if ($null -ne $nameNode) { [string]$nameNode.InnerText } else { "" }
            $command = [string]$commandNode.InnerText
            $tokens = @([regex]::Matches(
                $command,
                '(?i)\^c\^c_?([A-Za-z][A-Za-z0-9_.-]*)') |
                ForEach-Object { $_.Groups[1].Value.ToUpperInvariant() } |
                Sort-Object -Unique)
            $row = [ordered]@{
                file = RelativeToRoot $file.FullName
                name = $name
                command = $command
                command_tokens = $tokens
            }
            $macroRows += $row
            $fileMacros += $row
        }
    }
    catch {
        $parseError = $_.Exception.Message
    }
    $cuiRows += [ordered]@{
        file = RelativeToRoot $file.FullName
        bytes = $file.Length
        macro_count = $fileMacros.Count
        command_token_count = @($fileMacros.command_tokens | ForEach-Object { $_ } |
            Sort-Object -Unique).Count
        error = $parseError
    }
}

$probeDirectory = Split-Path -Parent $PSCommandPath
$runtime = $null
try {
    $probePath = Join-Path $probeDirectory "ProbeThcadLispRuntime.ps1"
    $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $runtimeJson = & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $probePath
    $runtime = $runtimeJson | ConvertFrom-Json
}
catch {
    $runtime = [pscustomobject]@{
        host = $null
        version = $null
        drawing = $null
        atoms = @()
        arx = @()
        vlx = @()
        variables = @()
        error = $_.Exception.Message
    }
}

$runtimeCommands = @($runtime.atoms |
    Where-Object { $_ -match '^C:' } |
    Sort-Object -Unique)
$sourceCommands = @($definitionRows |
    Where-Object { $_.is_command } |
    ForEach-Object { $_.name.ToUpperInvariant() } |
    Sort-Object -Unique)
$sourceFunctions = @($definitionRows |
    Where-Object { -not $_.is_command } |
    ForEach-Object { $_.name.ToUpperInvariant() } |
    Sort-Object -Unique)
$cuiCommandTokens = @($macroRows.command_tokens |
    ForEach-Object { $_ } |
    Sort-Object -Unique)

$text = [Text.StringBuilder]::new()
[void]$text.AppendLine("# THCAD V24 LISP 与命令能力盘点")
[void]$text.AppendLine()
[void]$text.AppendLine("> 生成日期：$(Get-Date -Format yyyy-MM-dd)  ")
[void]$text.AppendLine("> 实测安装：``$MechanicalRoot``  ")
[void]$text.AppendLine("> 生成器：``dev-test/visualstudionetframework/probes/ExportThcadLispCommandInventory.ps1``")
[void]$text.AppendLine()
[void]$text.AppendLine("## 0. 结论和口径")
[void]$text.AppendLine()
[void]$text.AppendLine("LISP/命令是独立能力面：LISP 能读写数据库、选择集、XData/字典、文件、COM/VLA 对象、对话框与 reactor，也能调用会修改图纸的命令；命令表还包含由 C++/BRX/ARX/.NET 动态注册、但不一定表现为 ``C:`` 函数的入口。")
[void]$text.AppendLine()
[void]$text.AppendLine("本机安装中找到 **$($lispRows.Count) 个 LSP 源文件、$($definitionRows.Count) 个源码 ``defun`` 定义（其中命令定义 $(@($definitionRows | Where-Object { $_.is_command }).Count) 个）**；找到 **$($cuiRows.Count) 个 CUI/CUIX 文件、$($macroRows.Count) 条菜单宏、$($cuiCommandTokens.Count) 个从 ``^C^C`` 宏中直接提取的命令 token**。")
[void]$text.AppendLine()
if ($runtime.host) {
    [void]$text.AppendLine("当前运行时附着 $(MdCode $runtime.host) / $(MdCode $runtime.version)，``atoms-family`` 返回 **$(@($runtime.atoms).Count) 个符号**，其中 **$($runtimeCommands.Count) 个 ``C:`` 命令函数**；``arx`` 返回 **$(@($runtime.arx).Count) 个已加载模块**。")
}
else {
    [void]$text.AppendLine("当前运行时探针未完成：$(MdCode $runtime.error)。安装文件静态盘点仍有效。")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 1. 为什么不能把这些数字叫「全部命令」")
[void]$text.AppendLine()
[void]$text.AppendLine("- ``atoms-family`` 能看到当前文档上下文已经装入的 LISP 符号，但看不到所有原生命令；")
[void]$text.AppendLine("- CUI 只覆盖出现在菜单/工具栏/功能区中的宏，隐藏命令和未加载模块不会出现；")
[void]$text.AppendLine("- LSP 源码只覆盖明文文件；FAS/VLX、ARX/BRX/.NET 动态注册命令需要另外的运行时或二进制证据；")
[void]$text.AppendLine("- 当前公开 .NET 有 ``Bricscad.Internal.Utils.IsCommandNameInUse`` 可验证一个已知名字，但没有公开的完整命令枚举器。")
[void]$text.AppendLine()
[void]$text.AppendLine("因此本篇是三路证据的并集，不伪装成不可证明的全量：**当前 LISP 符号 + 安装 LSP 源码 + CUI 宏**。原生模块另见原生接口盘点。")
[void]$text.AppendLine()
[void]$text.AppendLine("## 2. 已实测运行时")
[void]$text.AppendLine()
if ($runtime.host) {
    [void]$text.AppendLine("- 当前图：$(MdCode $runtime.drawing)；")
    [void]$text.AppendLine("- LISP 符号：$(@($runtime.atoms).Count)；``C:`` 命令函数：$($runtimeCommands.Count)；")
    [void]$text.AppendLine("- 已加载 ARX/BRX 模块：$(@($runtime.arx).Count)；已加载 VLX：$(@($runtime.vlx).Count)；")
    [void]$text.AppendLine("- 系统变量：$($runtime.variables -join '；')；")
    [void]$text.AppendLine("- 探针通过 COM ``SendCommand`` 执行 ``atoms-family`` / ``arx``，只写探针结果文件，不改图形实体。能力目录本身仍保留所有会写图的 LISP/命令入口。")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 3. LSP 文件清单")
[void]$text.AppendLine()
[void]$text.AppendLine("| 文件 | 字节 | defun | C: 命令 |")
[void]$text.AppendLine("| --- | ---: | ---: | ---: |")
foreach ($row in $lispRows) {
    [void]$text.AppendLine("| $(MdCode $row.file) | $($row.bytes) | $($row.definition_count) | $($row.command_count) |")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 4. CUI/CUIX 文件清单")
[void]$text.AppendLine()
[void]$text.AppendLine("| 文件 | 字节 | 宏 | 直接命令 token | 解析错误 |")
[void]$text.AppendLine("| --- | ---: | ---: | ---: | --- |")
foreach ($row in $cuiRows) {
    [void]$text.AppendLine("| $(MdCode $row.file) | $($row.bytes) | $($row.macro_count) | $($row.command_token_count) | $(MdCode $row.error) |")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 5. 当前运行时 C: 命令函数")
[void]$text.AppendLine()
foreach ($name in $runtimeCommands) {
    [void]$text.AppendLine("- $(MdCode $name)")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 6. 安装 LSP 源码定义")
[void]$text.AppendLine()
foreach ($group in $definitionRows | Group-Object { $_["file"] } | Sort-Object Name) {
    [void]$text.AppendLine("### $(MdCode $group.Name)")
    [void]$text.AppendLine()
    foreach ($row in $group.Group | Sort-Object { $_["line"] }) {
        $kind = if ($row.is_command) { "命令" } else { "函数" }
        [void]$text.AppendLine("- $kind $(MdCode $row.name)，第 $($row.line) 行")
    }
    [void]$text.AppendLine()
}
[void]$text.AppendLine("## 7. CUI 直接命令 token")
[void]$text.AppendLine()
foreach ($name in $cuiCommandTokens) {
    [void]$text.AppendLine("- $(MdCode $name)")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 8. CUI 宏完整索引")
[void]$text.AppendLine()
foreach ($group in $macroRows | Group-Object { $_["file"] } | Sort-Object Name) {
    [void]$text.AppendLine("### $(MdCode $group.Name)")
    [void]$text.AppendLine()
    foreach ($row in $group.Group | Sort-Object { $_["name"] }, { $_["command"] }) {
        [void]$text.AppendLine("- $(MdCode $row.name)：$(MdCode $row.command)")
    }
    [void]$text.AppendLine()
}
[void]$text.AppendLine("## 9. 当前已加载原生模块")
[void]$text.AppendLine()
foreach ($name in @($runtime.arx | Sort-Object -Unique)) {
    [void]$text.AppendLine("- $(MdCode $name)")
}
[void]$text.AppendLine()
[void]$text.AppendLine("## 10. 使用边界")
[void]$text.AppendLine()
[void]$text.AppendLine("LISP 很适合快速验证选择、句柄、字典、命令和 UI 工作流，也适合从外部 COM 触发；大规模实体遍历、精确几何和可测试核心算法仍可优先留在 .NET Adapter/Core。这个选择是性能与工程边界判断，不是能力阉割。")

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
[IO.File]::WriteAllText($OutputPath, $text.ToString(), [Text.UTF8Encoding]::new($false))
Write-Host "Wrote $OutputPath"
