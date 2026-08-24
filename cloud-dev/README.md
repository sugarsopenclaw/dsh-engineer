# cloud-dev

云开发工作区（Cursor Cloud Agent / 远程环境）。不是产品层。

和 `dev-test/` 的分工：

| 路径 | 谁用 | 写什么 |
| --- | --- | --- |
| `dev-test/` | 本机 | 依赖 Windows / AutoCAD / THCAD 的实验（如抽取器） |
| `cloud-dev/` | 云环境 | 能在 Linux 远程机上跑的实验、脚本、笔记 |

不要把数据集、对象实例或 DSH 插件放进来。那些仍走 `data/`、`ontology/`、`plugins/`。编译产物和一次性输出不进 git。
