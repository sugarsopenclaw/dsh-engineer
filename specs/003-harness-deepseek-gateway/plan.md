# 003 — 实施计划

> **已退役（2026-09-03）。** 对应实现已删除，下文仅作历史记录。

## 调用链

```text
DSH Web / headless
  → 官方 llm-deepseek adapter
  → FastAPI /api/v1/llm/deepseek/chat/completions
  → DeepSeek upstream

DSH web_search
  → 官方 web-search-deepseek provider
  → FastAPI /api/v1/llm/deepseek/anthropic/v1/messages
  → DeepSeek Anthropic-compatible upstream
```

FastAPI 只处理传输边界：认证选择、请求大小限制、上游连接、响应头和字节流转发。它不理解或改写 Agent 会话。

## 实现

1. 在 FastAPI 增加可替换的 `DeepSeekModelGateway` 端口和 httpx2 实现。
2. 连接上游成功后立即返回 `StreamingResponse`，客户端断开时关闭上游响应。
3. 保留 DSH 诊断所需头信息，并使用 DeepSeek 兼容错误 envelope 表达网关自身错误。
4. 通过启动脚本向 DSH 子进程注入本地 `DEEPSEEK_BASE_URL`；API Key 仍由 DSH 官方 credential seam 解析。
5. 后续沈变插件继续通过公开 seam 接入，FastAPI CRUD 与 THCAD 工具围绕实际业务任务逐个增加。
