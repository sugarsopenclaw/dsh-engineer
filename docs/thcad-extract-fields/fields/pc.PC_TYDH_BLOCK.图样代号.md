# 字段：图样代号

- **字段 ID**：`pc.PC_TYDH_BLOCK.图样代号`
- **JSON 路径**：`semantic-objects.json / other_pc_blocks[PC_TYDH_BLOCK].fields.图样代号`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`pc.PC_TYDH_BLOCK`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / other_pc_blocks[PC_TYDH_BLOCK].fields.图样代号`
- 作用域：`pc.PC_TYDH_BLOCK`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7}
- 实测例子：
  - `5TBC.384.A110050.1_1 pc:PC_TYDH_BLOCK:446A0: 5TBC.384.A110050.1`
  - `5TBC.384.A110050.2_1 pc:PC_TYDH_BLOCK:4462: 5TBC.384.A110050.2`
  - `5TBC.426.A110050.1_1 pc:PC_TYDH_BLOCK:A6F7: 5TBC.426.A110050.1`
  - `5TBC.457.A110050.1_1 pc:PC_TYDH_BLOCK:7EE6: 5TBC.457.A110050.1`
  - `5TBC.709.A110050.1_1 pc:PC_TYDH_BLOCK:8504: 5TBC.709.A110050.1`
  - `5TBC.709.A110050.1_2 pc:PC_TYDH_BLOCK:19AF: 5TBC.709.A110050.1`

## CAD 含义

PCCAD 图样代号栏块 `PC_TYDH_BLOCK` 的 `图样代号` 属性，命令 PC_TYDHDEF。

公开资料：https://www.thcad.net/5485.html

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

本栏七张都有值，且与标题栏 `title.图样代号` 一致，可作图号的第二来源。

### 与其他字段组合

必须与 `title.图样代号` 和 `drawing.filename` 三方对照：文件名带 `_页次`，代号栏没有页次。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
