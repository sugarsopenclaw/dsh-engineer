# AGENTS.md

本仓库是 DeepSeek Harness 的下游二次开发，按官方推荐方式：**不改上游源码，能力都做成独立插件**。

`harness/AGENTS.md` 是上游给官方仓库贡献者看的，不适用于本仓库。改能力时只看本文件。

## 目录

| 路径 | 写什么 |
| --- | --- |
| `plugins/` | 我们的插件（`dsh.bundle`） |
| `patches/` | 本地 `--patch` 叠加层 |
| `harness/` | 上游 submodule，只读 |

## 硬性约定

- 不要修改、提交 `harness/` 里的任何文件。需要改行为就在 `plugins/` 写插件，用 `patches/` 挂进去。
- 不要给 `deepseek-ai/deepseek-harness` 提 PR。上游目前不收外部 PR。
- 开发时从 `harness/` 跑源码：`pnpm dsh web --patch <绝对路径的 overlay>`。插件 `name` 也要用绝对路径。
- 升级上游用 submodule 钉 commit，先构建并确认插件仍可用，再提交 `harness` 指针。

日常命令见 `README.md`。
