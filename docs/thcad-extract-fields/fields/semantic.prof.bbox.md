# 字段：bbox

- **字段 ID**：`semantic.prof.bbox`
- **JSON 路径**：`semantic-objects.json / prof[].bbox`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`semantic.prof`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / prof[].bbox`
- 作用域：`semantic.prof`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 272}
- 实测例子：
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:630D: ["min","max"]`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:630E: ["min","max"]`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:64A8: ["min","max"]`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:6F74: ["min","max"]`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:72EF: ["min","max"]`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:D793: ["min","max"]`

## CAD 含义

包围盒。点不到内部锚点时用框。

公开资料：Entity.GeometricExtents 是 WCS 轴对齐包围盒（https://help.autodesk.com/view/OARX/2026/ENU/?guid=OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Entity_GeometricExtents）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

空间索引。

### 与其他字段组合

点气泡找附近轮廓。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
