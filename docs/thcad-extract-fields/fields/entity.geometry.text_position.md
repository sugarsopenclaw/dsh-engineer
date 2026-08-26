# 字段：text_position

- **字段 ID**：`entity.geometry.text_position`
- **JSON 路径**：`entities.jsonl / geometry.text_position`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.text_position`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 743}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=62FE AcDbRotatedDimension: [11168.497595841867,10909.606353882338,0]`
  - `5TBC.384.A110050.1_1 h=6F70 AcDbAlignedDimension: [619.7672884145084,1173.6587296066004,0]`
  - `5TBC.384.A110050.1_1 h=7326 AcDbRotatedDimension: [3125.9751707067544,390.1494665189007,0]`
  - `5TBC.384.A110050.1_1 h=7329 AcDbRotatedDimension: [2651.52779359249,390.149466518904,0]`
  - `5TBC.384.A110050.1_1 h=732C AcDbRotatedDimension: [3432.4751707067617,390.1494665189007,0]`
  - `5TBC.384.A110050.1_1 h=732F AcDbRotatedDimension: [3906.9225478210337,390.1494665189008,0]`

## CAD 含义

尺寸文字位置。

公开资料：AutoCAD Dimension.TextPosition

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

可定位尺寸数字，不是被测边。

### 与其他字段组合

去标注删除尺寸实体时用；不要当孔坐标。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
