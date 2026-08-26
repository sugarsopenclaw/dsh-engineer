# 字段：runtime_class

- **字段 ID**：`dict.object.runtime_class`
- **JSON 路径**：`dictionaries.jsonl / object.runtime_class`
- **来源表/文件**：`dictionaries.jsonl`
- **作用域**：`dictionary.object`

## 实测观察

- 来源文件：`dictionaries.jsonl`
- JSON 路径：`dictionaries.jsonl / object.runtime_class`
- 作用域：`dictionary.object`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 179}
- 实测例子：
  - `5TBC.384.A110050.1_1 NOD:ACAD_ASSOCNETWORK: AcDbDictionary`
  - `5TBC.384.A110050.1_1 NOD:ACAD_COLOR: AcDbDictionary`
  - `5TBC.384.A110050.1_1 NOD:ACAD_DATALINK: AcDbDictionary`
  - `5TBC.384.A110050.1_1 NOD:ACAD_DETAILVIEWSTYLE: AcDbDictionary`
  - `5TBC.384.A110050.1_1 NOD:ACAD_GROUP: AcDbDictionary`
  - `5TBC.384.A110050.1_1 NOD:ACAD_IMAGE_VARS: AcDbRasterVariables`

## CAD 含义

TH_BOMRecorder 等类名。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

知道是哪种记录。

### 与其他字段组合

没有字段表。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
