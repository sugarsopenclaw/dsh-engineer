# 字段：invisible

- **字段 ID**：`entity.geometry.invisible`
- **JSON 路径**：`entities.jsonl / geometry.invisible`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.invisible`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- **key absent on all seven drawings**：七张 `out-thcad/<图>/` 的 JSON/JSONL 都没有这个键（抽取器可能写了 null，JsonUtil 会丢弃 null；或该类图元本批没有）。
- 计数：{"seen": 0}
- 观察结论：本键在现行七张 THCAD 抽取里不落地，工程上只能当「抽取器能力预留」或「本批图纸没有这类对象」。

## CAD 含义

attDef 不可见标志。七张 geometry 上 absent（同上原因）。

公开资料：DrawingExtractor

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

key absent on all seven drawings。

### 与其他字段组合

块属性可见性看 `entity.attributes.invisible`。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
