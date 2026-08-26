# 字段：invisible

- **字段 ID**：`entity.attributes.invisible`
- **JSON 路径**：`entities.jsonl / attributes[].invisible`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.attributes`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / attributes[].invisible`
- 作用域：`entity.attributes`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1902}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=44635 AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=446A0 AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=4CCA4 AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=4CCAE AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=4CCB8 AcDbBlockReference: False`

## CAD 含义

属性是否不可见。PCCAD 有「隐藏字段显示出来了」类问题（官网 FAQ）。

公开资料：https://www.thcad.net/ （标题栏/明细隐藏字段 FAQ）

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

不可见属性仍可能有值。

### 与其他字段组合

导出 BOM 应包含 invisible 格子，但去标注不必把可见性当删除依据。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
