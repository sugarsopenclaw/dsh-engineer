# 字段：position

- **字段 ID**：`entity.attributes.position`
- **JSON 路径**：`entities.jsonl / attributes[].position`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.attributes`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / attributes[].position`
- 作用域：`entity.attributes`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1902}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: [12620,1010,0]`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: [12820,1010,0]`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: [13060,1010,0]`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: [13380,1010,0]`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: [13680,1010,0]`
  - `5TBC.384.A110050.1_1 h=445CD AcDbBlockReference: [13960,1010,0]`

## CAD 含义

属性插入点。

公开资料：AutoCAD AttributeReference.Position

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

可把格子排成表。

### 与其他字段组合

明细行 y 递增（试点图 x=16120，y 每行 +140）可校验行序是否与 `bom.序号` 一致。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
