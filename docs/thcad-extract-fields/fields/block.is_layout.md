# 字段：is_layout

- **字段 ID**：`block.is_layout`
- **JSON 路径**：`tables.json / blocks[].is_layout`
- **来源表/文件**：`tables.json`
- **作用域**：`block`

## 实测观察

- 来源文件：`tables.json`
- JSON 路径：`tables.json / blocks[].is_layout`
- 作用域：`block`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1544}
- 实测例子：
  - `5TBC.384.A110050.1_1 block:*Model_Space: True`
  - `5TBC.384.A110050.1_1 block:*Paper_Space: True`
  - `5TBC.384.A110050.1_1 block:*Paper_Space0: True`
  - `5TBC.384.A110050.1_1 block:PCCAD_TEMPLATE: False`
  - `5TBC.384.A110050.1_1 block:PC_MXB_BLOCK: False`
  - `5TBC.384.A110050.1_1 block:PC_MXBTITLERECORD: False`

## CAD 含义

是否布局空间块。

公开资料：BlockTableRecord.IsLayout

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

过滤 *Model_Space。

### 与其他字段组合

布局块不要当零件。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
