# 字段：recorder_class

- **字段 ID**：`link.item.recorder_class`
- **JSON 路径**：`xuhao-bom-links.json / links[].recorder_class`
- **来源表/文件**：`xuhao-bom-links.json`
- **作用域**：`link.item`

## 实测观察

- 来源文件：`xuhao-bom-links.json`
- JSON 路径：`xuhao-bom-links.json / links[].recorder_class`
- 作用域：`link.item`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：否（派生产物或仅数据中出现）
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.2_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.1_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 24}
- 实测例子：
  - `5TBC.384.A110050.2_1 link:seq=14: TH_BOMItem2XuhaoAssoiateRecoder`
  - `5TBC.384.A110050.2_1 link:seq=8: TH_BOMItem2XuhaoAssoiateRecoder`
  - `5TBC.384.A110050.2_1 link:seq=17: TH_BOMItem2XuhaoAssoiateRecoder`
  - `5TBC.384.A110050.2_1 link:seq=20: TH_BOMItem2XuhaoAssoiateRecoder`
  - `5TBC.384.A110050.2_1 link:seq=12: TH_BOMItem2XuhaoAssoiateRecoder`
  - `5TBC.384.A110050.2_1 link:seq=18: TH_BOMItem2XuhaoAssoiateRecoder`

## CAD 含义

类名 TH_BOMItem2XuhaoAssoiateRecoder（拼写 Assoiate）。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

确认记录类型。

### 与其他字段组合

无内部字段。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
