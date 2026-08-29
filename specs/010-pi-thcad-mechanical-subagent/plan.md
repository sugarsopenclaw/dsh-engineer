# 实现计划

1. 用独立 .NET Framework x64 插件承载 THCAD 主线程命令，linked compile 既有 Adapter/Core 01–20。
2. 用项目私有 pending/running/responses 作业目录定义一请求一响应协议；PowerShell 仅做 THCAD COM 控制面。
3. 在沈变 Pi package 内实现 artifact catalog、有界查询、Bridge client 与三项 child-only 工具。
4. 主 extension 注册固定 `delegate_thcad_mechanical`，通过官方非交互 Pi CLI 启动隔离 child 并发布 evidence pack。
5. 增加构建、doctor、fixture、类型检查和 TUI 手工验收说明。
