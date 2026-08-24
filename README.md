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
| `specs/` | SDD 规格 |
| `docs/` | 本仓库文档（调研、开发笔记）；规格仍写 `specs/` |
| `other-projects/` | 参考项目，只参考，不进 git。晓量冻结点：[LuarAssassin/xiaoliang@94720be](https://github.com/LuarAssassin/xiaoliang/tree/94720bedb4575deb388dfd0500432a4777cf08dd) |
| `dev-test/` | 本机实验 / PoC，不是产品层 |
| `cloud-dev/` | 云开发工作区（Cloud Agent / 远程环境），不是产品层 |

客户原文 → `data/` 数据集 → `ontology/` 映射 → `plugins/` 给 agent 用。不要在 `client-data/` 里加工文件。细节见 [`specs/001-platform-layers/spec.md`](specs/001-platform-layers/spec.md)。

上游目前不接受外部 PR；插件应作为独立包开发，发布时给 GitHub 仓库打上 `dsh-plugin` topic。

## 日常

```powershell
# 第一次，或别人刚 clone 本仓库之后
git submodule update --init --recursive

cd harness
pnpm install
pnpm run build
```

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
