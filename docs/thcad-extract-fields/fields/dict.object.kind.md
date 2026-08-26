# 字段：kind

- **字段 ID**：`dict.object.kind`
- **JSON 路径**：`dictionaries.jsonl / object.kind`
- **来源表/文件**：`dictionaries.jsonl`
- **作用域**：`dictionary.object`

## 实测观察

- 来源文件：`dictionaries.jsonl`
- JSON 路径：`dictionaries.jsonl / object.kind`
- 作用域：`dictionary.object`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 22}
- 实测例子：
  - `5TBC.384.A110050.1_1 NOD:ACAD_CIP_PREVIOUS_PRODUCT_INFO: xrecord`
  - `5TBC.384.A110050.1_1 NOD:ACAD_IMAGE_VARS: object`
  - `5TBC.384.A110050.1_1 NOD:ACAD_WIPEOUT_VARS: object`
  - `5TBC.384.A110050.2_1 NOD:ACAD_CIP_PREVIOUS_PRODUCT_INFO: xrecord`
  - `5TBC.384.A110050.2_1 NOD:ACAD_IMAGE_VARS: object`
  - `5TBC.384.A110050.2_1 NOD:ACAD_RENDER_ACTIVE_SETTINGS: object`

## CAD 含义

子对象 kind：dictionary/xrecord/object。

公开资料：DumpDbObject

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

结构。

### 与其他字段组合

xrecord.data 仍是未解码 TypedValue。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
