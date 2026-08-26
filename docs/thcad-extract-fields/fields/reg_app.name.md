# 字段：name

- **字段 ID**：`reg_app.name`
- **JSON 路径**：`tables.json / reg_apps[].name`
- **来源表/文件**：`tables.json`
- **作用域**：`reg_app`

## 实测观察

- 来源文件：`tables.json`
- JSON 路径：`tables.json / reg_apps[].name`
- 作用域：`reg_app`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 305}
- 实测例子：
  - `5TBC.384.A110050.1_1 reg_app:ACAD: ACAD`
  - `5TBC.384.A110050.1_1 reg_app:ACAD_EXEMPT_FROM_CAD_STANDARDS: ACAD_EXEMPT_FROM_CAD_STANDARDS`
  - `5TBC.384.A110050.1_1 reg_app:ACAD_DSTYLE_DIMRADIAL_EXTENSION: ACAD_DSTYLE_DIMRADIAL_EXTENSION`
  - `5TBC.384.A110050.1_1 reg_app:ACAD_NAV_VCDISPLAY: ACAD_NAV_VCDISPLAY`
  - `5TBC.384.A110050.1_1 reg_app:WBY_PAPERINIT: WBY_PAPERINIT`
  - `5TBC.384.A110050.1_1 reg_app:$WBY_PAPNO_PAPERINIT: $WBY_PAPNO_PAPERINIT`

## CAD 含义

已注册 XData 应用名。注册≠实体上有值。

公开资料：XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

清单。

### 与其他字段组合

真正有值的看 entity.xdata.*。TH_SUPERPART 等可能只注册未挂值。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
