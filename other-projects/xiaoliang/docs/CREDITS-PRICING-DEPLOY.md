# Credits 让利定价：上线检查清单

入门 / 标准 / 专业毛利改为约 **10% / 8% / 5%** 时使用。售价不变，扣费倍率从 `4.0` 降到 `10/9 ≈ 1.111`，套餐额度改为 12,375 / 63,750 / 132,000。

计费公式与套餐的权威说明见 [`dev/backend/docs/credits-billing.md`](../dev/backend/docs/credits-billing.md)。通用发版步骤见 [`SERVER-DEPLOYMENT.md`](SERVER-DEPLOYMENT.md)。

**这次不迁存量 grant，但要先做一条 additive schema 迁移。** 迁移把额度和有效期快照到订单，并按旧套餐回填已有订单；这样改价前创建、改价后付款的订单仍按下单时承诺发放。已买、已赠送的 credits 张数不变，上线后按新费率消耗，同一余额能跑大约 3.6 倍任务。

---

## 0. 上线前必须理解的一点

生产容器通过 `env_file: ./.env` 注入环境变量。`.env` 里的 `BILLING_CREDIT_MARKUP` **会覆盖代码默认值**。

只 `git pull`、不改生产 `.env`，线上会继续按 **4 倍**扣费，同时 `GET /billing/products` 已经在卖新额度。用户少付钱、任务却仍按旧价烧 credits。

新版本在 `APP_ENV=production` 时会校验倍率：偏离代码基准超过 5% 将拒绝启动。这是最后一道保险，不替代部署前修改 `.env`。

`.env` 不进 Git，必须在生产机上手改，并与镜像同一窗口重启。

---

## 1. 部署前

- [ ] `/home/xiaoliang` 已 `git pull --ff-only` 到含本次定价改动的 commit
- [ ] 已备份生产 `.env`（沿用 `SERVER-DEPLOYMENT.md` 的 `backend.env.before-deploy-*`）
- [ ] 打开 `/home/xiaoliang/dev/backend/.env`，确认并改成：

```env
BILLING_CREDIT_MARKUP=1.111111
```

不要写成 `4`、`4.0` 或留空后又被别处 export 成 4。

- [ ] 确认 `BILLING_CREDITS_ENFORCE` 仍是当前业务意图：
  - `true`：扣余额、余额为 0 返回 402
  - `false`：影子模式，只记账不扣款不拦截（不要和这次让利一起误开）
- [ ] 注册赠送保持 `BILLING_SIGNUP_GRANT_CREDITS=2000`（本次不改）
- [ ] 已在代码部署前执行订单额度快照迁移：

```bash
docker exec -i xiaoliang-postgres psql -U xiaoliang -d xiaoliang \
  < dev/backend/scripts/migrations/2026-08-15-billing-order-entitlement-snapshot.sql
```

- [ ] 验证已有待支付订单的 `credits` / `duration_days` 已按旧套餐回填

对照表：

| 项 | 旧 | 新 |
|---|---|---|
| `BILLING_CREDIT_MARKUP` | `4` | `1.111111` |
| `PRICING_VERSION`（接口返回，不是 env） | `qwen3.8-max-cn-beijing-x4-v1` | `qwen3.8-max-cn-beijing-x1.11-v1` |
| 入门 | ¥99 / 10,000 | ¥99 / **12,375** |
| 标准 | ¥499 / 62,500 | ¥499 / **63,750** |
| 专业 | ¥999 / 135,000 | ¥999 / **132,000** |
| 微信支付金额 | ¥99 / ¥499 / ¥999 | 不变 |

专业版张数略减是为了卡 5% 毛利地板；单 credit 更值钱，实际能跑的任务仍远多于改价前。

---

## 2. 发布

代码和 `.env` **同一窗口**生效：

```bash
# 在 /home/xiaoliang
./deploy.sh backend --pull
```

发布页若一并更新（落地页 fallback 与消耗示例）：

```bash
./deploy.sh all --pull
```

- [ ] `xiaoliang-backend` 已用新镜像 recreate，health 正常
- [ ] 容器内能读到新倍率（在宿主机执行）：

```bash
docker exec xiaoliang-backend printenv BILLING_CREDIT_MARKUP
# 期望：1.111111
```

若这里仍是 `4`，停下来改 `.env` 再 `compose up -d --force-recreate`，不要继续验收。

---

## 3. 接口验收（必须全过）

生产域名：`https://xl.x3yun.com`

### 3.1 费率表

```bash
curl -sS https://xl.x3yun.com/api/billing/pricing
```

- [ ] `pricing_version` = `qwen3.8-max-cn-beijing-x1.11-v1`
- [ ] `credit_unit_price_rmb` = `0.008`
- [ ] `models["qwen3.8-max"]`：

| 字段 | 期望 |
|---|---:|
| `uncached_input_micro` | 1667 |
| `cached_input_micro` | 208 |
| `cache_write_micro` | 2083 |
| `output_micro` | 5000 |

若 version 已是 `x1.11-v1` 但 micro 仍是 6000 / 750 / 7500 / 18000，就是 **markup 仍为 4**。

### 3.2 套餐

```bash
curl -sS https://xl.x3yun.com/api/billing/products
```

- [ ] 三档 `amount_fen` 仍为 `9900` / `49900` / `99900`
- [ ] `credits` 为 `12375` / `63750` / `132000`
- [ ] `unit_price_rmb` 约为 `0.008` / `0.007827` / `0.007568`
- [ ] `discount_percent` 为 `0` / `2` / `5`（相对入门单价）

### 3.3 抽一笔真实扣费

用测试号跑一轮短对话（例如「你好」），然后查库：

```sql
SELECT pricing_version, credits, input_tokens, output_tokens, created_at
FROM usage_charges
ORDER BY created_at DESC
LIMIT 5;
```

- [ ] 新行的 `pricing_version` = `qwen3.8-max-cn-beijing-x1.11-v1`
- [ ] 同等 token 规模下，`credits` 大约是改价前的 **1/3.6**（例如旧的 210 → 新的约 59）
- [ ] 旧行的 `pricing_version` 仍是 `...-x4-v1`，不要去改历史账

对照公式（心算即可）：

```
credits ≈ ceil(百炼成本 × 1.111 / 0.008)
```

一轮 20k 未缓存输入 + 5k 输出 ≈ **59** credits，不应再是 210。

---

## 4. 客户端与落地页

桌面端套餐和消耗预估都读上面两个 API，**不必为这次改价强更安装包**。

- [ ] 已登录桌面端打开订阅面板：三档价格仍是 ¥99 / ¥499 / ¥999，额度是 12,375 / 63,750 / 132,000
- [ ] 离线时才走安装包内 fallback；旧安装包离线会显示旧额度，联网后以 API 为准
- [ ] 发布页个人档与 API 一致
- [ ] 发布页企业洽谈包若已随代码更新：¥800 / ¥3,910 / ¥7,570（旧的 ¥0.0064/credit 会低于模型成本，不要再对外报）

---

## 5. 业务副作用（知道即可，不必处理存量）

| 现象 | 是否正常 |
|---|---|
| 已买 10,000 credits 的用户，同样余额能跑更久 | 正常，就是这次让利 |
| 改价前创建、改价后支付的订单 | 按订单快照发放旧额度（10,000 / 62,500 / 135,000），与下单承诺一致 |
| 改价后创建的订单 | 按订单快照发放新额度（12,375 / 63,750 / 132,000） |
| `reconcile_shadow_credits.py` 报旧影子行 `pricing_version` 陈旧 | 正常，不要用新版本去「修」旧账 |
| 注册赠送仍是 2,000，但能跑的任务变多 | 正常（成本大约从 ¥4 升到 ¥14） |
| 文档解析 / ASR / 联网搜索仍不扣 credits | 正常，尚未计量；专业版 5% 模型毛利会被这些开销再削薄 |

---

## 6. 回滚

只回滚代码、不回滚 `.env`：用户会按旧套餐额度买、按新倍率扣，账对不上。

只回滚 `.env` 到 `4`、不回滚代码：又回到「卖新额度、按 4 倍扣」的错配。

正确回滚：

1. 把 `.env` 的 `BILLING_CREDIT_MARKUP` 改回 `4`
2. 把后端镜像 / 代码指回改价前的 tag 或 commit
3. 同一窗口 `compose up -d --force-recreate`
4. 再打一遍 §3.1 / §3.2：version 回到 `...-x4-v1`，套餐回到 10,000 / 62,500 / 135,000

历史 `usage_charges` 不要改。回滚后新产生的扣费会重新落到 `...-x4-v1`。

订单快照列是向后兼容的 additive 变更，回滚代码时可以保留，不要为了回滚删除快照。

---

## 7. 完成标准（打勾再离开）

- [ ] 容器内 `BILLING_CREDIT_MARKUP=1.111111`
- [ ] `billing_orders` 已有 `credits` / `duration_days`，旧待支付订单已回填
- [ ] `/api/billing/pricing` 的 version 与四档 micro 与 §3.1 一致
- [ ] `/api/billing/products` 三档额度与售价与 §3.2 一致
- [ ] 新产生的 `usage_charges.pricing_version` 为 `qwen3.8-max-cn-beijing-x1.11-v1`
- [ ] 桌面订阅面板（联网）显示新额度
- [ ] 微信支付金额未改
