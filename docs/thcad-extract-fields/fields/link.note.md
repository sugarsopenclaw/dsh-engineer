# 字段：note

- **字段 ID**：`link.note`
- **JSON 路径**：`xuhao-bom-links.json / note`
- **来源表/文件**：`xuhao-bom-links.json`
- **作用域**：`link`

## 实测观察

- 来源文件：`xuhao-bom-links.json`
- JSON 路径：`xuhao-bom-links.json / note`
- 作用域：`link`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：否（派生产物或仅数据中出现）
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.2_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.1_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1}
- 实测例子：
  - `5TBC.384.A110050.2_1 xuhao-bom-links.json: Parsed from named dictionary PC_BOMXHRELATEDIC keys already extracted. Key format seq#xuhaoHandleDecimal. No extra CAD API.`
- 附注：
  - xuhao-bom-links.json 是派生产物，DrawingExtractor.Extract 并不写这个文件；现行七张里只有试点图 5TBC.384.A110050.2_1 带这份文件。

## CAD 含义

说明：从 PC_BOMXHRELATEDIC 解析，无额外 CAD API。

公开资料：派生

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

方法学记录。

### 与其他字段组合

可复用于另外四张有明细的图。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
