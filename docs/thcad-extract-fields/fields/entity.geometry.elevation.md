# 字段：elevation

- **字段 ID**：`entity.geometry.elevation`
- **JSON 路径**：`entities.jsonl / geometry.elevation`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.elevation`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`
- 这些图纸上未出现该键：`8TBC.312.A110050.101_1`
- 计数：{"seen": 806}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=62E9 AcDbPolyline: 0`
  - `5TBC.384.A110050.1_1 h=62EA AcDbPolyline: 0`
  - `5TBC.384.A110050.1_1 h=62EB AcDbPolyline: 0`
  - `5TBC.384.A110050.1_1 h=62EF AcDbPolyline: 0`
  - `5TBC.384.A110050.1_1 h=62F0 AcDbPolyline: 0`
  - `5TBC.384.A110050.1_1 h=62F1 AcDbPolyline: 0`

## CAD 含义

二维多段线高程。

公开资料：AutoCAD Polyline.Elevation

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

Z 向偏移，本批二维图通常为 0。

### 与其他字段组合

非零时要小心「看起来重合、实际不在一平面」——与铁芯错位无关，先当数据质量问题。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
