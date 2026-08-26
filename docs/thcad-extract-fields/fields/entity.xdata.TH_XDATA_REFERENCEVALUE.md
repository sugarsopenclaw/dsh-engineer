# 字段：TH_XDATA_REFERENCEVALUE

- **字段 ID**：`entity.xdata.TH_XDATA_REFERENCEVALUE`
- **JSON 路径**：`entities.jsonl / xdata.TH_XDATA_REFERENCEVALUE`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.TH_XDATA_REFERENCEVALUE`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 210}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=44563 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=44564 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=44565 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=44566 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=44567 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":""}]`
  - `5TBC.384.A110050.1_1 h=44568 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":""}]`

## CAD 含义

属性参考值槽。实测空串。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

空。

### 与其他字段组合

现在不能当默认代号或材料。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
