# 字段：managed_type

- **字段 ID**：`dict.object.managed_type`
- **JSON 路径**：`dictionaries.jsonl / object.managed_type`
- **来源表/文件**：`dictionaries.jsonl`
- **作用域**：`dictionary.object`

## 实测观察

- 来源文件：`dictionaries.jsonl`
- JSON 路径：`dictionaries.jsonl / object.managed_type`
- 作用域：`dictionary.object`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 15}
- 实测例子：
  - `5TBC.384.A110050.1_1 NOD:ACAD_IMAGE_VARS: RasterVariables`
  - `5TBC.384.A110050.1_1 NOD:ACAD_WIPEOUT_VARS: ImpDBObject`
  - `5TBC.384.A110050.2_1 NOD:ACAD_IMAGE_VARS: RasterVariables`
  - `5TBC.384.A110050.2_1 NOD:ACAD_RENDER_ACTIVE_SETTINGS: MentalRayRenderSettings`
  - `5TBC.426.A110050.1_1 NOD:ACAD_IMAGE_VARS: RasterVariables`
  - `5TBC.426.A110050.1_1 NOD:ACAD_RENDER_ACTIVE_SETTINGS: MentalRayRenderSettings`

## CAD 含义

.NET 类型名。

公开资料：DumpDbObject

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

同 runtime。

### 与其他字段组合

无。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
