# AutoCAD HTTP bridge

这是晓量 CAD 子代理的生产连接地基，来源基线为 pi-engineering 的
engineering/cad-bridge 与 engineering/pi-cad/src/bridge，参考提交：
9bddd7f1f75f7dd427b6cabe5fb1cbd04ad398ff。上游仓库使用 MIT License；
本目录保留了来源说明，并按晓量的项目根、artifact 命名和只读能力边界改造。

当前已完成：

- loopback HTTP、随机 bearer token、原子 descriptor、全局单实例锁；
- 单一 STA worker、32 槽 FIFO、queue/response deadline 和 3×500ms COM busy retry；
- /healthz、/v1/status、/v1/capabilities、/v1/execute；
- 严格 project-root 绑定、稳定错误 envelope、TypeScript client/launcher；
- Electron 主进程唯一 runtime：跨子任务复用同一 bridge，项目切换时强制串行；
- 15 秒 watchdog、连续两次失败判定、1/5/30 秒恢复退避、10 分钟 6 次熔断；
- 安全的 bridge-only 人工重启；不会关闭或重启 AutoCAD，也不会关闭图纸；
- `app.doctor` 同时检查完整版/LT/COM 注册、真实 AutoCAD 状态、活动项目图纸、
  Pillow/pdfium/pywin32 和 PDF/PNG PC3 配置，UI 的“就绪”不再由 feature flag 冒充；
- 第一批只读/连接类 app.status/app.start/doc.list/doc.open/doc.switch/extract.read；
- CadApplicationFacade 只暴露固定方法，不提供任意 operation 透传。

P2-B 已新增：

- `extract.run`：按 document/window/layer/type/text 过滤抽取，原子写入项目内
  `.xiaoliang/cad` 的 raw JSONL 与 readable Markdown；
- `capture.detect_frames`：从闭合矩形、图框 block/layer 与 drawing extents
  生成稳定 `frame-XX`，并回传 drawing extents 供调用方做图框 sanity 校验与回退；
- `capture.plot`：支持 full、`q1..q4` 和最多二层的 `qN/qN`，单图限制
  4096×4096/16777216 pixels，并做空图与 ink-ratio 门禁；
- `capture.detail`：合并 1–8 个 handle bbox/显式 window、padding，并把窗口
  约束到最大 4:1；
- `CadApplicationFacade.captureVisualSet`：固定顺序生成 full + 四象限，并只为
  指定的一级象限生成第二层四图，总数严格为 5–21；
- `CadApplicationFacade.captureVisualZooms`：视觉模型完成第一轮 `needs_zoom`
  判定后，只补生成对应二级象限，不重复 plot 已存在的基础 5 图；
- plot 使用静默 PDF 优先、PNG fallback，并在操作结束恢复活动文档、layout、
  `TILEMODE`、`BACKGROUNDPLOT`、view 与 `DBMOD`。

当前边界：知识问答/设计任务的 CAD 自动化只经 CAD 子代理进入本 HTTP runtime；
主代理没有直接 CAD 工具，旧手动 IPC fail-closed。`bridge-mode.ts` 仅为尚未删除的
旧 stdio 迁移兼容代码，不是当前子代理的运行时选择器。

发布门禁仍必须包含：冻结 exe 存在性校验、上述 Python/Node 自动化测试，以及一台
受支持完整版 AutoCAD 上的 start/open/switch/plot 冒烟。自动化测试不能替代真机
COM 与 PC3 验证。
