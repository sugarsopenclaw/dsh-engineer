# 字段：block_handle

- **字段 ID**：`layout.block_handle`
- **JSON 路径**：`tables.json / layouts[].block_handle`
- **来源表/文件**：`tables.json`
- **作用域**：`layout`

## 实测观察

- 来源文件：`tables.json`
- JSON 路径：`tables.json / layouts[].block_handle`
- 作用域：`layout`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 21}
- 实测例子：
  - `5TBC.384.A110050.1_1 layout:Layout1: 1B`
  - `5TBC.384.A110050.1_1 layout:Layout2: 3E`
  - `5TBC.384.A110050.1_1 layout:Model: 1F`
  - `5TBC.384.A110050.2_1 layout:Model: 1F`
  - `5TBC.384.A110050.2_1 layout:布局1: 1B`
  - `5TBC.384.A110050.2_1 layout:布局2: 3E`

## CAD 含义

布局对应块表记录。

公开资料：Layout.BlockTableRecordId

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

连到 *Model_Space。

### 与其他字段组合

用 block.entity_count 看空间内实体数。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
