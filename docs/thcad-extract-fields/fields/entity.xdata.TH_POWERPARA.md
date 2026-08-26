# 字段：TH_POWERPARA

- **字段 ID**：`entity.xdata.TH_POWERPARA`
- **JSON 路径**：`entities.jsonl / xdata.TH_POWERPARA`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.TH_POWERPARA`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`
- 这些图纸上未出现该键：`8TBC.312.A110050.101_1`
- 计数：{"seen": 4037}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=18C3 AcDbLine: [{"code":1070,"value":1001},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=18C4 AcDbLine: [{"code":1070,"value":1001},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=18C5 AcDbLine: [{"code":1070,"value":1001},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=18C6 AcDbLine: [{"code":1070,"value":1001},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=18C7 AcDbLine: [{"code":1070,"value":1001},{"code":1005,"value":"0"}]`
  - `5TBC.384.A110050.1_1 h=18C8 AcDbLine: [{"code":1070,"value":1001},{"code":1005,"value":"0"}]`

## CAD 含义

天河参数化标记应用名。PCCAD 有参数化处理 PC_CRE / PC_DRI，但没有公开 TH_POWERPARA 的 TypedValue 字典。XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

量最大（铁芯轮廓线上也有，如 384.1_1 handle `18C3` 层 `1铁心-1轮廓线`），常见值是 1070:1001 + 1005:"0"，单独解不出参数名或表达式。

### 与其他字段组合

可与 `entity.runtime_class` + `entity.layer` 一起把「被参数化过的几何」打标，供去标注时优先保护；不能当铁芯片宽片长来源。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
