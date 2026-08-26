# 字段：min

- **字段 ID**：`entity.bbox.min`
- **JSON 路径**：`entities.jsonl / bbox.min`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.bbox`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / bbox.min`
- 作用域：`entity.bbox`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 91104}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=616D AcDbText: [14204.866266957697,11230.995415938703,0]`
  - `5TBC.384.A110050.1_1 h=616E AcDbText: [13770.288877598838,10972.546531547914,0]`
  - `5TBC.384.A110050.1_1 h=616F AcDbText: [13765.406394994736,10847.546531547914,0]`
  - `5TBC.384.A110050.1_1 h=6170 AcDbText: [13765.69713240354,10722.546531547914,0]`
  - `5TBC.384.A110050.1_1 h=6171 AcDbText: [13765.9559455532,10478.427412428795,0]`
  - `5TBC.384.A110050.1_1 h=6172 AcDbText: [13766.318507129567,10347.797577018038,0]`

## CAD 含义

Entity.GeometricExtents 是 WCS 轴对齐包围盒（https://help.autodesk.com/view/OARX/2026/ENU/?guid=OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Entity_GeometricExtents）。 部分对象（如许多 AcDbPoint）没有 bbox。

公开资料：Entity.GeometricExtents 是 WCS 轴对齐包围盒（https://help.autodesk.com/view/OARX/2026/ENU/?guid=OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Entity_GeometricExtents）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

最小角点可定位对象邻域。

### 与其他字段组合

与 max 组成框，给序号/引出/标题栏做空间索引；点对象无 bbox 时不能用。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
