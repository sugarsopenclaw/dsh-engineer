# client-data

客户原始资料（Palantir 里的 Source）。一次交付一个子目录，内部文件名和文件夹保持客户原样。

约定：

- 只往这里 **放** 客户给的东西，不在这里解析、清洗、改名。
- 管线只读本目录，写入一律去 `data/datasets/`。
- 内容不进 git（见仓库根 `.gitignore`）。需要分发某次 drop 时走网盘 / 对象存储。

当前 drop：`transformer-design-drawings/`（变压器二维 CAD）。
