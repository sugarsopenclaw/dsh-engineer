# 字段：重量

- **字段 ID**：`title.重量`
- **JSON 路径**：`semantic-objects.json / title_blocks[].fields.重量`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`title.fields`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / title_blocks[].fields.重量`
- 作用域：`title.fields`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7, "empty": 6}
- 实测例子：
  - `8TBC.312.A110050.101_1 title:4A19: 1103`
- 空值例子（图上没填或空串，不是漏抽）：
  - `5TBC.384.A110050.1_1 title:445CD: `
  - `5TBC.384.A110050.2_1 title:438F: `
  - `5TBC.426.A110050.1_1 title:A624: `
  - `5TBC.457.A110050.1_1 title:7E13: `

## CAD 含义

标题栏重量格。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

装配图六张全空；零件图 `8TBC.312.A110050.101_1` 为 `1103`。

### 与其他字段组合

不能汇总整台变压器重量。若要质量校核，只能和 `bom.总重`（本批也空）以及外部 ERP 组合；现在大多不能支撑。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
