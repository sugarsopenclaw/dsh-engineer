# 字段：ACAD

- **字段 ID**：`entity.xdata.ACAD`
- **JSON 路径**：`entities.jsonl / xdata.ACAD`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.ACAD`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1779}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=630D TH_DimLeaderUA: [{"code":1000,"value":"DSTYLE"},{"code":1002,"value":"{"},{"code":1070,"value":176},{"code":1070,"value":130},{"code":1070,"value":140},{"code":1040,"value":3.5},{"code":1070,"val…`
  - `5TBC.384.A110050.1_1 h=630E TH_DimLeaderUA: [{"code":1000,"value":"DSTYLE"},{"code":1002,"value":"{"},{"code":1070,"value":176},{"code":1070,"value":130},{"code":1070,"value":140},{"code":1040,"value":3.5},{"code":1070,"val…`
  - `5TBC.384.A110050.1_1 h=64A8 TH_DimLeaderUA: [{"code":1000,"value":"DSTYLE"},{"code":1002,"value":"{"},{"code":1070,"value":176},{"code":1070,"value":130},{"code":1070,"value":140},{"code":1040,"value":3.5},{"code":1070,"val…`
  - `5TBC.384.A110050.1_1 h=6F5F AcDbHatch: [{"code":1010,"value":[0,0,0]}]`
  - `5TBC.384.A110050.1_1 h=6F70 AcDbAlignedDimension: [{"code":1000,"value":"DSTYLE"},{"code":1002,"value":"{"},{"code":1070,"value":271},{"code":1070,"value":1},{"code":1070,"value":282},{"code":1070,"value":0},{"code":1070,"value":…`
  - `5TBC.384.A110050.1_1 h=72EF TH_DimLeaderUA: [{"code":1000,"value":"DSTYLE"},{"code":1002,"value":"{"},{"code":1070,"value":176},{"code":1070,"value":130},{"code":1070,"value":140},{"code":1040,"value":3.5},{"code":1070,"val…`

## CAD 含义

通用 ACAD 扩展包，引出/标注上常见 DSTYLE 样式覆盖。

公开资料：XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

TypedValue 是 DIM 变量碎片，本抽取没有 DIM 样式表深字段，单独还原不出箭头和精度。

### 与其他字段组合

与 `entity.geometry.dim_style` 只能对上样式名；去标注认引出靠 `runtime_class=TH_DimLeaderUA` 更直接。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
