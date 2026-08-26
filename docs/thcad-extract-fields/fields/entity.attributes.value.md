# 字段：value

- **字段 ID**：`entity.attributes.value`
- **JSON 路径**：`entities.jsonl / attributes[].value`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.attributes`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / attributes[].value`
- 作用域：`entity.attributes`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1902, "empty": 974}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 1:20`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 1`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 5TBC.384.A110050.1`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: 上节油箱`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: SZ-63000/110`
  - `5TBC.384.A110050.1_1 h=446A0 AcDbBlockReference: 5TBC.384.A110050.1`
- 空值例子（图上没填或空串，不是漏抽）：
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: `
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: `
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: `
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: `

## CAD 含义

属性文字值。空串表示图上没填。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

直接就是格子内容。

### 与其他字段组合

按 tag 分流到标题栏或明细；空值要保留以区分漏抽。

## 工程可用性判定

**判定：单独可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
