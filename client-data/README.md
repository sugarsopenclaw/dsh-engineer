# client-data

客户原始资料（Palantir 里的 Source）。一次交付一个子目录，内部文件名和文件夹保持客户原样。

约定：

- 只往这里 **放** 客户给的东西，不在这里解析、清洗、改名。
- 管线只读本目录，写入一律去 `data/datasets/`。
- 内容不进 git（见仓库根 `.gitignore`）。需要分发某次 drop 时走网盘 / 对象存储。

当前 drop：`transformer-design-drawings/`。

## transformer-design-drawings

沈变交来的变压器二维 CAD 原文，不是我们自己做的备份库。7 张 DWG，来源 PCCAD V21。一次客户交付，内部文件名保持原样。

同目录的 `.bak` 也不是刻意备份：本地用天河 CAD 开图抽取时宿主改写了 DWG，打开前的原件落成 `.bak`。现状是磁盘上的 `.DWG` 多为宿主保存过的版本，原件在 `.bak`。是否从 `.bak` 恢复待定，未批准前不要覆盖。

抽取 JSON 等派生文件不要写进这里，产物去 `data/datasets/` 或 `dev-test/`。
