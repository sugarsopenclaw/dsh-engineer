# Pi 接入 THCAD .NET 机械子代理

## 结论

这次不照搬晓量的“Agent → Python → COM 逐实体读取”。沈变已经有 01–20 的进程内 .NET 分析器，最合适的职责划分是：

```text
Pi 主 Agent
  └─ 固定委派工具
      └─ fresh Pi 机械子 Agent（独立上下文、窄工具）
          ├─ 查询 artifact（TypeScript，有界、离线）
          └─ 请求当前 THCAD 动作
              └─ PowerShell COM 控制面（只 NETLOAD / SendCommand）
                  └─ THCAD .NET Host（主线程读取当前 Database）
                      └─ 01–20 Adapter/Core
```

.NET 是数据与计算面，COM 只是唤醒面。这样既保留 THCAD 专业对象、事务、句柄和当前 Database 的权威性，又避免在 Python/Node 中重写一遍 01–20。

## 为什么不用常驻 HTTP/Named Pipe 线程直接读 CAD

THCAD/Teigha 的文档、Editor 和 Database 对线程与文档上下文敏感。后台 HTTP/Named Pipe handler 即使只监听本机，也不能安全地在任意线程直接遍历当前 Database。当前实现采用“一次作业文件 + 一次 CAD 命令”：请求先落到 `.pi/runtime/thcad-bridge/pending/`，COM 将 `SHBTHCADAGENT` 排入 THCAD 命令队列，.NET 命令在 CAD 主线程认领作业并原子写响应。

这比轮询 HTTP 少一个常驻服务，也让失败边界清楚：Pi 退出不会关闭 THCAD，THCAD 未运行或正忙时作业稳定失败，CAD API 不跨线程。

## 工具与能力

主 Agent 只看到：

- `delegate_thcad_mechanical({ task })`：把自包含的机械图纸取证任务交给子 Agent。

子 Agent 只看到：

- `thcad_session`：活动图状态、刷新 01–20、按句柄选择/缩放；
- `thcad_analysis`：列出 01–20、读取摘要、按 JSON path 或关键词做有界查询；
- `thcad_project_graph`：汇聚已抽取图的 20 项目图并查询。

01–20 与 artifact 的映射由 `plugins/shenbian-pi/runtime/thcad/capability-catalog.ts` 唯一登记。查询输出始终带 capability id、artifact ref、JSON path 和截断信息；模型不能把 `possible / ambiguous / unsupported_partial` 擅自改写成确定结论。

## 动作安全边界

- `status` 和 `refresh_analysis` 不改 DWG；分析结果写到被忽略的 `.pi/runtime/`。
- `locate_handles` 只改变当前选择集和可选视图，不保存、不关闭、不新增或删除实体。
- 工具不会启动、关闭或重启 THCAD，只附着已经运行的 `thcad.exe`。
- 任何未来写操作必须另开规格，加入工作副本、预览、用户批准、撤销与复验，不能塞进现有只读工具。

## 构建

```powershell
.\scripts\build-thcad-agent-bridge.ps1
.\scripts\verify-pi.ps1
```

Bridge 输出：

```text
.pi/runtime/thcad-bridge/deployments/<build-id>/Shb.Thcad.AgentBridge.dll
.pi/runtime/thcad-bridge/current-dll.txt
```

构建脚本每次写入新的版本化部署目录，并原子更新 current pointer，不覆盖 THCAD 已锁定的 DLL，因此开着 THCAD 也能继续编译和验证。它使用独立程序集名，可与已加载的 `Shb.Thcad.Extractor.dll` 共存。THCAD 首次请求时由控制面自动 `NETLOAD`；当前会话仍使用已经加载的程序集代次，代码升级后需要用户在方便时重启 THCAD 才切换到新代次，工具不会代替用户重启。

## Pi TUI 测试

1. 在 THCAD 打开要检查的图，等待命令行空闲。
2. 从仓库根运行 `.\start-pi.cmd`。
3. 可先输入 `/thcad-doctor` 验证 DLL、作业目录和活动 THCAD。
4. 对主 Agent 说：`让 THCAD 机械子代理检查当前图的尺寸链与器身中心线偏置，只报告确定性证据和限制。`
5. 主 Agent 应调用 `delegate_thcad_mechanical`；child 通常依次调用 `thcad_session status`、必要时 `refresh_analysis`、再查询 07/09/18。
6. 完成后主工具只向主上下文返回 `.pi/runtime/thcad-reviews/runs/<run-id>/evidence.md` 与 review ref，主 Agent读取 evidence 并形成最终回答；完整 raw 数据不注入主上下文。

定位动作示例：`让机械子代理找到尺寸 1710 对应证据，并在 THCAD 中定位相关句柄。` 只有任务明确要求“定位/显示”时 child 才应调用 `locate_handles`。

## 已知边界

- 首次全图刷新会完整运行 01–20，大图可能耗时；同一 child 应先查 status 和已有 artifact，避免无意义重复刷新。
- 当前作业队列由 Pi 侧串行化，适合单机单 THCAD；多 CAD 实例和跨项目公平队列留给后续产品化。
- 20 项目图只汇聚当前 Bridge artifact 根中已经抽取的 observation；没有提供目标图不等于企业文件缺失。
- evidence pack 是子代理证据，不是审图结论；最终业务判断仍由主 Agent结合规则侧完成。
- 每次委派保存 fresh child 原生 Session、JSON event stream、宿主工具轨迹、父 Session 快照和 01–20 内容寻址快照；详见 `docs/dev/2026-08-30-Pi-THCAD-运行留档与训练候选.md`。
