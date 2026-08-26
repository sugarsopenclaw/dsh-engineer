# 字段：source_sha256

- **字段 ID**：`report.source_sha256`
- **JSON 路径**：`extraction-report.json / source_sha256`
- **来源表/文件**：`extraction-report.json`
- **作用域**：`report`

## 实测观察

- 来源文件：`extraction-report.json`
- JSON 路径：`extraction-report.json / source_sha256`
- 作用域：`report`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7}
- 实测例子：
  - `5TBC.384.A110050.1_1 extraction-report.json: 8ffcf4a91392754347bbf4e2f9c30bd288da4785292b715cb11b8e90b6dfd9bd`
  - `5TBC.384.A110050.2_1 extraction-report.json: 380848bdcbbd0815d2b305b3d6d4b556b2d7455c18f6aeaa33c748808dfea975`
  - `5TBC.426.A110050.1_1 extraction-report.json: a9e6627827016d33ad380e521430621b819a15cbf2eefb627902c7889277eba5`
  - `5TBC.457.A110050.1_1 extraction-report.json: cc75a7e516cd72497a35805565bed78f77b1fe46340e51e29a5f4e7d8dd274f8`
  - `5TBC.709.A110050.1_1 extraction-report.json: d09ebfa22a29b6382bbcb45c2f4fe85a4ee9ece07f8246d232c603440404ec00`
  - `5TBC.709.A110050.1_2 extraction-report.json: d71e1b81ed2339bdb53c1277afdeeb7700773114214ae33a597f81c24523905a`

## CAD 含义

源文件 SHA-256。字段目录没把此键写成表列，数据里有。

公开资料：DrawingExtractor.TryHash

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

文件身份，防抽错版本。

### 与其他字段组合

铁芯场景第一步文件配对：sha256 + 图样代号 + 页次。

## 工程可用性判定

**判定：单独可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
