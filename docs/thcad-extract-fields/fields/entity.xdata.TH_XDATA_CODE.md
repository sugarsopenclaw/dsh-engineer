# 字段：TH_XDATA_CODE

- **字段 ID**：`entity.xdata.TH_XDATA_CODE`
- **JSON 路径**：`entities.jsonl / xdata.TH_XDATA_CODE`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.TH_XDATA_CODE`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 301}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=446D3 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"Material"}]`
  - `5TBC.384.A110050.1_1 h=446D6 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"Name"}]`
  - `5TBC.384.A110050.1_1 h=446D7 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"Code"}]`
  - `5TBC.384.A110050.1_1 h=446D8 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"Order"}]`
  - `5TBC.384.A110050.1_1 h=446DC AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"Quantity"}]`
  - `5TBC.384.A110050.1_1 h=446DF AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1000,"value":"TotalWeight"}]`

## CAD 含义

挂在标题栏/明细属性定义上的逻辑字段码。实测 1000 组有 `Material`/`Name`/`Code`/`PageNo`/`Scale`/`Type`/`Weight`。XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

单独是英文字段码，不是中文格子值。

### 与其他字段组合

必须与 `entity.attributes.tag`（中文 tag：材料/名称/代号…）或 `title.*` / `bom.*` 对照，用来理解 PCCAD 内部码与中文格子的映射。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
