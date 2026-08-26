# 字段：AcDbBlockRepETag

- **字段 ID**：`entity.xdata.AcDbBlockRepETag`
- **JSON 路径**：`entities.jsonl / xdata.AcDbBlockRepETag`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.AcDbBlockRepETag`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 20319}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=6F64 AcDbLine: [{"code":1070,"value":1},{"code":1071,"value":8},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=6F65 AcDbLine: [{"code":1070,"value":1},{"code":1071,"value":9},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=6F66 AcDbLine: [{"code":1070,"value":1},{"code":1071,"value":12},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=30253 AcDbLine: [{"code":1070,"value":1},{"code":1071,"value":93},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=30254 AcDbLine: [{"code":1070,"value":1},{"code":1071,"value":94},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=30255 AcDbLine: [{"code":1070,"value":1},{"code":1071,"value":0},{"code":1005,"value":"0"}]`

## CAD 含义

AutoCAD 动态块替换标记的近亲（公开讨论多见 AcDbBlockRepBTag，ETag 无官方字段文档）。XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

公开资料：https://github.com/haplokuon/netDxf/discussions/340 （BTag 类比；ETag 仍无官方说明）

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

本批图大量普通 Line 也带 1070/1071/1005:"0"，不能据此判断动态块。

### 与其他字段组合

不要当块名或零件代号。块身份用 `entity.geometry.block_name` + `block.name`。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
