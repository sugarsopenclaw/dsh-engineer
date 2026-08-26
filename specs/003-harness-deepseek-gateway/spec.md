# 003 — Harness 经 FastAPI 访问 DeepSeek

## 背景

沈变产品的核心运行时是本地 DeepSeek Harness Agent。Agent 围绕当前 DWG 调用 THCAD 完成生产用 DXF 图纸净化，并在后续完成铁芯叠片一致性校验。FastAPI 为 Agent 提供可函数调用的共享接口，不替代本地 Agent/CAD 主循环。

本规格建立第一条最小纵向切片：保持 Harness 官方 DeepSeek 适配器不变，使其模型请求经过本仓库 FastAPI，再流式转发到 DeepSeek 上游。

## 需求

- 提供 `POST /api/v1/llm/deepseek/chat/completions`。
- 提供 `POST /api/v1/llm/deepseek/anthropic/v1/messages`，承接 Harness DeepSeek Web Search。
- 请求体保持 DeepSeek chat-completions 原始格式，不解析或改写 messages、tools、thinking、reasoning_effort 与图像内容。
- 允许 DSH 视觉模型请求携带 Base64 data URL 或外部 URL，并按 DeepSeek 官方 48 MiB 请求体上限放行。
- 保留 SSE 流式响应、HTTP 状态、请求 ID和 `Retry-After`。
- 保留 Harness 的 session、user 和 compact 请求头。
- 默认可透传 Harness 已有 Bearer Key；配置服务端上游 Key 后支持网关 Key 与上游 Key 分离。
- 不在日志、错误响应或测试输出中暴露任何 Key、提示词、工具参数或模型正文。
- 通过进程级 `DEEPSEEK_BASE_URL` 接入，不修改 `harness/`，也不覆盖官方 patch row。

## 非目标

- 不建立图纸上传、抽取包入库或服务端图元对象化流程；
- 不实现 DWG 净化工具、THCAD Bridge、知识 CRUD 和铁芯算法；
- 不改变 Harness 的模型序列化、Session Log、工具循环和重试策略。

## 验收

1. FastAPI 自动化测试验证文本与视觉请求、认证、错误和 SSE 透传。
2. `scripts/start-harness-via-backend.ps1` 能在不改上游的情况下启动 Web 或 headless profile。
3. 使用现有 DSH DeepSeek 凭据执行一次 headless 请求，FastAPI 访问日志显示模型请求经过本地端点。
4. 停止 FastAPI 后，通过该启动脚本运行的 Harness 明确失败，不会静默绕过网关直连上游。
