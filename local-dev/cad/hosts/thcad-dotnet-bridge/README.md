# THCAD .NET Agent Bridge

这是 Pi 与 THCAD V24 之间的进程内 Host，不是新的业务算法实现。

- 独立程序集 `Shb.Thcad.AgentBridge.V4.dll`（0.4.0.0），可与实验 DLL 和旧 Bridge 共存；
- 用 linked files 编译 01 Adapter 与 02–21 Core，源码仍只有一份；
- `SHBTHCADAGENTV4`（Modal）处理当前图分析和 side-DB 文字扫描；
- `SHBTHCADAGENTV4APP`（Session）处理打开、激活、关闭和工作区保存；
- 每次命令只按显式 `request_id` 认领一份 pending，并复核 Modal/Session operation 上下文，避免失败请求被后来命令重放；
- 客户图由桥新打开时强制只读；已由用户可写打开的同图会报告冲突，C# 桥最终拒绝任何落到 `.pi/runtime/thcad-workspace/` 之外的 DWG 写入；
- 不启动监听端口，不跨线程访问 CAD。
- 构建脚本部署到被忽略的版本化 runtime 目录，避免覆盖 THCAD 已加载并锁定的 DLL。

构建和协议说明见 `docs/dev/2026-08-29-Pi-THCAD-DotNet-机械子代理接入.md` 与 `docs/dev/2026-08-30-Pi-THCAD-图纸会话与项目文字检索.md`。
