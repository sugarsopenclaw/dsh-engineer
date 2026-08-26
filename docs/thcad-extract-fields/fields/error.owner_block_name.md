# 字段：owner_block_name

- **字段 ID**：`error.owner_block_name`
- **JSON 路径**：`errors.jsonl / owner_block_name`
- **来源表/文件**：`errors.jsonl`
- **作用域**：`error`

## 实测观察

- 来源文件：`errors.jsonl`
- JSON 路径：`errors.jsonl / owner_block_name`
- 作用域：`error`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- **key absent on all seven drawings**：七张 `out-thcad/<图>/` 的 JSON/JSONL 都没有这个键（抽取器可能写了 null，JsonUtil 会丢弃 null；或该类图元本批没有）。
- 计数：{"seen": 0}
- 观察结论：本键在现行七张 THCAD 抽取里不落地，工程上只能当「抽取器能力预留」或「本批图纸没有这类对象」。

## CAD 含义

errors.jsonl 字段 `owner_block_name`。抽取器在实体不是 Entity 或抛异常时写入。

公开资料：DrawingExtractor 错误记录：handle/owner_block_name/error/error_type

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

七张 errors.jsonl 都是 0 字节，key absent on all seven drawings。

### 与其他字段组合

将来若有 error，该 handle 不能进入几何校验。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
