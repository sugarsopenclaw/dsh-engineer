# 字段：dim_style

- **字段 ID**：`entity.geometry.dim_style`
- **JSON 路径**：`entities.jsonl / geometry.dim_style`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.dim_style`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 743}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=62FE AcDbRotatedDimension: TH_GBDIM`
  - `5TBC.384.A110050.1_1 h=6F70 AcDbAlignedDimension: TH_GBDIM$0`
  - `5TBC.384.A110050.1_1 h=7326 AcDbRotatedDimension: TH_GBDIM$0`
  - `5TBC.384.A110050.1_1 h=7329 AcDbRotatedDimension: TH_GBDIM$0`
  - `5TBC.384.A110050.1_1 h=732C AcDbRotatedDimension: TH_GBDIM$0`
  - `5TBC.384.A110050.1_1 h=732F AcDbRotatedDimension: TH_GBDIM$0`

## CAD 含义

尺寸样式名。实测 TH_GBDIM 等。

公开资料：AutoCAD Dimension.DimensionStyleName

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

名称级，无箭头/精度。

### 与其他字段组合

与 `dim_style.name` 表对照；精度仍未知，不能用样式名代替公差。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
