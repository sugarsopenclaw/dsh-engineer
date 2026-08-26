# 字段：radius

- **字段 ID**：`entity.geometry.radius`
- **JSON 路径**：`entities.jsonl / geometry.radius`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.radius`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 16172}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=7300 AcDbArc: 24.000000000002025`
  - `5TBC.384.A110050.1_1 h=7302 AcDbArc: 23.999999999999453`
  - `5TBC.384.A110050.1_1 h=7304 AcDbArc: 23.99999999999509`
  - `5TBC.384.A110050.1_1 h=7306 AcDbArc: 24.00000000000423`
  - `5TBC.384.A110050.1_1 h=7308 AcDbArc: 20.000000000001688`
  - `5TBC.384.A110050.1_1 h=730A AcDbArc: 19.999999999999115`

## CAD 含义

圆/弧半径，绘图单位。

公开资料：AutoCAD Circle.Radius

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

是几何半径，不一定等于标注的 R 值。

### 与其他字段组合

与 `text.measurement`（径向标注）比对；`title.比例` 只是出图比例，模型空间半径通常已是 1:1 毫米（本批 insunits=Undefined，需约定）。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
