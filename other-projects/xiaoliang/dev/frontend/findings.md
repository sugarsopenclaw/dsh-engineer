# Findings

- 当前知识问答模式的工具收敛点在 `electron/runtime/agent/policy/tool-visibility.ts`，此前它只看全局 metadata `visibility=model`，没有利用 `conversationMode` 做模式级裁剪。
- `createAgentTools` 已经能拿到 `conversationMode`，但旧逻辑没有把这个信息传进过滤层，因此问答模式会直接继承整套默认可见 CAD 工具。
- `agent-session-manager.ts` 生成的 readable v2 明确包含 `Component Type Totals`、`Component Identifier Frequency`、`Layer Counts`、`Text Frequency (selected)`、`Entity Samples`，而 `cad_drawing_rag` 正是基于这份 file_id 文档做按问问答。
- 2026-08-09: 专用后端工程知识库链路已退役；主 Agent 不再注册对应工具，外部工程依据改由联网工具检索，项目内依据仍由项目资料与 CAD 证据链提供。
- 默认新会话固定落在默认图纸“通用图纸”上；手动“读取实体”时 renderer 直接用当前会话 `drawingId` 调 `readCadDrawing`。
- 会话真正切到活动 CAD 图纸不是在读取实体时，而是在 `sendPrompt` 前调用 `tryBindConversationToActiveDrawing`，它会按活动图纸名 `ensureDrawingInProject` 新建或复用一条 drawing 记录，再更新 `conversation.drawing_id`。
- `cad_drawing_artifacts` 和本地 raw/readable 文件都严格按 `drawing_id` 存，没有从旧 default drawingId 迁移到新真实 drawingId 的逻辑，因此会出现“第一次读取实体成功，但进入真实图纸后看起来丢失”的断裂体验。
- 当前更新提示组件 `UpdateBanner` 直接挂在 `App` 顶部，`shouldShowUpdateBanner` 对所有非 `idle` 阶段都返回 true，所以检查/下载/完成/报错都会顶在最上面。
- 版本号单一来源是 `dev/frontend/package.json`；`package-lock.json` 需要同步更新，而 `src/shared/skill-pack-metadata.ts` 会在构建时自动按新版本重写。
- 本轮将更新提示改为组件本地维护的可关闭浮窗：同一轮 `available/downloading` 会共用一个关闭 key，用户关闭后下载进度不再反复打扰，但 `downloaded` / `error` 进入新阶段后仍会再次提示。
- `electron:publish` 的唯一实际阻塞是环境变量 `GH_TOKEN` 缺失；安装包构建、release 根目录产物和 `release/public` 公开分发目录都已成功产出。
- backend 的客户端下载接口实际读取 `dev/backend/release-manifests/latest.json` 与 `dev/backend/storage/client-releases/`；当前代码库里这两处仍停在 0.7.1，需要与桌面端 0.7.4 一起同步。
- Electron 当前实际产出的手动安装包文件名仍是 `晓量-Setup-<version>.exe`，用它同步 backend 下载目录比沿用旧 manifest 里的 ASCII 文件名更稳妥，也与 backend 现有测试夹具一致。
- `electron:publish` 上传到 GitHub Release 时使用的是 updater 产物名 `xiaoliang-setup-<version>.exe` / `.blockmap`，而本地手动安装包与 `release/public` 仍保留 `晓量-Setup-<version>.exe`；两者职责不同，发布时需要同时接受这组命名差异。
- 2026-06-06: 本轮用户明确只发布 frontend Electron，因此仅同步 `dev/frontend/package.json` / `package-lock.json` 与构建产物，没有动 backend 发布清单或下载目录。
- 2026-06-06: 本机旧会话转录里缓存的 GitHub token 可能已失效；若 `electron:publish` 返回 `401 Bad credentials`，可优先尝试通过 Git Credential Manager 读取 `github.com` 凭据，再作为 `GH_TOKEN` 继续发布。
