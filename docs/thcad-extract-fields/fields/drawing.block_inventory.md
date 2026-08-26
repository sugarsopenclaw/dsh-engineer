# 字段：block_inventory

- **字段 ID**：`drawing.block_inventory`
- **JSON 路径**：`drawing.json / block_inventory`
- **来源表/文件**：`drawing.json`
- **作用域**：`drawing`

## 实测观察

- 来源文件：`drawing.json`
- JSON 路径：`drawing.json / block_inventory`
- 作用域：`drawing`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7}
- 实测例子：
  - `5TBC.384.A110050.1_1 drawing.json: [{"name":"*Model_Space","handle":"1F","owner_scope":"model_space","is_layout":true,"is_anonymous":false,"is_from_xref":false,"xref_path":"","has_attribute_definitions":false,"enti…`
  - `5TBC.384.A110050.2_1 drawing.json: [{"name":"*Model_Space","handle":"1F","owner_scope":"model_space","is_layout":true,"is_anonymous":false,"is_from_xref":false,"xref_path":"","has_attribute_definitions":false,"enti…`
  - `5TBC.426.A110050.1_1 drawing.json: [{"name":"*Model_Space","handle":"1F","owner_scope":"model_space","is_layout":true,"is_anonymous":false,"is_from_xref":false,"xref_path":"","has_attribute_definitions":false,"enti…`
  - `5TBC.457.A110050.1_1 drawing.json: [{"name":"*Model_Space","handle":"1F","owner_scope":"model_space","is_layout":true,"is_anonymous":false,"is_from_xref":false,"xref_path":"","has_attribute_definitions":false,"enti…`
  - `5TBC.709.A110050.1_1 drawing.json: [{"name":"*Model_Space","handle":"1F","owner_scope":"model_space","is_layout":true,"is_anonymous":false,"is_from_xref":false,"xref_path":"","has_attribute_definitions":false,"enti…`
  - `5TBC.709.A110050.1_2 drawing.json: [{"name":"*Model_Space","handle":"1F","owner_scope":"model_space","is_layout":true,"is_anonymous":false,"is_from_xref":false,"xref_path":"","has_attribute_definitions":false,"enti…`

## CAD 含义

块清单一份拷贝，与 tables.blocks 相同。

公开资料：DumpTables

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

容器。

### 与其他字段组合

逐字段看 block.*。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
