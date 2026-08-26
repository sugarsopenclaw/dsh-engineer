# 字段：linetype

- **字段 ID**：`layer.linetype`
- **JSON 路径**：`tables.json / layers[].linetype`
- **来源表/文件**：`tables.json`
- **作用域**：`layer`

## 实测观察

- 来源文件：`tables.json`
- JSON 路径：`tables.json / layers[].linetype`
- 作用域：`layer`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 335}
- 实测例子：
  - `5TBC.384.A110050.1_1 layer:0: Continuous`
  - `5TBC.384.A110050.1_1 layer:Defpoints: Continuous`
  - `5TBC.384.A110050.1_1 layer:1轮廓实线层: Continuous`
  - `5TBC.384.A110050.1_1 layer:轮廓虚线层: DASHED`
  - `5TBC.384.A110050.1_1 layer:3中心线层: CENTER`
  - `5TBC.384.A110050.1_1 layer:4虚线层: DASHED`

## CAD 含义

层缺省线型。3中心线层=CENTER。

公开资料：LayerTableRecord.Linetype

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

中心线层提示。

### 与其他字段组合

实体可能覆盖线型，要用 entity.linetype。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
