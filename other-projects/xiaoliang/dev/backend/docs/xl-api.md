# 晓量后端接口简版文档

Base URL:

```text
https://xl.x3yun.com/api
```

服务版本：`0.7.4`

## 通用约定

成功响应：

```json
{
  "success": true,
  "data": {}
}
```

失败响应：

```json
{
  "success": false,
  "error": "错误消息",
  "message": "错误代码"
}
```

需要登录的接口请携带：

```http
Authorization: Bearer <access_token>
```

## 基础接口

### 健康检查

```http
GET https://xl.x3yun.com/api/health
```

返回：

```json
{
  "ok": true
}
```

## 鉴权接口

### 注册并创建机构

```http
POST https://xl.x3yun.com/api/auth/register
Content-Type: application/json
```

请求示例：

```json
{
  "organization_name": "示例机构",
  "email": "owner@example.com",
  "password": "password123",
  "display_name": "负责人"
}
```

### 密码登录

```http
POST https://xl.x3yun.com/api/auth/login
Content-Type: application/json
```

请求示例：

```json
{
  "email": "owner@example.com",
  "password": "password123"
}
```

### 发送邮箱验证码

```http
POST https://xl.x3yun.com/api/auth/email-otp/send
Content-Type: application/json
```

请求示例：

```json
{
  "email": "owner@example.com"
}
```

### 邮箱验证码登录

```http
POST https://xl.x3yun.com/api/auth/email-otp/login
Content-Type: application/json
```

请求示例：

```json
{
  "email": "owner@example.com",
  "code": "123456"
}
```

### 刷新 Token

```http
POST https://xl.x3yun.com/api/auth/refresh
Content-Type: application/json
```

### 退出登录

```http
POST https://xl.x3yun.com/api/auth/logout
Authorization: Bearer <access_token>
```

### 当前用户

```http
GET https://xl.x3yun.com/api/users/me
Authorization: Bearer <access_token>
```

## 个人提示词模板

以下接口均需要 Bearer token，数据按组织和用户双重隔离。数据库负责鉴权与列表查询，完整模板 JSON 同步写入账号隔离的私有 OSS 对象。

- `GET /users/me/prompt-templates`：按更新时间倒序列出当前用户模板。
- `POST /users/me/prompt-templates`：创建模板。
- `PUT /users/me/prompt-templates/{template_id}`：完整更新模板。
- `DELETE /users/me/prompt-templates/{template_id}`：删除模板及对应 OSS 对象。

创建和更新请求字段为 `title`、可选 `description` 与 `content`；同一用户的模板名称不区分大小写且不可重复，每位用户最多保存 100 个模板。

## Skill 接口

- `GET https://xl.x3yun.com/api/skills/releases/check`
- `GET https://xl.x3yun.com/api/skills/releases/pack`

两个接口都要求登录态 Bearer token。Skill API 是后端向桌面客户端的只读市场分发通道，不再提供投稿、审核、社区检索或详情接口。发布包携带 Ed25519 签名，桌面客户端校验签名后才允许写入本机 managed skills 目录。

用户自制 skill 仍由桌面客户端本地创建和编辑，同时走账号级后台归档（需要 Bearer token）。文件不经过 FastAPI 请求体：后端登记清单并签发私有 OSS `PUT` URL，客户端直传后再确认。

- `POST /user-skills/archive/snapshots/start`
- `POST /user-skills/archive/files/prepare`
- `POST /user-skills/archive/files/confirm`
- `POST /user-skills/archive/snapshots/{snapshot_id}/complete`

OSS 对象前缀为 `user-skill-archives/{organization_id}/{user_id}/files/`。数据库保存 skill 元数据（slug、启停、校验状态）和文件清单。

## 语音接口

- `POST https://xl.x3yun.com/api/speech/transcribe`

## 子代理轨迹归档

两个接口均需要 Bearer token。客户端仅在子代理进入终态后调用；原始 JSONL（不压缩）与截图直传私有 OSS，数据库只保存关系、统计、schema version、SHA-256 和对象 key。

- `POST /subagent-traces/prepare`：幂等写入运行元数据，并返回轨迹及截图的签名 PUT 目标。
- `POST /subagent-traces/confirm`：服务端重新读取 OSS 对象，核验长度、`x-oss-meta-sha256` 与实际内容 SHA-256 后确认归档。

`training_consent` 与归档用途分离，桌面端默认固定为 `false`。

## 对话标题接口

```http
POST https://xl.x3yun.com/api/agent/v1/conversation-title
Authorization: Bearer <access_token>
Content-Type: application/json
```

请求与响应示例：

```json
{"first_user_message": "请帮我核对这份门窗表的工程量"}
```

```json
{"success": true, "data": {"title": "核对门窗工程量"}}
```

服务端默认以非思考模式调用 `qwen3.7-max`；输入最多 8000 字，标题最多 24 字。

## 联网接口

三个接口都需要 Bearer token。搜索与抓取的 `region` 在后端兼容旧调用方而可选，深挖接口要求明确传入；桌面 Agent 始终给出区域。区域优先取用户或项目资料中可靠确认的工程所在地；没有时，客户端读取 OS 国家代码作国家级兜底，例如 `CN` 转为 `全国（电脑区域 CN 兜底；项目省市未确认）`。电脑 locale 和时区不能用于推断省市，`Asia/Shanghai` 不代表项目位于上海。与地域无关的技术资料填 `不适用（全球）`。

### 联网搜索

```http
POST https://xl.x3yun.com/api/web/search
Authorization: Bearer <access_token>
Content-Type: application/json
```

请求示例：

```json
{
  "query": "现行建筑防火通用规范及实施日期",
  "limit": 8,
  "region": "全国",
  "freshness": "oneYear",
  "allowed_domains": ["gov.cn", "mohurd.gov.cn"]
}
```

- `query`：必填，1–800 字。
- `limit`：可选，1–10，默认 8。
- `region`：可选，最多 100 字。
- `allowed_domains` / `blocked_domains`：可选、互斥，各最多 20 个域名后缀。
- 结果通常缓存 15 分钟；博查 SERP 为首选并对 429/5xx/超时重试一次。未配置、调用失败或结构化命中为空时降级到 Qwen Responses `web_search`。`bocha_error` 属于临时故障，不缓存该次降级结果。
- 搜索响应的 `provider`、`fallback_reason`、`status` 显式标明实际通道和降级原因；`sources` 只来自 Bocha 网页命中或 Qwen `web_search_call.action.sources`。`answer` / `content` 始终为空，不返回模型综述。

### 抓取/摘要网页

```http
POST https://xl.x3yun.com/api/web/fetch
Authorization: Bearer <access_token>
Content-Type: application/json
```

请求示例：

```json
{
  "url": "https://www.example.gov.cn/policy/example.html",
  "prompt": "核对文件全称、文号、发布日期、实施日期、效力状态和适用范围",
  "region": "广东省深圳市"
}
```

- `url`：必填，HTTP/HTTPS 地址，最多 2000 字。
- `prompt`：必填，1–1000 字。
- `region`：可选，最多 100 字。
- 服务端使用 `qwen3.8-max` Responses API 的 `web_search` + `web_extractor`，并启用思考模式。只有 `web_extractor_call.output` 的非空内容才会进入 `content`（同时镜像到兼容字段 `answer`）；`output_text` 不作为抓取成功依据。
- `status` 为 `ok`、`partial` 或 `empty`。正文只接受与请求 URL 匹配的 `web_extractor_call.output`；其他页面的 output 会忽略，其 URL 最多作为 `sources` 候选返回。`final_url` 优先取同一匹配 call 的 `urls` 中与请求等价的 URL；同时兼容文档示例中 `goal` 本身为 URL 的形态。线上响应的 `goal` 也可能是自然语言抽取目标，不能单独据此判定 URL。404、超时等上游语义失败可能仍返回 HTTP 200，此时应根据 `status` 判断，而不是读取模型正文。

统一成功响应示例：

```json
{
  "success": true,
  "data": {
    "query_or_url": "现行建筑防火通用规范及实施日期",
    "model": "qwen3.8-max",
    "provider": "qwen",
    "fallback_reason": "bocha_empty",
    "status": "ok",
    "answer": "",
    "content": "",
    "sources": [
      {
        "title": "官方来源",
        "url": "https://www.example.gov.cn/policy/example.html",
        "snippet": "来源摘要"
      }
    ],
    "elapsed_ms": 1234,
    "warning": null,
    "final_url": null,
    "content_type": null,
    "truncated": null
  }
}
```

## 客户端发布接口

### 获取最新客户端信息

```http
GET https://xl.x3yun.com/api/client-releases/latest
```

### 下载客户端

```http
GET https://xl.x3yun.com/api/client-releases/download/windows-x64
```

当前 Windows 安装包由后端从 `CLIENT_RELEASE_ASSETS_DIR` 指定目录返回。

## 在线调试

后端 OpenAPI JSON：

```text
https://xl.x3yun.com/api/openapi.json
```
