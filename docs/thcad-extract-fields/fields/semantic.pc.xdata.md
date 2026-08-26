# 字段：xdata

- **字段 ID**：`semantic.pc.xdata`
- **JSON 路径**：`semantic-objects.json / pc[].xdata`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`semantic.pc`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / pc[].xdata`
- 作用域：`semantic.pc`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_2`
- 这些图纸上未出现该键：`5TBC.709.A110050.1_1`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 5}
- 实测例子：
  - `5TBC.384.A110050.1_1 pc:PC_MXBTITLERECORD:4CC99: {"PC_MXBTITLERECORD":[{"code":1070,"value":1},{"code":1005,"value":"4CC99"}]}`
  - `5TBC.384.A110050.2_1 pc:PC_MXBTITLERECORD:456A: {"PC_MXBTITLERECORD":[{"code":1070,"value":1},{"code":1005,"value":"456A"}]}`
  - `5TBC.426.A110050.1_1 pc:PC_MXBTITLERECORD:A7FF: {"PC_MXBTITLERECORD":[{"code":1070,"value":1},{"code":1005,"value":"A7FF"}]}`
  - `5TBC.457.A110050.1_1 pc:PC_MXBTITLERECORD:26C3E: {"PC_MXBTITLERECORD":[{"code":1070,"value":1},{"code":1005,"value":"26C3E"}]}`
  - `5TBC.709.A110050.1_2 pc:PC_MXBTITLERECORD:712F: {"PC_MXBTITLERECORD":[{"code":1070,"value":1},{"code":1005,"value":"712F"}]}`

## CAD 含义

块上的 XData。标题栏记录常省略（null 被 JSON 丢掉）；明细行有 TH_XUHAO。

公开资料：XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

有则带序号。

### 与其他字段组合

见 entity.xdata.TH_XUHAO。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
