# THCAD .NET Agent Bridge

这是 Pi 机械子代理与 THCAD V24 之间的进程内 Host，不是新的算法实现。

- 独立程序集 `Shb.Thcad.AgentBridge.dll`，可与实验用 `Shb.Thcad.Extractor.dll` 共存；
- 用 linked files 编译 01 Adapter 与 02–20 Core，源码仍只有一份；
- `SHBTHCADAGENT` 只在 THCAD 命令线程读取 pending job；
- 支持 `status`、`extract_current`、`locate_handles`；
- 不启动监听端口，不跨线程访问 CAD，不保存或修改 DWG。
- 构建脚本部署到被忽略的版本化 runtime 目录，避免覆盖 THCAD 已加载并锁定的 DLL。

构建和协议说明见 `docs/dev/2026-08-29-Pi-THCAD-DotNet-机械子代理接入.md`。
