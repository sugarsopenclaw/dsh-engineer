# 发版与版本号

## 单一来源

- 权威版本号：`package.json` 的 `version` 字段。
- 渲染进程 UI：`vite.config.ts` 在构建时把版本注入到 `__APP_VERSION__`。
- Electron 主进程：读取同一份 `package.json`。

## 当前发布策略

1. 公开分发只提供 Windows 安装器 `.exe`。
2. 本地执行 `npm run electron:build` 生成 NSIS 安装包、`latest.yml`、`.blockmap`。
3. 用后端脚本把安装包 / blockmap 上传到 OSS，并创建 `published` 发布记录。
4. 自动更新与官网下载都经后端跳转到 OSS，不再走 GitHub Releases。

## 本地打包

1. 修改 `package.json` 的 `version`（`npm version <ver> --no-git-tag-version`）。
2. 配置代码签名环境与 `XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64`；具体见 [`docs/security-hardening.md`](docs/security-hardening.md)。
3. 执行 `npm run electron:build`。构建与末尾发布门禁会硬性检查 skill-pack Ed25519 信任锚、map/诊断残留、CAD exe、Electron fuse、安装器和应用的 Authenticode，以及 `app-update.yml` 的 `publisherName`；任一公开发布条件不满足都会中断。需要无签名的内部目录包时只能使用 `npm run electron:pack`，该产物不得上传发布。

若负责人明确要求兼容 0.8.18 的历史无签名发布链路，可执行 `npm run electron:build:legacy-unsigned`。该模式仍强制检查安装器存在、asar 内容、CAD exe 与 Electron fuse，但把 Authenticode、`publisherName` 和 skill-pack 信任锚降为显式警告；构建出的客户端继续使用缺少 `publisherName` 时的 checksum-only 自动更新路径，且托管 skill 安装保持 fail closed。此模式不得作为默认发版命令。

4. 确认 `release/` 中存在：
   - `晓量-Setup-<version>.exe`
   - `晓量-Setup-<version>.exe.blockmap`
   - `latest.yml`

另外保留门禁报告，并确认 `晓量.exe` 与安装器的 Authenticode 状态均为 `Valid`，且 `app-update.yml` 包含证书对应的 `publisherName`。

## 发布到 OSS + 后端

在 `dev/backend`：

```powershell
python scripts/publish_desktop_release.py --dry-run --channel stable --notes "发布说明"
python scripts/publish_desktop_release.py --channel stable --notes "发布说明"
```

也可在 `dev/frontend` 使用：

```powershell
npm run publish:desktop-release -- --dry-run
npm run publish:desktop-release -- --notes "发布说明"
```

需要：

- OSS：`ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET`、`OSS_BUCKET`、`OSS_REGION`
- 管理令牌：`RELEASE_ADMIN_TOKEN`（或 `--admin-token`）
- 生产建议 `OSS_PUBLIC_BASE_URL` 留空，下载走私有桶签名 URL

对象键约定：

```text
desktop-releases/windows/x64/<version>/晓量-Setup-<version>.exe
desktop-releases/windows/x64/<version>/晓量-Setup-<version>.exe.blockmap
```

## 线上验收

- `GET https://xl.x3yun.com/api/client-releases/latest`
- `GET https://xl.x3yun.com/api/desktop-updates/windows/x64/latest.yml`
- `POST https://xl.x3yun.com/api/desktop-updates/policy`（旧版本应返回 `update_available=true`）
- 下载接口返回 `302`，Location 为 OSS 签名地址

## 客户端更新

- 打包内嵌 generic feed：`https://xl.x3yun.com/api/desktop-updates/windows/x64`
- 启动后先请求 `/desktop-updates/policy`，有更新再由 `electron-updater` 下载
- 失败时可引导用户打开官网下载站（`VITE_RELEASE_SITE_URL` / 默认 `https://xl.x3yun.com`）

## CAD 侧车可执行文件

- Windows 打包会自动执行 `npm run build:cad-worker`。
- 构建机需要可用 Python；终端用户不需要单独安装 Python。
