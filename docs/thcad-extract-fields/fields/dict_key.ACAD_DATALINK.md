# 字段：ACAD_DATALINK

- **字段 ID**：`dict_key.ACAD_DATALINK`
- **JSON 路径**：`dictionaries.jsonl / key=ACAD_DATALINK`
- **来源表/文件**：`dictionaries.jsonl`
- **作用域**：`named_dictionary`

## 实测观察

- 来源文件：`dictionaries.jsonl`
- JSON 路径：`dictionaries.jsonl / key=ACAD_DATALINK`
- 作用域：`named_dictionary`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1}
- 实测例子：
  - `5TBC.384.A110050.1_1 NOD:ACAD_DATALINK: {"runtime_class":"AcDbDictionary","handle":"1192D","count":0,"kind":null}`

## CAD 含义

Excel/表格数据链接字典。仅 384.1_1 出现。

公开资料：AutoCAD DataLink

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

有字典不等于链了铁芯参数表。

### 与其他字段组合

未解 items 前不能当叠片参数来源；铁芯一期仍要外部明细表。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
