# @shenbian/pi

沈变项目的 project-local Pi package。Pi 从根目录 `.pi/settings.json` 加载它；不要把本包复制进 `pi/` 上游目录。

当前提供彼此解耦的产品界面、确定性机械取证与视觉能力：

- 沈变 Header、终端标题、状态和阶段 Widget；
- `shenbian` 主题；
- `/shenbian-status` 运行基线诊断；
- `/shenbian-ui` 在产品界面与 Pi 原生界面之间切换。
- `delegate_thcad_mechanical`：把确定性 01–21 取证交给 fresh 机械 child；
- fresh `thcad-mechanical` 子 Agent：只见 `thcad_session`、`thcad_analysis`、`thcad_project_graph`，可使用 .NET 01–21；
- `delegate_thcad_visual_overview`：用 capability 02 图框驱动 THCAD `PNGOUT`，把唯一一张整图交给同提供商的视觉 child 做宏观可读性判断；DeepSeek 父链用 DeepSeek Vision，xAI 父链用 Grok；
- `delegate_thcad_bom_close_reading`：一次高层调用内部组合 04/08/11/13/21，按共同指向的 BOM 序号段先串行冻结 THCAD 原生窗口 Plot、去干扰图和拓扑边车，再复用现有无工具视觉 child 最多 10 路并发交付事实包；父 Agent 只接收逐段完成清单、证据/结构化结果/覆盖账本和两图路径，不重复接收批量图片字节，需要复核时再按路径读图；局部拓扑、两图、视觉理解和父模型最终解释通过可重放 outbox 登记到 backend；跨图路由可传 `expected_document` 防止活动图错配；
- `thcad_app`：父 Agent 的图纸 status/list/open/activate/close/copy/save；客户原图强制只读，写入仅限本地 THCAD workspace；
- `thcad_project_texts`：side-DB 构建 SHA-256 增量文字/BOM 索引；失败重扫保留 last-good，status 发现新增/过期/缺失，search 单图损坏时返回 partial 而非拖垮整库；
- `/thcad-doctor`：只读检查 AgentBridge DLL、活动 THCAD 和当前图。
- 每次委派生成不可覆盖的本地 review bundle：child 原生 Session/raw events、视觉输入 CAS、父 Session 快照、证据正文和 SHA-256 artifact 清单；
- `/thcad-reviews`：列出最近 bundle；`/thcad-reviews verify <run-id>` 校验完整性。

机械子 Agent 的 COM 只负责唤醒 THCAD 命令，实体与拓扑读取由独立的进程内 .NET Host 执行；视觉概览按 02 图框临时出图，BOM 精读则用 `SetWindowToPlot` 直接绘制世界坐标窗口，不移动视口，两者都恢复并校验 DBMOD/布局现场。架构、构建和 TUI 测试见 `docs/dev/2026-08-29-Pi-THCAD-DotNet-机械子代理接入.md`、`docs/dev/2026-08-30-Pi-THCAD-视觉概览与晓量能力取舍.md` 与 `docs/dev/2026-08-30-Pi-THCAD-BOM构件视觉精读.md`。

## 边界

- 只 import `@earendil-works/pi-*` 的公开导出；
- Pi 核心包只放 `peerDependencies`，不得在本包安装第二份 runtime；
- 第三方运行时依赖才放 `dependencies`；
- 不在扩展加载阶段启动进程、连接 CAD 或访问网络；Bridge 与 fresh child 只在工具/命令被调用时按需运行；
- 机械分析与客户 DWG 仍只读；规格 013 只开放文档会话和工作区副本保存，任何 DWG 写入均被双层限制在 `.pi/runtime/thcad-workspace/`。
- 整图概览与 BOM 精读是两个独立函数；精读不以概览结果为前置，也不将视觉模型的数字置信度当作机械结论门槛。
- review 数据含客户图纸证据，只落在被 Git 忽略的 `.pi/runtime/`；不会自动上传或进入训练。
