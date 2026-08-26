# 字段：value

- **字段 ID**：`entity.text.value`
- **JSON 路径**：`entities.jsonl / text.value`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.text`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / text.value`
- 作用域：`entity.text`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- **key absent on all seven drawings**：七张 `out-thcad/<图>/` 的 JSON/JSONL 都没有这个键（抽取器可能写了 null，JsonUtil 会丢弃 null；或该类图元本批没有）。
- 计数：{"seen": 0}
- 观察结论：本键在现行七张 THCAD 抽取里不落地，工程上只能当「抽取器能力预留」或「本批图纸没有这类对象」。

## CAD 含义

属性值。七张 text 对象上 absent（属性值在 attributes[]）。

公开资料：DrawingExtractor.TextOf

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

key absent on all seven drawings。

### 与其他字段组合

读 `entity.attributes.value` 或 `title.*`/`bom.*`。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
