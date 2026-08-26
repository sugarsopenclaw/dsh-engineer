# 字段：pattern

- **字段 ID**：`entity.geometry.pattern`
- **JSON 路径**：`entities.jsonl / geometry.pattern`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.pattern`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 192}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=6F5F AcDbHatch: AR-CONC`
  - `5TBC.384.A110050.1_1 h=3ECB AcDbHatch: ANSI31`
  - `5TBC.384.A110050.1_1 h=4E13 AcDbHatch: ANSI31`
  - `5TBC.384.A110050.1_1 h=4E1C AcDbHatch: ANSI31`
  - `5TBC.384.A110050.1_1 h=4E1D AcDbHatch: ANSI31`
  - `5TBC.384.A110050.1_1 h=A166 AcDbHatch: SOLID`

## CAD 含义

填充图案名。

公开资料：AutoCAD Hatch.PatternName

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

ANSI31 等是剖面符号，不是材料牌号。

### 与其他字段组合

去标注：hatch 默认进标注/符号桶；边界环点列未抽（字段目录已写明）。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
