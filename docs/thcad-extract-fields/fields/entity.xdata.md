# 字段：xdata

- **字段 ID**：`entity.xdata`
- **JSON 路径**：`entities.jsonl / xdata`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata`
- 作用域：`entity`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 25457}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=630D TH_DimLeaderUA: ["AcadCodePageInfo","ACAD"]`
  - `5TBC.384.A110050.1_1 h=630E TH_DimLeaderUA: ["AcadCodePageInfo","ACAD"]`
  - `5TBC.384.A110050.1_1 h=64A8 TH_DimLeaderUA: ["AcadCodePageInfo","ACAD"]`
  - `5TBC.384.A110050.1_1 h=6A3C TH_XuHaoEntity: ["AcadCodePageInfo"]`
  - `5TBC.384.A110050.1_1 h=6A56 TH_XuHaoEntity: ["AcadCodePageInfo"]`
  - `5TBC.384.A110050.1_1 h=6A5A TH_XuHaoEntity: ["AcadCodePageInfo"]`

## CAD 含义

按应用名分组的 TypedValue。XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

公开资料：XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

有哪些应用见 xdata.*。

### 与其他字段组合

应用名是字段；不要把每个 code 当字段。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
