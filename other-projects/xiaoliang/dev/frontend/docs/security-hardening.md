# 晓量发布链与防逆向加固

本文记录本期已落地的安全边界、发版必备配置、验收方法和明确接受的剩余风险。安全措施用于抬高复制、篡改和本机注入成本，不承诺把交付到用户机器上的代码变成不可读取。

## 已落地边界

- 生产 Electron bundle 强制 minify、保留运行时名称并移除 legal comments；仅 watch 或明确的 development 构建生成 source map。
- 安装包不再包含历史 `dist-electron-pkg`，CAD 侧车仅携带两个 PyInstaller exe，不携带 CAD `.py`、`tests` 或 `_diag`。
- `electron:build` / `electron:pack` 末尾运行 `verify-release-artifacts.mjs`：检查 asar、资源残留、CAD exe、Electron fuses 和 Authenticode 状态。
- 市场 skill 检查与下载接口要求 Bearer 登录态；发布脚本用 Ed25519 私钥签 canonical checksum，客户端以内嵌公钥验签成功后才写盘。
- Electron 禁用 `ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS`、Node inspect 参数，只允许从带完整性校验的 `app.asar` 加载应用。
- 主窗口启用 sandbox；主进程外链只允许 `https:`、`http:` 和 `mailto:`。
- LLM 设置不再接受或新写入用户 API Key，旧的 LLM 连接测试 IPC 与实现已删除。
- 发布管理 token 使用恒定时间比较；生产环境启动时拒绝通配符 CORS。

## Windows 代码签名接入

采购企业主体 OV 代码签名证书。2023 年后的公开信任代码签名证书通常要求硬件 token 或合规云签名；CI 优先选择能安全远程调用的云签名形态，例如 SSL.com eSigner 或 DigiCert KeyLocker。预算允许时可评估 EV，以缩短 SmartScreen 信誉建立周期。Azure Trusted Signing 成本可能更低，但采购前必须确认中国主体、区域和付款条件当前可用；当前仓库尚未配置 electron-builder 的 `win.azureSignOptions`，仅设置 `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` 不会启用 Azure 签名。

electron-builder 26 会签名应用 exe、NSIS Setup 和 elevate helper，并从证书自动提取 `publisherName` 写入 `app-update.yml`。标准 PFX/证书存储接入使用发布机环境变量，密钥和密码不得写入仓库：

```powershell
$env:WIN_CSC_LINK = 'C:\secure\xiaoliang-code-signing.pfx'
$env:WIN_CSC_KEY_PASSWORD = '<from-secret-manager>'
npm run electron:build
```

也可使用 electron-builder 支持的 `CSC_LINK` / `CSC_KEY_PASSWORD`。云签名供应商若要求专有客户端，应在确定供应商后通过其签名命令或 electron-builder 自定义 sign hook 接入，不能把 token 导出为仓库文件。

证书到位前可用 `npm run electron:pack` 生成明确标记的内部 unsigned 目录包，门禁会给出警告；`npm run electron:build` 的公开发布门禁会直接拒绝非 `Valid` 的 Authenticode 状态、缺失安装器或缺失 `publisherName`。门禁按最终产物判断，不把任何供应商环境变量当作“已经签名”的证据。自动更新同时依赖 `latest.yml` 的 sha512 和 `app-update.yml` 的 `publisherName`，下载的安装器发布者不匹配时拒绝安装。

## Skill pack Ed25519 密钥

在隔离发布机或密钥服务生成密钥，私钥只供 `publish_skill_pack.py` 使用。以下命令生成 PKCS#8 私钥，并导出客户端构建所需的 DER 公钥 Base64：

```powershell
openssl genpkey -algorithm ED25519 -out C:\secure\xiaoliang-skill-pack-ed25519.pem
openssl pkey -in C:\secure\xiaoliang-skill-pack-ed25519.pem -pubout -outform DER -out C:\secure\xiaoliang-skill-pack-ed25519-public.der
openssl base64 -A -in C:\secure\xiaoliang-skill-pack-ed25519-public.der
```

不要在 Windows PowerShell 中用管道传递二进制 DER，管道的文本重编码可能破坏密钥。构建变量必须使用上面第二条命令输出的标准 SPKI DER Base64，而不是 PEM 文本或裸 32 字节 Ed25519 公钥。

发布 skill pack：

```powershell
$env:SKILL_PACK_SIGNING_PRIVATE_KEY_PATH = 'C:\secure\xiaoliang-skill-pack-ed25519.pem'
$env:SKILL_PACK_SIGNING_KEY_ID = 'primary-v1'
python scripts/publish_skill_pack.py --skill-pack-version <version>
```

构建桌面端时，把上一步导出的 Base64 公钥嵌入主进程 bundle：

```powershell
$env:XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64 = '<DER-public-key-base64>'
$env:XIAOLIANG_SKILL_PACK_SIGNING_KEY_ID = 'primary-v1'
npm run electron:build
```

公开生产构建缺少公钥、公钥不是标准 Ed25519 SPKI DER 或 key id 非法时会在构建阶段直接失败；`electron:pack` 的内部目录包允许缺少公钥，但市场 skill 安装会 fail closed。包未签名、key id 不匹配、checksum 或签名错误时，客户端同样不会改写 managed skills。为保持 pack format v1 的 checksum 兼容性，客户端不信任 pack JSON 的 `name` / `description`，安装时会与已哈希 `SKILL.md` 推导出的展示字段核对，并只把后者写入 managed manifest。轮换密钥时先发布同时信任新 key 的客户端，再切换发布私钥；当前实现是单 key 信任锚，轮换窗口需单独发一个过渡版本。

## 生产配置与运维动作

- `APP_ENV=production` 时 `CORS_ORIGINS` 必须显式列出来源，不能为 `*`。
- 视开发机 `.env` 中的 `JWT_SECRET_KEY`、云厂商 AK、`RELEASE_ADMIN_TOKEN` 为已暴露并轮转；轮转在部署/密钥平台执行，不提交新值。
- 每次发版运行完整前后端测试、`npm run electron:pack`、preload 冒烟和门禁。实机完成登录、会话、CAD 面板、MLight 与市场 skill 更新冒烟。
- 破坏性验收应在复制出的临时包进行：修改 `app.asar` 一字节后应用应拒绝启动；给 `晓量.exe` 设置 `ELECTRON_RUN_AS_NODE=1` 不应进入 Node 模式。

## 明确接受的剩余风险与 P2 backlog

- SQLite 明文数据和 keytar 凭据对同一 Windows 用户上下文仍可读；这是当前本机攻击模型的已接受风险。
- access token 保持 24 小时，以支持长 CAD 任务；服务端撤销、账户保护和主机安全仍然重要。
- PyInstaller exe 可被提取为 pyc；当前目标是抬高分析成本，不是不可逆保护。
- 客户端中的提示词、流程编排和前端逻辑应视为公开信息。
- `node_modules` 进一步瘦身需完整回归，单独立项。
- 核心算量公式若要求真正不可复制，只能迁到服务端执行；该产品形态调整保留为 backlog。
