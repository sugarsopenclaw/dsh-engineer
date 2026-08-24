# AGENTS.md

本仓库是 DeepSeek Harness 的下游二次开发，按官方推荐方式：**不改上游源码，能力都做成独立插件**。

`harness/AGENTS.md` 是上游给官方仓库贡献者看的，不适用于本仓库。改能力时只看本文件。

## 目录

| 路径 | 写什么 |
| --- | --- |
| `client-data/` | 客户原文 drop（只收不改，不进 git） |
| `data/` | Data Layer：登记、管线、派生数据集 |
| `ontology/` | 对象 / 属性 / 链接 / 动作的类型定义 |
| `plugins/` | 我们的插件（`dsh.bundle`） |
| `patches/` | 本地 `--patch` 叠加层 |
| `harness/` | 上游 submodule，只读 |
| `specs/` | SDD：先规格后实现 |
| `docs/` | 本仓库文档（调研、开发笔记等）；规格仍写 `specs/` |
| `other-projects/` | 对本工程有帮助的参考项目（自己的或别人的），只参考 |
| `dev-test/` | 本机实验 / PoC（如 AutoCAD 抽取器）。不是产品层，不进 `plugins/` / `data/pipelines/` |

分层边界见 `specs/001-platform-layers/`。不要在 `client-data/` 写派生文件（含 CAD `.bak`、抽取 JSON）；不要把数据集或对象实例放进 `plugins/`。`dev-test/` 的编译产物和抽取输出不进 git。

## 硬性约定

- 不要修改、提交 `harness/` 里的任何文件。需要改行为就在 `plugins/` 写插件，用 `patches/` 挂进去。
- 不要给 `deepseek-ai/deepseek-harness` 提 PR。上游目前不收外部 PR。
- 开发时从 `harness/` 跑源码：`pnpm dsh web --patch <绝对路径的 overlay>`。插件 `name` 也要用绝对路径。
- 升级上游用 submodule 钉 commit，先构建并确认插件仍可用，再提交 `harness` 指针。

## 跟上游一起长

上游是开发者预览，**没有插件 ABI / 磁盘格式承诺**（rc 之间会话存储都可能不兼容）。社区已经踩过：内核一升，再装一份 `@deepseek-ai/dsh-tools`、或按 row id 覆盖官方配置的插件会挂——轻则工具调度 Symbol 对不上整轮炸，重则一个 bundle 失败拖死整个 profile。

我们靠这几条把兼容税压住，跟官方 seam 一起长，不跟内核抢实现：

- 只走公开 seam：`ctx.*` 服务、文档里的事件、`defineTool` / `register`。禁止 import `@deepseek-ai/dsh-*` 内部文件；这些包一律 peer，版本对齐当前 `harness/`，插件里不得再装一份。
- `patches/` 只追加我们自己的 loader 行。不要按 row id 覆盖官方配置——DSH patch 是整块替换，不是深合并。
- 插件 `apply` 失败会让整个 profile 起不来。加载期不要抛；不要依赖 session / SQLite 的磁盘布局。
- 升 `harness/` 只动 submodule 指针：先 build，再把 `plugins/` 挂上去跑通。坏了修插件，不要改 `harness/` 源码迁就。

日常命令见 `README.md`。
