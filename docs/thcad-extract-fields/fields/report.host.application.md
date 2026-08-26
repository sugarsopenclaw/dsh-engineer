# 字段：application

- **字段 ID**：`report.host.application`
- **JSON 路径**：`extraction-report.json / host.application`
- **来源表/文件**：`extraction-report.json`
- **作用域**：`report.host`

## 实测观察

- 来源文件：`extraction-report.json`
- JSON 路径：`extraction-report.json / host.application`
- 作用域：`report.host`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7}
- 实测例子：
  - `5TBC.384.A110050.1_1 host: THCAD`
  - `5TBC.384.A110050.2_1 host: THCAD`
  - `5TBC.426.A110050.1_1 host: THCAD`
  - `5TBC.457.A110050.1_1 host: THCAD`
  - `5TBC.709.A110050.1_1 host: THCAD`
  - `5TBC.709.A110050.1_2 host: THCAD`

## CAD 含义

宿主名，固定 THCAD。

公开资料：DrawingExtractor.HostInfo

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

确认抽取侧是天河不是 AutoCAD。

### 与其他字段组合

与底座选型一致：写图必须 TH 侧。

## 工程可用性判定

**判定：单独可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
