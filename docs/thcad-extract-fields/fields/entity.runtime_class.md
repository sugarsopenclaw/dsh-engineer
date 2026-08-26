# 字段：runtime_class

- **字段 ID**：`entity.runtime_class`
- **JSON 路径**：`entities.jsonl / runtime_class`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / runtime_class`
- 作用域：`entity`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 91605}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=2BC AcDbBlockReference: AcDbBlockReference`
  - `5TBC.384.A110050.1_1 h=616D AcDbText: AcDbText`
  - `5TBC.384.A110050.1_1 h=616E AcDbText: AcDbText`
  - `5TBC.384.A110050.1_1 h=616F AcDbText: AcDbText`
  - `5TBC.384.A110050.1_1 h=6170 AcDbText: AcDbText`
  - `5TBC.384.A110050.1_1 h=6171 AcDbText: AcDbText`

## CAD 含义

RX 类名。TH 侧专业对象已是真名。

公开资料：GetRXClass().Name

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

去标注主开关：TH_XuHaoEntity/TH_DimLeaderUA/TH_ParaBasePntUA/TH_DimRough*/TH_CVArrowLine 及 AcDb*Dimension/Leader/MText 进标注桶。

### 与其他字段组合

叠加 layer、geometry.kind、owner_scope：标注层上的 Line 仍可能是尺寸界线，要用规则组合而不是单字段。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
