# 字段：is_proxy

- **字段 ID**：`dict.object.is_proxy`
- **JSON 路径**：`dictionaries.jsonl / object.is_proxy`
- **来源表/文件**：`dictionaries.jsonl`
- **作用域**：`dictionary.object`

## 实测观察

- 来源文件：`dictionaries.jsonl`
- JSON 路径：`dictionaries.jsonl / object.is_proxy`
- 作用域：`dictionary.object`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 186}
- 实测例子：
  - `5TBC.384.A110050.1_1 NOD:ACAD_ASSOCNETWORK: False`
  - `5TBC.384.A110050.1_1 NOD:ACAD_CIP_PREVIOUS_PRODUCT_INFO: False`
  - `5TBC.384.A110050.1_1 NOD:ACAD_COLOR: False`
  - `5TBC.384.A110050.1_1 NOD:ACAD_DATALINK: False`
  - `5TBC.384.A110050.1_1 NOD:ACAD_DETAILVIEWSTYLE: False`
  - `5TBC.384.A110050.1_1 NOD:ACAD_GROUP: False`

## CAD 含义

是否 proxy。TH 侧一般为 false。

公开资料：DBObject.IsAProxy

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

解码状态。

### 与其他字段组合

true 则记录不可读。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
