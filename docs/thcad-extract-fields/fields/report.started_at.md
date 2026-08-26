# 字段：started_at

- **字段 ID**：`report.started_at`
- **JSON 路径**：`extraction-report.json / started_at`
- **来源表/文件**：`extraction-report.json`
- **作用域**：`report`

## 实测观察

- 来源文件：`extraction-report.json`
- JSON 路径：`extraction-report.json / started_at`
- 作用域：`report`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7}
- 实测例子：
  - `5TBC.384.A110050.1_1 extraction-report.json: 2026-08-25T05:32:24.7287224Z`
  - `5TBC.384.A110050.2_1 extraction-report.json: 2026-08-25T06:46:42.4610150Z`
  - `5TBC.426.A110050.1_1 extraction-report.json: 2026-08-25T05:32:27.2778210Z`
  - `5TBC.457.A110050.1_1 extraction-report.json: 2026-08-25T05:32:28.5125055Z`
  - `5TBC.709.A110050.1_1 extraction-report.json: 2026-08-25T05:32:29.6242743Z`
  - `5TBC.709.A110050.1_2 extraction-report.json: 2026-08-25T05:32:30.6630077Z`

## CAD 含义

抽取开始 UTC。

公开资料：DateTime.UtcNow

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

审计。

### 与其他字段组合

无产品。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
