# 字段：scale

- **字段 ID**：`entity.geometry.scale`
- **JSON 路径**：`entities.jsonl / geometry.scale`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.scale`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1498}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=2BC AcDbBlockReference: [1,1,1]`
  - `5TBC.384.A110050.1_1 h=72EE AcDbBlockReference: [1,1,1]`
  - `5TBC.384.A110050.1_1 h=72F5 AcDbBlockReference: [1,1,1]`
  - `5TBC.384.A110050.1_1 h=72F7 AcDbBlockReference: [-1,1,1]`
  - `5TBC.384.A110050.1_1 h=72F9 AcDbBlockReference: [-1,1,1]`
  - `5TBC.384.A110050.1_1 h=1A29D AcDbBlockReference: [1,1,1]`

## CAD 含义

块 XYZ 比例。

公开资料：AutoCAD BlockReference.ScaleFactors

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

不是 `title.比例` 出图比例。

### 与其他字段组合

重建插入变换；镜像可能出现负比例。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
