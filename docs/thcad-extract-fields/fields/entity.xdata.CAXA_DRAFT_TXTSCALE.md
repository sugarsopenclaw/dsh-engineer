# 字段：CAXA_DRAFT_TXTSCALE

- **字段 ID**：`entity.xdata.CAXA_DRAFT_TXTSCALE`
- **JSON 路径**：`entities.jsonl / xdata.CAXA_DRAFT_TXTSCALE`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.CAXA_DRAFT_TXTSCALE`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 47}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=1DE00 AcDbText: [{"code":1041,"value":1}]`
  - `5TBC.384.A110050.1_1 h=1DE01 AcDbText: [{"code":1041,"value":1}]`
  - `5TBC.384.A110050.1_1 h=1DE02 AcDbText: [{"code":1041,"value":1}]`
  - `5TBC.384.A110050.1_1 h=1DE03 AcDbText: [{"code":1041,"value":1}]`
  - `5TBC.384.A110050.1_1 h=1DE04 AcDbText: [{"code":1041,"value":1}]`
  - `5TBC.384.A110050.1_1 h=1DE05 AcDbText: [{"code":1041,"value":1}]`

## CAD 含义

CAXA 电子图板流转痕迹。实测 Text 上 1041:1。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

只能证明这张 DWG 经过 CAXA，没有 CAXA 尺寸值。

### 与其他字段组合

与 GENIUS/MARUIYUN 一起做「多 CAD 血统」风险标记：写回必须在 THCAD，避免再降成 proxy。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
