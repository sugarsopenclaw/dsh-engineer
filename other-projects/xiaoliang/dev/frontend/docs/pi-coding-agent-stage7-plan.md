# Pi Coding Agent 阶段 7：七个编程工具接入规划

状态：已实施。七个工具经 `createAgentTools()` 显式注册（`pi_coding_tools` 默认 `true`，绑定项目的主会话生效，`cwd` 为项目根目录；Windows 无 Git Bash 时 `bash` 降级不注册）。同期 `project_list`/`project_search` 已删除，`project_read` 收窄为富文档解析工具 `doc_parse`；打包时预置 `rg.exe`/`fd.exe` 并在启动时落到 Pi 托管 bin 目录。以下为原规划内容。

## 1. 阶段结论

阶段 7 的核心工作不是重新实现一套编程工具或安全沙箱，而是把 Pi Coding Agent 已经提供的七个工具接入晓量现有的 `XiaoliangPiAgentHost`：

```text
read / grep / find / ls / edit / write / bash
```

当前晓量创建 Pi Session 时使用了 `noTools: 'builtin'`，因此明确关闭了这些内置工具；`pi_coding_tools` 也只有开关定义，尚未参与 Host 的工具注册。也就是说，SDK 和工具实现已经存在，缺少的是晓量侧的注册、启用和产品入口。

## 2. Pi 已经提供的能力

应优先复用 Pi 0.84.1 的现有实现，不重复开发：

- 七个工具的参数 Schema、执行逻辑和工具结果。
- `grep`、`find` 的 `.gitignore` 支持与结果数量限制。
- `read`、搜索结果和命令输出的截断。
- `edit` 的精确文本替换、diff 和 unified patch。
- `edit`、`write` 的同文件修改队列。
- `bash` 的流式输出、超时、AbortSignal 和超长输出临时文件。
- 工具调用、工具结果、session 事件与现有 Agent 循环的结合。

Pi 暴露了以下工厂：

- `createCodingTools()`：`read / bash / edit / write`
- `createReadOnlyTools()`：`read / grep / find / ls`
- `createAllTools()`：完整七个工具

阶段 7 需要完整七个工具时，应直接使用完整工具集合，避免重复注册 `read`。

## 3. 阶段 7 核心实现范围

1. 为工具确定工作目录 `cwd`，优先使用当前会话绑定的项目根目录。
2. 在 `XiaoliangPiAgentHost` 中创建七个 Pi 工具，并与晓量现有业务工具合并注册。
3. 让 `pi_coding_tools` 真正控制七个工具是否注册和激活。
4. 接入现有 `setActiveTools()`、resource reload 和 session 重建流程，避免切换或恢复会话后工具丢失。
5. 复用现有 `beforeToolCall`、Agent 事件映射、`abort()`、`waitForIdle()` 和 `agent_settled`。
6. 验证工具调用与结果能够正常进入 Pi JSONL，并正确投影到现有 UI。
7. 为七个工具补齐集成测试和原有 CAD/项目工具回归测试。

## 4. 产品接入位置

这部分是阶段 7 唯一需要明确的产品选择，不是 Pi SDK 的缺失能力。

第一版可以保持简单：

- 有有效项目根目录的 Pi 主会话，在 `pi_coding_tools` 开启时获得七个工具。
- 没有项目根目录的会话不注册文件和命令工具。
- 暂不为了工具接入预先建设三套 Agent Profile。
- 如果以后需要独立 Coding 模式或只读资料 Agent，再调整 active tools 策略，不影响七个工具本身的接入。

## 5. 可选的产品护栏

Pi 的七个工具是本地执行能力，不是安全沙箱。Pi 默认不会提供以下晓量产品策略：

- 强制限制只能访问项目根目录。
- 保护 `.env`、密钥、证书等敏感文件。
- `edit / write / bash` 执行前的桌面确认。
- Bash 环境变量清洗或操作系统级进程隔离。

这些能力可以复用晓量现有 `beforeToolCall` 审批链路逐步增加，但不作为“七个 Pi 工具已经接入”的前置定义。第一版可先遵循 Pi 原生行为，再根据真实使用情况增加产品护栏。

## 6. 已实现 Pi 能力的默认开关

阶段 0–6 已经完成的能力应进入正常产品路径：

- `pi_runtime_v2`：默认开启。
- `pi_session_jsonl`：默认开启。
- `pi_branching`：默认开启。
- `pi_extensions`：默认开启，但仍只加载阶段 6 定义的受控资源。
- `pi_coding_tools`：阶段 7 已完成，默认开启（`XIAOLIANG_PI_CODING_TOOLS=off` 回退）。

对应环境变量继续保留为故障回退开关。未配置时采用产品默认值，显式设置为 `0`、`false` 或 `off` 时关闭对应能力。

## 7. 实施顺序

1. 确认项目会话的 `cwd` 来源。
2. 注册 `read / grep / find / ls` 并验证读取和搜索。
3. 注册 `edit / write` 并验证 diff、写入和文件队列。
4. 注册 `bash` 并验证输出、超时和停止。
5. 接入 feature flag、active tools、session 恢复和 UI 投影。
6. 完成测试后让 `pi_coding_tools` 默认开启。
7. 需要时再增量加入确认卡、路径规则或独立 Coding 模式。

## 8. 核心验收标准

- 阶段 0–6 的 Pi 能力无需手工设置环境变量即可使用，同时仍可通过环境变量显式关闭。
- `pi_coding_tools` 开启后，项目会话可以看到并调用完整七个工具。
- 工具的 `cwd` 与当前项目一致。
- open、resume、Tree navigate、fork、clone 和 resource reload 后工具集合一致。
- 工具调用、流式更新、结果、错误和中止能够正常显示并持久化。
- Pi 已有的 diff、截断、文件修改队列、timeout 和 abort 行为得到保留。
- 现有 CAD 工具、项目工具、计费、compaction、Tree 和受控 resources 无回归。

## 9. 非核心增强项

以下内容可以后续实施，不阻塞七个工具的第一版接入：

- 多档 Agent Profile。
- 路径 allowlist 和受保护文件规则。
- 写入及 Bash 的逐次用户确认。
- Git checkpoint 和自动恢复点。
- 容器、受限账户或操作系统级沙箱。
