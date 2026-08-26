# 字段：text

- **字段 ID**：`entity.text`
- **JSON 路径**：`entities.jsonl / text`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / text`
- 作用域：`entity`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 3218, "string_values": 1535, "empty": 316}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=616D AcDbText: 技术要求 `
  - `5TBC.384.A110050.1_1 h=616E AcDbText: 1.油箱内、外部涂漆按工艺标准执行; `
  - `5TBC.384.A110050.1_1 h=616F AcDbText: 2.油箱真空度133Pa,正压100kPa; `
  - `5TBC.384.A110050.1_1 h=6170 AcDbText: 3.油箱抽真空时内部加临时支撑; `
  - `5TBC.384.A110050.1_1 h=6171 AcDbText: 5.金属切割面及焊后突起焊线均须打磨光滑; `
  - `5TBC.384.A110050.1_1 h=6172 AcDbText: 7.接地座与其他组部件配焊; `
- 空值例子（图上没填或空串，不是漏抽）：
  - `5TBC.384.A110050.1_1 h=17215 AcDbText: `
  - `5TBC.384.A110050.1_1 h=446D3 AcDbAttributeDefinition: `
  - `5TBC.384.A110050.1_1 h=446D6 AcDbAttributeDefinition: `
  - `5TBC.384.A110050.1_1 h=446D7 AcDbAttributeDefinition: `

## CAD 含义

文字。DBText 为字符串；MText/尺寸为对象；无线则 JSON 省略。

公开资料：TextOf

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

单行字可直接读。

### 与其他字段组合

尺寸要读 text.measurement 与 dimension_text；attDef 的 text 常是空串。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
