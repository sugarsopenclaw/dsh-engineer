# 字段：HATCHBACKGROUNDCOLOR

- **字段 ID**：`entity.xdata.HATCHBACKGROUNDCOLOR`
- **JSON 路径**：`entities.jsonl / xdata.HATCHBACKGROUNDCOLOR`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.HATCHBACKGROUNDCOLOR`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 235}
- 实测例子：
  - `5TBC.384.A110050.2_1 h=B57 AcDbHatch: [{"code":1071,"value":-939524096},{"code":1000,"value":""},{"code":1000,"value":""}]`
  - `5TBC.426.A110050.1_1 h=11BC AcDbHatch: [{"code":1071,"value":-939524096},{"code":1000,"value":""},{"code":1000,"value":""}]`
  - `5TBC.426.A110050.1_1 h=11C3 AcDbHatch: [{"code":1071,"value":-939524096},{"code":1000,"value":""},{"code":1000,"value":""}]`
  - `5TBC.426.A110050.1_1 h=1485 AcDbHatch: [{"code":1071,"value":-939524096},{"code":1000,"value":""},{"code":1000,"value":""}]`
  - `5TBC.426.A110050.1_1 h=1488 AcDbHatch: [{"code":1071,"value":-939524096},{"code":1000,"value":""},{"code":1000,"value":""}]`
  - `5TBC.426.A110050.1_1 h=56E2 AcDbLine: [{"code":1071,"value":-939524096},{"code":1000,"value":""},{"code":1000,"value":""}]`

## CAD 含义

填充背景色。实测在 Hatch 上。

公开资料：XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

颜色整数，不是剖面材料。

### 与其他字段组合

去标注时 Hatch 本就常作标注/剖面符号；材料仍看 `bom.材料`（本批多为空）。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
