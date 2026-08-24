# CAD Runtime

`runtime/cad/` 是 AutoCAD 能力在 Electron 主进程中的唯一运行时入口。

边界约束：

- `drivers/autocad-com/` 只负责 Python worker 与 AutoCAD COM 通信。
- `service/cad-runtime-service-impl.ts` 是唯一稳定 TS 服务面。
- `agent/tools/domain/cad/`、未来的 `agent/mcp/local-cad/`、以及任何 IPC 扩展，都只能依赖 `CadRuntimeService`。
- 严禁任何上层直接调用 Python worker 协议、直接访问 COM 对象、或在 agent/mcp 层重写一套独立的 CAD 连接逻辑。
- `capture` 只产出 CAD 窗口提示和截图组合逻辑，不持有 UI 状态。
- `drivers/autocad-http/` 是 P2 旁路实现：descriptor、鉴权、STA worker、
  client/launcher、COM extract、frame/quadrant/detail capture 和受限 facade 已落地，
  但 feature flag 默认仍为 `stdio`；在 runtime adapter、安装包与 AutoCAD 2024
  冒烟完成前不得替换旧 worker。
- `mlight/` 是 P3-A 的 child-only 快速实体抽取运行时：项目源文件只经一次性
  loopback capability 提供给隐藏 sandbox renderer，每次请求后销毁 renderer；
  输出只能先写 `.xiaoliang/cad/.staging/<run>/entities`，经 artifact-store 校验与
  promotion 后才能成为 valid。MLightCAD 失败时由 cadsubagent 工具自动降级 HTTP/COM。
