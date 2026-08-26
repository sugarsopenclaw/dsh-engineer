# 字段：font_file

- **字段 ID**：`text_style.font_file`
- **JSON 路径**：`tables.json / text_styles[].font_file`
- **来源表/文件**：`tables.json`
- **作用域**：`text_style`

## 实测观察

- 来源文件：`tables.json`
- JSON 路径：`tables.json / text_styles[].font_file`
- 作用域：`text_style`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 46, "empty": 28}
- 实测例子：
  - `5TBC.384.A110050.1_1 text_style:Standard: arial.ttf`
  - `5TBC.384.A110050.1_1 text_style:DYN_DIM: arial.ttf`
  - `5TBC.384.A110050.1_1 text_style:Annotative: SimSun.ttf`
  - `5TBC.384.A110050.1_1 text_style:CHINESE: txt`
  - `5TBC.384.A110050.2_1 text_style:Standard: thenor.shx`
  - `5TBC.384.A110050.2_1 text_style:DYN_DIM: thenor.shx`
- 空值例子（图上没填或空串，不是漏抽）：
  - `5TBC.384.A110050.1_1 text_style:TH_GBDIM: `
  - `5TBC.384.A110050.1_1 text_style:PC_TEXTSTYLE: `
  - `5TBC.384.A110050.1_1 text_style:PC_TEXTSTYLE1: `
  - `5TBC.384.A110050.1_1 text_style:THXuHaoStyle: `

## CAD 含义

西文字体文件。本机缺天河库时 TH_GBDIM 为空。

公开资料：TextStyleTableRecord.FileName

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

空不表示没字。

### 与其他字段组合

不要因缺字体判图纸无效。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
