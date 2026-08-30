# 007 — 实施计划

## 阶段 0：宿主确认与工作区

- 运行 `PrepareAutoCad2024CapabilityWorkspace.ps1` 创建五个隔离输出目录；
- 从当前 `acad.exe`、文件版本、注册表和运行时对象确认 AutoCAD 2024；
- 冻结安装根、产品版本、位数、当前文档和已加载模块范围。
- 记录现有五个 `thcad-v24` 原始库存 manifest 与 atoms 文件哈希，作为结束时的只读保护基线。

## 阶段 1：COM

- 发现 AutoCAD 2024 注册的类型库、ProgID 和当前运行实例；
- 复用公共 COM 扫描内核，新增 AutoCAD 专用导出入口；
- 导出、复跑、校验 `autocad-2024.com`；
- 使用无宿主专属证据的规则补齐操作分类。

## 阶段 2：.NET

- 从实际安装和已加载模块确定 AutoCAD 2024 公开托管 API 程序集范围；
- 复用公共 .NET 扫描内核逐重载导出；
- 导出、复跑、校验 `autocad-2024.dotnet`；
- 补齐操作分类，禁止继承 THCAD 专属 runtime evidence。

## 阶段 3：LISP、Command 与 CUI

- 新建只附着 `acad.exe`/AutoCAD COM 实例的运行时探针；
- 分开保存 LISP、命令和 CUI/CUIX 宏证据；
- 导出、复跑并分别校验 `autocad-2024.lisp` 与 `autocad-2024.command`；
- 补齐两个库存的操作分类。

## 阶段 4：Native

- 只扫描已确认的 AutoCAD 2024 产品目录和已加载产品模块；
- PE 导出保持未知签名，不生成 P/Invoke；
- 导出、复跑、校验 `autocad-2024.native`。

## 阶段 5：总验收

- 对五个库存运行 schema、计数、稳定 ID、哈希和完整归账校验；
- 执行新增与现有能力管线测试，确认未改坏 THCAD；
- 更新 `tasks.md` 并写一份实测结果报告；
- 停止，不做关系、对比、数据库、API 或前端。
