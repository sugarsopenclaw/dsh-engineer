# 晓量生产部署经验（VPS）

本文汇总 **2026-08-01** 前后，在生产机上将 GitHub `main` 部署到线上、打通桌面发版（OSS + 后端签名下载）、计费相关迁移，以及常见运维踩坑。面向后续部署工程师；**不包含任何密钥明文**。

相关仓库：`git@github.com:LuarAssassin/xiaoliang.git`

生产域名：`https://xl.x3yun.com`

---

## 1. 单一部署目录

`/home/xiaoliang` 是唯一代码与部署入口。生产 Dockerfile、Compose 和 `deploy.sh` 均纳入 Git；服务器直接 `git pull` 后从该目录构建，不再同步到第二套目录。

仅以下生产机配置不进 Git：

| 路径 | 用途 |
|------|------|
| `dev/backend/.env` | 数据库、OSS、支付等生产环境变量 |
| `dev/backend/wechatpay_key/` | 微信支付私钥与平台证书 |

两者均已被 `.gitignore` 与 Docker 构建上下文排除。备份和恢复时需单独处理。

---

## 2. 线上拓扑

```text
Browser / Desktop
       │
       ▼
nginx (宿主机, sites-available/xl)
  /api/*  → 127.0.0.1:18092  (xiaoliang-backend)
  /       → 127.0.0.1:18093  (xiaoliang-release)
       │
       ├─► PostgreSQL (1Panel, 本机 13571, 库名 xiaoliang)
       └─► OSS 桶 costagent（私有）— 安装包下载走后端签名 URL
```

| 容器 | 镜像标签约定 | 端口 |
|------|----------------|------|
| `xiaoliang-backend` | `xiaoliang-backend:YYYYMMDD` | `127.0.0.1:18092→8000` |
| `xiaoliang-release` | `xiaoliang-release:YYYYMMDD` | `127.0.0.1:18093→80` |

生产入口：

- [`deploy.sh`](../deploy.sh)
- [`dev/backend/docker-compose.backend.yml`](../dev/backend/docker-compose.backend.yml)
- [`dev/release/docker-compose.release.yml`](../dev/release/docker-compose.release.yml)

后端镜像不再依赖旧本地资产：桌面安装包与版本信息来自 PostgreSQL + OSS；旧知识库静态文件不再挂载；Skill 源文件随当前代码构建进镜像。唯一运行时挂载是微信支付证书目录。

---

## 3. 标准升级步骤（后端 + 发布页）

### 3.1 备份

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/xiaoliang-deploy-backups
cp -a /home/xiaoliang/dev/backend/.env \
  /root/xiaoliang-deploy-backups/backend.env.before-deploy-$STAMP
tar -czf /root/xiaoliang-deploy-backups/wechatpay-key-$STAMP.tar.gz \
  -C /home/xiaoliang/dev/backend wechatpay_key
```

### 3.2 拉代码

```bash
git -C /home/xiaoliang pull --ff-only
```

### 3.3 首次配置生产机

从 `.env.example` 创建 `dev/backend/.env`，并将支付证书放入被 Git 忽略的目录：

```bash
install -d -m 700 /home/xiaoliang/dev/backend/wechatpay_key
# 从加密备份恢复证书文件到上述目录
chmod 600 /home/xiaoliang/dev/backend/wechatpay_key/*
```

Compose 会将证书目录只读挂载到 `/app/wechatpay_key`，不会打进镜像。

`WECHATPAY_NOTIFY_URL` 必须是晓量域名，例如：

`https://xl.x3yun.com/api/billing/wechat/native/notify`

（不要照抄晓图的 `xt.x3yun.com`。）

### 3.4 生产 `.env` 要点

路径：`/home/xiaoliang/dev/backend/.env`（Compose 通过 `env_file` 注入容器）。

桌面发版 / OSS（必配）：

```env
RELEASE_ADMIN_TOKEN=<生产 admin token>
DESKTOP_UPDATE_BASE_URL=https://xl.x3yun.com/api/desktop-updates
OSS_RELEASE_SIGNED_URL_EXPIRES_SECONDS=21600
OSS_BUCKET=costagent
OSS_REGION=cn-beijing
ALIBABA_CLOUD_ACCESS_KEY_ID=...
ALIBABA_CLOUD_ACCESS_KEY_SECRET=...
```

**重要：`OSS_PUBLIC_BASE_URL` 必须留空或删除。**

桶是私有的；若仍指向 `http://oss.x3yun.com`，下载会 403。留空后后端签发临时 URL。

计费 / Agent 相关键见 [`dev/backend/.env.example`](../dev/backend/.env.example)（`WECHATPAY_*`、`AGENT_*`、`BILLING_*`、`FREE_DAILY_LIMIT` 等）。缺省值多数在代码里有默认，但生产建议显式写齐。

Credits 扣费倍率 **`BILLING_CREDIT_MARKUP` 必须与当前代码一致**。`.env` 会覆盖代码默认值；生产值偏离代码基准超过 5% 时，新版本会拒绝启动，避免商品额度与扣费倍率错配。本次让利上线清单见 [`CREDITS-PRICING-DEPLOY.md`](CREDITS-PRICING-DEPLOY.md)。

### 3.5 数据库迁移

库：PostgreSQL `xiaoliang`（生产 `DATABASE_URL`，常见为本机 `13571`）。

上线读 `/desktop-updates` 与 DB 版 `/client-releases` 前必跑：

1. `dev/backend/scripts/migrations/2026-07-31-desktop-updates.sql`
2. 若一并上计费：`dev/backend/scripts/migrations/2026-07-29-billing-mvp.sql`
3. 自制 skill 归档：`dev/backend/scripts/migrations/2026-08-17-user-skill-archive.sql`

宿主机未必有 `psql`，可用 Python `psycopg2` 连 `DATABASE_URL` 执行，或 `docker exec` 进 1Panel Postgres 容器执行。

复查示例：存在表 `desktop_releases`、`billing_orders`、`user_skill_archives`，以及列 `organizations.plan_tier`。

> `AUTO_CREATE_TABLES=true` **不能替代** 上述 SQL：已有 `organizations` 表时 `create_all` 不会可靠地补上 `plan_tier`。

### 3.6 构建并重启

```bash
cd /home/xiaoliang
./deploy.sh all --pull
# 或仅后端：./deploy.sh backend --pull
```

脚本默认使用当前 Git commit 短哈希作为镜像标签，构建后等待容器健康并验证本机接口。任一步失败都会以非零状态退出。

```bash
curl -sS http://127.0.0.1:18092/health
curl -sS http://127.0.0.1:18093/health
```

---

## 4. 桌面发版（0.8.x：OSS + 写库）

开发侧在 Windows 打包并上传 OSS 后，**Ubuntu 上无需再打包安装包**。

### 4.1 核对 OSS 对象

桶：`costagent`。用后端容器内的 `oss2` 读 meta（宿主机未必装了 `oss2`）：

```bash
docker exec -i xiaoliang-backend python - <<'PY'
# 从 /app/.env 读 AK/SK/BUCKET/REGION，对 object_key 调 get_object_meta，核对 Content-Length
PY
```

示例（以实际版本为准）：

```text
desktop-releases/windows/x64/<ver>/晓量-Setup-<ver>.exe
desktop-releases/windows/x64/<ver>/晓量-Setup-<ver>.exe.blockmap
```

### 4.2 登记发布（写库）

后端起来后：

```bash
# 公网（经 nginx，带 /api 前缀）
curl -X POST 'https://xl.x3yun.com/api/desktop-updates/admin/releases' \
  -H 'Content-Type: application/json' \
  -H 'X-Release-Admin-Token: <与 .env 中 RELEASE_ADMIN_TOKEN 一致>' \
  -d @release-payload.json

# 或本机直打容器（nginx 已剥掉 /api，路径无 /api 前缀）
curl -X POST 'http://127.0.0.1:18092/desktop-updates/admin/releases' ...
```

`latest.yml` **不是** 静态文件，由 API 动态生成：

`GET /api/desktop-updates/windows/x64/latest.yml`

### 4.3 验收

| 检查 | 期望 |
|------|------|
| `GET /api/client-releases/latest` | `data.version` = 目标版本 |
| `GET /api/client-releases/download/windows-x64` | **302** 到 `*.aliyuncs.com` 签名 URL（非本机文件直出） |
| `GET /api/desktop-updates/windows/x64/latest.yml` | 200，含版本与 installer `sha512` |
| `GET https://xl.x3yun.com/` | 发布页 200 |

2026-08-01 已完成登记与验收的版本：**0.8.1**（首登）、随后以 **0.8.2** 为准对外。

---

## 5. 运维踩坑与处置

### 5.1 Nginx `413 Request Entity Too Large`

现象：桌面 Agent `POST /api/agent/v1/chat/completions` 带较大上下文时，宿主机 nginx 返回 413（`nginx/1.18.0`）。

原因：`/etc/nginx/sites-available/xl` 未设 `client_max_body_size`，默认 **1m**；实际 body 可到数 MB。

处置（已在生产执行）：在 `server` 块增加：

```nginx
client_max_body_size 100m;
```

然后 `nginx -t && nginx -s reload`。同机 `xt` / `citygpt` 等站早已放宽，仅 `xl` 曾漏配。

### 5.2 将某用户改回 free 未付费

额度由组织 `plan_tier` + 未过期的 `usage_credit_grants` 决定（见 `QuotaService` / `effective_plan_tier`）。仅改 `plan_tier` 不够，有效 grant 仍会把用户算回 plus/pro。

做法概要：

1. 按邮箱查 `users` → `memberships` → `organization_id`
2. `UPDATE organizations SET plan_tier='free' ...`
3. 将该组织下 `period_ends_at > NOW()` 的 grant **立即过期**
4. 视需要将 `billing_orders.status='pending'` 改为 `cancelled`

历史 `paid` 订单可保留作审计；是否删除由业务决定。

### 5.3 回滚

- 容器：改 compose / 环境变量中的 `DEPLOY_IMAGE_TAG` 指回旧标签（如曾用过的 `20260616`），`compose up -d --force-recreate`
- 配置：还原 `/root/xiaoliang-deploy-backups/backend.env.before-deploy-*`
- **不要**随意删旧镜像，直到新版本稳定

### 5.4 安全提醒

- `RELEASE_ADMIN_TOKEN`、OSS AK/SK、微信支付密钥、DB 密码 **只进 `.env`**，勿写进文档正文或聊天长期存档。
- 聊天中出现过的 token 应按泄露处理，择机轮换。

---

## 6. 快速检查清单（下次发版）

- [ ] `/home/xiaoliang` 已 `pull` 到目标 commit
- [ ] `dev/backend/.env` 与 `wechatpay_key/` 存在、权限正确且仍被 Git 忽略
- [ ] 新迁移 SQL 已在生产库执行并复查
- [ ] `.env`：发版三项 + OSS AK + **`OSS_PUBLIC_BASE_URL` 为空**
- [ ] `./deploy.sh backend --pull`（或 `all --pull`），health 正常
- [ ] OSS 对象存在且大小一致
- [ ] `POST .../admin/releases` 登记目标版本
- [ ] latest / download 302 / latest.yml 三项验收通过
- [ ] 若本次含 Credits 定价改动：按 [`CREDITS-PRICING-DEPLOY.md`](CREDITS-PRICING-DEPLOY.md) 改生产 `.env` 并验收接口（只 pull 代码不够）
- [ ] 若套餐额度有变化：先执行对应的 billing-order entitlement snapshot 迁移，保护待支付订单
- [ ] 若 Agent 上传变大：确认 nginx `client_max_body_size` 仍足够

---

## 7. 相关文件索引

| 说明 | 位置 |
|------|------|
| 环境变量样例 | `dev/backend/.env.example` |
| 桌面更新迁移 | `dev/backend/scripts/migrations/2026-07-31-desktop-updates.sql` |
| Credits 让利定价上线检查 | [`CREDITS-PRICING-DEPLOY.md`](CREDITS-PRICING-DEPLOY.md) |
| 待支付订单额度快照迁移 | `dev/backend/scripts/migrations/2026-08-15-billing-order-entitlement-snapshot.sql` |
| 自制 skill 归档迁移 | `dev/backend/scripts/migrations/2026-08-17-user-skill-archive.sql` |
| 计费迁移 | `dev/backend/scripts/migrations/2026-07-29-billing-mvp.sql` |
| 桌面更新路由 | `dev/backend/app/api/routes/desktop_updates.py` |
| 发布登记脚本（可选） | `dev/backend/scripts/publish_desktop_release.py` |
| 生产部署脚本 | `deploy.sh` |
| 后端 Docker 配置 | `dev/backend/Dockerfile`、`dev/backend/docker-compose.backend.yml` |
| 发布页 Docker 配置 | `dev/release/Dockerfile`、`dev/release/docker-compose.release.yml` |
| 宿主机反代 | `/etc/nginx/sites-available/xl` |
| 备份目录 | `/root/xiaoliang-deploy-backups/` |
