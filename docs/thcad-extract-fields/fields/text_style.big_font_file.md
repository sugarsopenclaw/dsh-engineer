# 字段：big_font_file

- **字段 ID**：`text_style.big_font_file`
- **JSON 路径**：`tables.json / text_styles[].big_font_file`
- **来源表/文件**：`tables.json`
- **作用域**：`text_style`

## 实测观察

- 来源文件：`tables.json`
- JSON 路径：`tables.json / text_styles[].big_font_file`
- 作用域：`text_style`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 46, "empty": 33}
- 实测例子：
  - `5TBC.384.A110050.1_1 text_style:CHINESE: hztxt`
  - `5TBC.384.A110050.2_1 text_style:Standard: hzfs.shx`
  - `5TBC.384.A110050.2_1 text_style:DYN_DIM: hzfs.shx`
  - `5TBC.426.A110050.1_1 text_style:Standard: hzfs.shx`
  - `5TBC.426.A110050.1_1 text_style:DYN_DIM: hzfs.shx`
  - `5TBC.426.A110050.1_1 text_style:CHINESE: hztxt`
- 空值例子（图上没填或空串，不是漏抽）：
  - `5TBC.384.A110050.1_1 text_style:Standard: `
  - `5TBC.384.A110050.1_1 text_style:TH_GBDIM: `
  - `5TBC.384.A110050.1_1 text_style:PC_TEXTSTYLE: `
  - `5TBC.384.A110050.1_1 text_style:PC_TEXTSTYLE1: `

## CAD 含义

大字体（中文）如 hzfs.shx。

公开资料：TextStyleTableRecord.BigFontFileName

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

中文显示。

### 与其他字段组合

同 font_file。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
