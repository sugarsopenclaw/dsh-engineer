# 字段：ascii_description

- **字段 ID**：`linetype.ascii_description`
- **JSON 路径**：`tables.json / linetypes[].ascii_description`
- **来源表/文件**：`tables.json`
- **作用域**：`linetype`

## 实测观察

- 来源文件：`tables.json`
- JSON 路径：`tables.json / linetypes[].ascii_description`
- 作用域：`linetype`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 83, "empty": 14}
- 实测例子：
  - `5TBC.384.A110050.1_1 linetype:Continuous: Solid line`
  - `5TBC.384.A110050.1_1 linetype:DASHED: Dashed __ __ __ __ __ __ __ __ __ __ __ __ __ _`
  - `5TBC.384.A110050.1_1 linetype:CENTER: Center ____ _ ____ _ ____ _ ____ _ ____ _ ____`
  - `5TBC.384.A110050.1_1 linetype:DIVIDE: Divide ____ . . ____ . . ____ . . ____ . . ____`
  - `5TBC.384.A110050.1_1 linetype:PHANTOM: _____ _ _ _____ _ _ _____ _ _ _____`
  - `5TBC.384.A110050.1_1 linetype:K: ______  __  __  ______  __  __  ______  __  __ `
- 空值例子（图上没填或空串，不是漏抽）：
  - `5TBC.384.A110050.1_1 linetype:ByBlock: `
  - `5TBC.384.A110050.1_1 linetype:ByLayer: `
  - `5TBC.384.A110050.2_1 linetype:ByBlock: `
  - `5TBC.384.A110050.2_1 linetype:ByLayer: `

## CAD 含义

线型 ASCII 描述。

公开资料：LinetypeTableRecord.AsciiDescription

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

图案说明。

### 与其他字段组合

无产品。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
