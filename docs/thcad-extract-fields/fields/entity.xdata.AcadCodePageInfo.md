# 字段：AcadCodePageInfo

- **字段 ID**：`entity.xdata.AcadCodePageInfo`
- **JSON 路径**：`entities.jsonl / xdata.AcadCodePageInfo`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.AcadCodePageInfo`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`8TBC.312.A110050.101_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`
- 计数：{"seen": 116}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=630D TH_DimLeaderUA: [{"code":1000,"value":"CodePage"},{"code":1070,"value":39}]`
  - `5TBC.384.A110050.1_1 h=630E TH_DimLeaderUA: [{"code":1000,"value":"CodePage"},{"code":1070,"value":39}]`
  - `5TBC.384.A110050.1_1 h=64A8 TH_DimLeaderUA: [{"code":1000,"value":"CodePage"},{"code":1070,"value":39}]`
  - `5TBC.384.A110050.1_1 h=6A3C TH_XuHaoEntity: [{"code":1000,"value":"CodePage"},{"code":1070,"value":39}]`
  - `5TBC.384.A110050.1_1 h=6A56 TH_XuHaoEntity: [{"code":1000,"value":"CodePage"},{"code":1070,"value":39}]`
  - `5TBC.384.A110050.1_1 h=6A5A TH_XuHaoEntity: [{"code":1000,"value":"CodePage"},{"code":1070,"value":39}]`

## CAD 含义

代码页标记。实测 `CodePage` + 1070:39，常见于 TH_* 专业对象。

公开资料：XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

只说明历史编码，不是粗糙度值。

### 与其他字段组合

与 `TH_DimRough*` 的 xdata 一起看：粗糙度符号上往往只有这包，进一步证明内部 Ra 没抽出来。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
