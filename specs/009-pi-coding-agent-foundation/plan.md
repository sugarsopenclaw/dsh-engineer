# 009 — 实施计划

## 运行链

```text
仓库根 start-pi
  → 根 .env 注入当前 Pi 子进程
  → pi/ 官方 coding-agent CLI/TUI
  → .pi/settings.json
  → plugins/shenbian-pi
      ├─ extension：TUI、命令、工具、事件门禁
      ├─ theme：产品视觉
      └─ 后续 skill / prompt：沈变审图工作流与任务入口
  → 后续按需调用本地 THCAD 与 backend /api/v1
```

## 实现顺序

1. 将官方 Pi release 以只读 submodule 固定在 `pi/`。
2. 建立 project-local Pi package 和 `.pi/settings.json`。
3. 用一个小型 extension 完成 Header、状态、Widget 与 `/shenbian-status`，证明 TUI seam 可用。
4. 增加 bootstrap、start、verify、update 四条 Windows 工作流。
5. 构建上游，执行 CLI/package smoke test，再以真实 PTY 启动 TUI 验证扩展。
6. 更新根 README、AGENTS 和平台分层规格，把新增能力落点从 DSH plugin 改为 Pi package。

## 上游同步策略

常规升级只移动 submodule gitlink：

1. 明确选择一个 Pi release tag，不自动追 `main`。
2. 阅读该版本 changelog，重点检查 extension、TUI、session、provider 和 package loader 的 breaking changes。
3. 在 `pi/` checkout 目标 tag，保持 submodule 内零本地提交、零工作树修改。
4. 重新执行 bootstrap 与 verify，并人工启动一次 TUI。
5. 若扩展不兼容，只修改 `plugins/shenbian-pi/`；验证失败则把 gitlink 留在旧版本。
6. 通过后把 gitlink、兼容改动和验证记录放在同一 review 中。

只有公开扩展面确实无法表达产品需求时，才新增一份 ADR，说明缺口、候选上游 API 与退出条件。优先向上游贡献通用 seam；不得直接在 submodule 里积累产品代码。若必须短期 fork，差异保持为可重放的小提交，并持续以官方 release 为合并基线。
