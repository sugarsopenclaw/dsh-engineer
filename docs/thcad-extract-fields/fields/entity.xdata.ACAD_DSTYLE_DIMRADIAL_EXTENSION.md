# 字段：ACAD_DSTYLE_DIMRADIAL_EXTENSION

- **字段 ID**：`entity.xdata.ACAD_DSTYLE_DIMRADIAL_EXTENSION`
- **JSON 路径**：`entities.jsonl / xdata.ACAD_DSTYLE_DIMRADIAL_EXTENSION`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.ACAD_DSTYLE_DIMRADIAL_EXTENSION`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.2_1`、`5TBC.709.A110050.1_1`、`8TBC.312.A110050.101_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.1_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_2`
- 计数：{"seen": 5}
- 实测例子：
  - `5TBC.384.A110050.2_1 h=5201 AcDbDiametricDimension: [{"code":1070,"value":387},{"code":1070,"value":1},{"code":1070,"value":388},{"code":1040,"value":3.141592653589793},{"code":1070,"value":390},{"code":1040,"value":7.8539816339744…`
  - `5TBC.709.A110050.1_1 h=7A0D AcDbDiametricDimension: [{"code":1070,"value":387},{"code":1070,"value":1},{"code":1070,"value":388},{"code":1040,"value":3.141592653589793},{"code":1070,"value":390},{"code":1040,"value":1.5707963267948…`
  - `5TBC.709.A110050.1_1 h=7A5E AcDbDiametricDimension: [{"code":1070,"value":387},{"code":1070,"value":1},{"code":1070,"value":388},{"code":1040,"value":0},{"code":1070,"value":390},{"code":1040,"value":0}]`
  - `5TBC.709.A110050.1_1 h=7A61 AcDbDiametricDimension: [{"code":1070,"value":387},{"code":1070,"value":1},{"code":1070,"value":388},{"code":1040,"value":0},{"code":1070,"value":390},{"code":1040,"value":0}]`
  - `8TBC.312.A110050.101_1 h=F12 AcDbDiametricDimension: [{"code":1070,"value":387},{"code":1070,"value":1},{"code":1070,"value":388},{"code":1040,"value":3.141592653589793},{"code":1070,"value":390},{"code":1040,"value":6.2831853071795…`

## CAD 含义

半径/直径标注样式扩展。实测在 `AcDbDiametricDimension` handle `5201`。

公开资料：XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

不是直径数值（数值在 `text.measurement`）。

### 与其他字段组合

与 `entity.geometry.kind=dimension` 组合只说明这是带径向扩展的尺寸对象，供去标注分类。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
