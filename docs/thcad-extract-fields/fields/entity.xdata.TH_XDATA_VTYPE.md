# 字段：TH_XDATA_VTYPE

- **字段 ID**：`entity.xdata.TH_XDATA_VTYPE`
- **JSON 路径**：`entities.jsonl / xdata.TH_XDATA_VTYPE`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.TH_XDATA_VTYPE`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 301}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=446D3 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"String"},{"code":1070,"value":2},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=446D6 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"String"},{"code":1070,"value":2},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=446D7 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"String"},{"code":1070,"value":2},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=446D8 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"String"},{"code":1070,"value":2},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=446DC AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"Number"},{"code":1070,"value":2},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=446DF AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"Number"},{"code":1070,"value":2},{"code":1000,"value":"2"}]`

## CAD 含义

属性值类型。实测 `String`。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

只能知道格子按字符串存，不能得到工程值。

### 与其他字段组合

与 `TH_XDATA_CODE` 组合可做类型校验；沈变 BOM 取值仍看 `bom.*`。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
