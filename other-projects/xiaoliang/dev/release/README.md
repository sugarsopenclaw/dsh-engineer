# 晓量 release 下载站

独立的 Web 下载落地页，承接中国大陆用户的手动下载，并展示与桌面端同源的 Credits 价格。

视觉与内容对齐 `my-projects/xiaoliangweb-main` 的产品官网（Ant Design 蓝 `#1677FF`、深蓝 Hero、白/浅灰区块交替），
把官网的首页、会员页、下载页合并成一条单页长滚动。

## 页面结构

`src/App.tsx` 按顺序拼装 `src/sections/` 下的区块：

| 区块 | 数据来源 |
| --- | --- |
| `Hero` | 版本/体积/发布时间来自 `/client-releases/latest`，其余为静态文案 |
| `Capabilities` | `content.ts` 的四大 Agent |
| `Innovation` | `content.ts` + 合作机构 logo |
| `Pricing` | 个人三档读 `/billing/products`；企业档与算力池为静态展示，CTA 走邮件洽谈 |
| `Consumption` | `/billing/pricing` 费率 × `credits.ts` 中按真实流量校准的场景 token 规模 |
| `Philosophy` / `DownloadCenter` / `Faq` / `CtaBanner` | `content.ts` + 发布接口的安装步骤与校验值 |

营销文案集中在 `src/content.ts`；任何和计费有关的数字都从接口读，不在文案里写死，避免和后端漂移。

## 本地开发

1. 复制 `.env.example` 为 `.env`
2. 配置 `VITE_RELEASE_API_BASE_URL`
3. 运行：

```bash
npm install
npm run dev
```

```bash
npm test
```

## 生产构建

```bash
npm run build
```

构建产物位于 `dist/`，适合部署到静态 CDN 或对象存储。

## 后端依赖

页面依赖 backend 提供：

- `GET /client-releases/latest`
- `GET /client-releases/download/{platform}`（下载按钮带 `source=landing-page`）
- `GET /billing/products`
- `GET /billing/pricing`

价格接口挂掉时回落到与后端常量一致的静态值，下载入口仍可用。

下载按钮不会直连 OSS。浏览器命中 backend 后，由 backend 记录下载事件并 `302` 跳转到私有 OSS 短期签名地址（或配置的公网基址）。

自动更新与官网下载共用同一套 `desktop_releases` 发布记录。

## 图片资源

产品 logo、场景图与合作机构 logo 由 `scripts/optimize_assets.py` 压成 WebP，写入 `src/assets/generated/`
（当前合计约 290 KB，随包发布，不走 OSS）。源图在 `my-projects/xiaoliangweb-main/public/`，那棵树不入库，
所以压好的 WebP 必须提交，否则别处克隆下来构建会缺图。源图变更后重新运行：

```bash
python scripts/optimize_assets.py --force
```

脚本会顺带删掉 `generated/` 里已经没人引用的 WebP。透明底 logo 会先裁掉空白边；北建大那张是白色字标，
需要反色后才能在浅色页面上看清，这些都由脚本里的 `trim` / `invert` 开关控制。
