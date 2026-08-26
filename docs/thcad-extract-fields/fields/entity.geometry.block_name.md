# 字段：block_name

- **字段 ID**：`entity.geometry.block_name`
- **JSON 路径**：`entities.jsonl / geometry.block_name`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.block_name`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1498}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=2BC AcDbBlockReference: PCCAD_TEMPLATE`
  - `5TBC.384.A110050.1_1 h=72EE AcDbBlockReference: A$C636B85B3`
  - `5TBC.384.A110050.1_1 h=72F5 AcDbBlockReference: A$C636B85B3`
  - `5TBC.384.A110050.1_1 h=72F7 AcDbBlockReference: A$C636B85B3`
  - `5TBC.384.A110050.1_1 h=72F9 AcDbBlockReference: A$C636B85B3`
  - `5TBC.384.A110050.1_1 h=1A29D AcDbBlockReference: MYX10141`

## CAD 含义

块参照名。PC_TITLE_BLOCK / PC_MXB_BLOCK 是机械语义入口。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

见到 PC_TITLE_BLOCK 就能知道这是标题栏实例（七张各 1 个）。

### 与其他字段组合

与 attributes.tag 组合成标题栏/明细字段；MYX* 是零件块，*Dnn 是标注匿名块（去标注可整块丢掉）。

## 工程可用性判定

**判定：单独可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
