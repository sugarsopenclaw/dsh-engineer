# 字段：measurement

- **字段 ID**：`entity.text.measurement`
- **JSON 路径**：`entities.jsonl / text.measurement`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.text`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / text.measurement`
- 作用域：`entity.text`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 743}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=62FE AcDbRotatedDimension: 175`
  - `5TBC.384.A110050.1_1 h=6F70 AcDbAlignedDimension: 219.80970388603046`
  - `5TBC.384.A110050.1_1 h=7326 AcDbRotatedDimension: 306.4999999999982`
  - `5TBC.384.A110050.1_1 h=7329 AcDbRotatedDimension: 642.3947542285387`
  - `5TBC.384.A110050.1_1 h=732C AcDbRotatedDimension: 306.50000000001273`
  - `5TBC.384.A110050.1_1 h=732F AcDbRotatedDimension: 642.3947542285382`

## CAD 含义

尺寸测量值，与 geometry.measurement 同义重复一份。

公开资料：Dimension.DimensionText 非空表示文字覆盖；空串才显示 Measurement（https://help.autodesk.com/view/OARX/2024/ENU?guid=OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Dimension）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

真实长度/角度（CAD 单位）。

### 与其他字段组合

与 dimension_text、以及对应边 geometry 长度三联校验。insunits=Undefined，需约定 1 单位=1 mm。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
