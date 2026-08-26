# 字段：TH_EXTENT_XDATA

- **字段 ID**：`entity.xdata.TH_EXTENT_XDATA`
- **JSON 路径**：`entities.jsonl / xdata.TH_EXTENT_XDATA`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.TH_EXTENT_XDATA`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`
- 这些图纸上未出现该键：`8TBC.312.A110050.101_1`
- 计数：{"seen": 193}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=28FA AcDbArc: [{"code":1000,"value":"CSTRUCT"},{"code":1000,"value":"c:pc_yj"},{"code":1000,"value":"ADS"},{"code":1000,"value":"9F91B"},{"code":1000,"value":"9F8FE"},{"code":1000,"value":"9F90…`
  - `5TBC.384.A110050.1_1 h=28FD AcDbArc: [{"code":1000,"value":"CSTRUCT"},{"code":1000,"value":"c:pc_yj"},{"code":1000,"value":"ADS"},{"code":1000,"value":"9F913"},{"code":1000,"value":"9F901"},{"code":1000,"value":"9F8F…`
  - `5TBC.384.A110050.1_1 h=2901 AcDbArc: [{"code":1000,"value":"CSTRUCT"},{"code":1000,"value":"c:pc_yj"},{"code":1000,"value":"ADS"},{"code":1000,"value":"9F909"},{"code":1000,"value":"9F903"},{"code":1000,"value":"9F90…`
  - `5TBC.384.A110050.1_1 h=2902 AcDbArc: [{"code":1000,"value":"CSTRUCT"},{"code":1000,"value":"c:pc_yj"},{"code":1000,"value":"ADS"},{"code":1000,"value":"9F909"},{"code":1000,"value":"9F903"},{"code":1000,"value":"9F90…`
  - `5TBC.384.A110050.1_1 h=2903 AcDbArc: [{"code":1000,"value":"CSTRUCT"},{"code":1000,"value":"c:pc_yj"},{"code":1000,"value":"ADS"},{"code":1000,"value":"9F919"},{"code":1000,"value":"9F910"},{"code":1000,"value":"9F90…`
  - `5TBC.384.A110050.1_1 h=2906 AcDbArc: [{"code":1000,"value":"CSTRUCT"},{"code":1000,"value":"c:pc_yj"},{"code":1000,"value":"ADS"},{"code":1000,"value":"9F915"},{"code":1000,"value":"9F90F"},{"code":1000,"value":"9F8F…`

## CAD 含义

天河范围/约束记录。实测含 `CSTRUCT`、`c:pc_yj` 及若干 handle 字符串。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

不能从公开文档解出这些 token 的业务含义，单独不能当轮廓。

### 与其他字段组合

可与 `entity.handle` 做关联线索，但在没有官方结构说明前，不得当成铁芯级或剖视符号内部参数。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
