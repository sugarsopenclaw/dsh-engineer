# 字段：日期

- **字段 ID**：`pc.PC_FJL_BLOCK.日期`
- **JSON 路径**：`semantic-objects.json / other_pc_blocks[PC_FJL_BLOCK].fields.日期`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`pc.PC_FJL_BLOCK`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / other_pc_blocks[PC_FJL_BLOCK].fields.日期`
- 作用域：`pc.PC_FJL_BLOCK`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7, "empty": 7}
- 空值例子（图上没填或空串，不是漏抽）：
  - `5TBC.384.A110050.1_1 pc:PC_FJL_BLOCK:44635: `
  - `5TBC.384.A110050.2_1 pc:PC_FJL_BLOCK:43F7: `
  - `5TBC.426.A110050.1_1 pc:PC_FJL_BLOCK:A68C: `
  - `5TBC.457.A110050.1_1 pc:PC_FJL_BLOCK:7E7B: `

## CAD 含义

PCCAD 附加栏 `PC_FJL_BLOCK` 属性 `日期`，命令 PC_FJLEDIT。

公开资料：https://www.thcad.net/5485.html

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

七张图 `日期` 全是空串，不能当签字/底图总号来源。

### 与其他字段组合

将来若填写，应与 `title.图样代号` 一起做归档元数据；现在组合也推不出日期或责任人。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
