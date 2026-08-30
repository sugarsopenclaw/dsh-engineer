# AutoCAD 2024 CapabilityAtom 采集工作区

这里放 AutoCAD 2024 专用的运行时探针和导出薄入口。公共 atomizer、schema、稳定 ID 和校验逻辑继续复用 `data/pipelines/cad_capabilities/`，不要在本目录复制一套 Python 管线。

## 开始

1. 确认 AutoCAD 2024 已启动并进入任意空图或普通图纸；
2. 运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File dev-test/visualstudionetframework/probes/autocad-2024/PrepareAutoCad2024CapabilityWorkspace.ps1
   ```

3. 完整阅读 `specs/007-autocad-2024-capability-catalog/`；
4. 从当前 `acad.exe` 和注册表解析实际安装信息，再编写和运行采集入口。

## 固定输出

```text
data/datasets/staging/cad-capabilities/
  autocad-2024.com/
  autocad-2024.dotnet/
  autocad-2024.lisp/
  autocad-2024.command/
  autocad-2024.native/
```

这些数据目录被 Git 忽略。任何 AutoCAD 脚本都必须显式使用 `autocad-2024.*` inventory ID 和 `observed_host_id=autocad-2024`，并拒绝把输出指向 `thcad-v24.*`。

## 建议入口名称

```text
ProbeAutoCad2024Runtime.ps1
ExportAutoCad2024ComCapabilityAtoms.ps1
ExportAutoCad2024DotNetCapabilityAtoms.ps1
ExportAutoCad2024LispCommandCapabilityAtoms.ps1
ExportAutoCad2024NativeCapabilityAtoms.ps1
```

可以复用上一级的 `ComCapabilityScan.cs`、`DotNetCapabilityScan.cs`、`NativeCapabilityScan.cs` 和 `PeExportReader.cs`。若需要把宿主硬编码抽成参数，必须保留现有 THCAD 调用的兼容性并补测试。

## 边界

- 写入、编辑、删除等入口照常登记；本轮不在用户当前 DWG 上逐个调用；
- 不从 Markdown 生成原子；
- 不使用 THCAD runtime evidence；
- 不生成 SemanticCapability、IMPLEMENTS、LOGIC_USES_CAPABILITY 或 GraphView；
- 不导入 PostgreSQL；
- 完成后先交给人工比较数量、样本和来源范围。
