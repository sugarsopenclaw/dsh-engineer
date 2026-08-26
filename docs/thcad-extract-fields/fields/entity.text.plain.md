# 字段：plain

- **字段 ID**：`entity.text.plain`
- **JSON 路径**：`entities.jsonl / text.plain`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.text`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / text.plain`
- 作用域：`entity.text`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 940}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=62F6 AcDbMText: 90`
  - `5TBC.384.A110050.1_1 h=62FB AcDbMText: 90`
  - `5TBC.384.A110050.1_1 h=D79F AcDbMText: 125`
  - `5TBC.384.A110050.1_1 h=1FC2 AcDbMText: 560`
  - `5TBC.384.A110050.1_1 h=1FD2 AcDbMText: 100`
  - `5TBC.384.A110050.1_1 h=1FE2 AcDbMText: 1620`

## CAD 含义

MText 纯文本。

公开资料：AutoCAD MText.Text

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

可读说明文字。

### 与其他字段组合

与图层、位置判断是技术要求还是重复的尺寸字。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
