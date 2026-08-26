# dsh-engineer

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的二次开发仓库。

官方推荐方式：**不改上游源码，二次开发做成独立插件**。本仓库按这个原则拆开：

| 路径 | 职责 |
| --- | --- |
| `harness/` | 上游源码，git submodule，只跟踪、不改 |
| `plugins/` | 我们的插件包（`dsh.bundle`） |
| `patches/` | 本地 `--patch` 叠加层，开发时挂载插件 |
| `client-data/` | 客户原始资料（Source），不进 git |
| `data/` | Data Layer：管线、登记、派生数据集 |
| `ontology/` | Ontology：对象 / 链接 / 动作的类型定义 |
| `backend/` | FastAPI 服务层：Ontology 查询、任务、Action 与基础设施适配 |
| `specs/` | SDD 规格 |
| `docs/` | 本仓库文档（调研、开发笔记）；规格仍写 `specs/` |
| `other-projects/` | 参考项目。晓量冻结快照在本仓 `other-projects/xiaoliang/`（钉 `94720be`），不跟原仓同步；其余克隆仍只留本机 |
| `dev-test/` | 本机实验 / PoC，不是产品层 |
| `cloud-dev/` | 云开发工作区（Cloud Agent / 远程环境），不是产品层 |
| `.env` / `.env.example` | 全仓库环境变量，只认根目录这一份 |

客户原文 → `data/` 数据集 → `ontology/` 映射 → `backend/` 服务 → `plugins/` 给 agent 用。不要在 `client-data/` 里加工文件。基础分层见 [`specs/001-platform-layers/spec.md`](specs/001-platform-layers/spec.md)，沈变后端见 [`specs/002-shenbian-ontology-api/`](specs/002-shenbian-ontology-api/)，环境变量约定见 [`AGENTS.md`](AGENTS.md)。

上游目前不接受外部 PR；插件应作为独立包开发，发布时给 GitHub 仓库打上 `dsh-plugin` topic。

## 日常

```powershell
# 第一次，或别人刚 clone 本仓库之后
git submodule update --init --recursive
Copy-Item .env.example .env   # 只认仓库根这一份；之后改键必须与 .env.example 同时改，不要提交 .env

cd harness
pnpm install
pnpm run build
```

从 `harness/` 启动的 `dsh` 不会自动读仓库根 `.env`。给 dsh 的键请写入当前 shell，或 `$DSH_HOME/.credentials.yaml`。我们自己的前端 / 后端 / 管线一律读根目录 `.env`。

开发中用 `--patch` 挂本地插件（路径按官方要求用绝对路径）：

```powershell
cd harness
pnpm dsh web --patch ..\patches\<your-overlay>.yml
```

不要在 `harness/` 里改文件、不要在 submodule 里 commit。需要改能力就写插件。

## 同步上游

`harness/` 跟踪 `master`。开发者预览阶段上游变动很快，建议按 commit 钉死，确认插件还能跑再升级：

```powershell
git submodule update --remote harness
cd harness
pnpm install
pnpm run build
cd ..
git add harness
git commit -m "chore: bump upstream deepseek-harness"
```

若 submodule 被误改：

```powershell
git -C harness status
git -C harness restore .
git submodule update --init harness
```
