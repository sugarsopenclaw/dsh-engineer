# 字段：PC_MXBTITLERECORD

- **字段 ID**：`entity.xdata.PC_MXBTITLERECORD`
- **JSON 路径**：`entities.jsonl / xdata.PC_MXBTITLERECORD`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.PC_MXBTITLERECORD`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_2`
- 这些图纸上未出现该键：`5TBC.709.A110050.1_1`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 5}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=4CC99 AcDbBlockReference: [{"code":1070,"value":1},{"code":1005,"value":"4CC99"}]`
  - `5TBC.384.A110050.2_1 h=456A AcDbBlockReference: [{"code":1070,"value":1},{"code":1005,"value":"456A"}]`
  - `5TBC.426.A110050.1_1 h=A7FF AcDbBlockReference: [{"code":1070,"value":1},{"code":1005,"value":"A7FF"}]`
  - `5TBC.457.A110050.1_1 h=26C3E AcDbBlockReference: [{"code":1070,"value":1},{"code":1005,"value":"26C3E"}]`
  - `5TBC.709.A110050.1_2 h=712F AcDbBlockReference: [{"code":1070,"value":1},{"code":1005,"value":"712F"}]`

## CAD 含义

明细表表头块上的 PCCAD 包。实测 1070:1 与 1005 自指 handle。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

不能当表头文字。

### 与其他字段组合

与 `semantic.pc.block_name=PC_MXBTITLERECORD` 一起确认「这张图有明细表表头实例」（709.1_1 没有）。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
