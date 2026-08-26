# 字段：tag

- **字段 ID**：`entity.attributes.tag`
- **JSON 路径**：`entities.jsonl / attributes[].tag`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.attributes`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / attributes[].tag`
- 作用域：`entity.attributes`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1902}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 改版标记3`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 处数3`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 改版分区3`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 更改文件号3`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 改版签名3`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 改版日期3`

## CAD 含义

属性标签。中文 tag 即 `产品型号`/`序号`/`代号` 等。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

tag 是字段名，值在 value。

### 与其他字段组合

SemanticBlock 靠 tag 聚合成 title.* / bom.*。这是机械三张表的来源。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
