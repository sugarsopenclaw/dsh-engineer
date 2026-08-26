# 字段：PaperOrientation

- **字段 ID**：`entity.custom.properties.PaperOrientation`
- **JSON 路径**：`entities.jsonl / custom.properties.PaperOrientation`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.custom.properties`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / custom.properties.PaperOrientation`
- 作用域：`entity.custom.properties`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 450}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=630D TH_DimLeaderUA: NotApplicable`
  - `5TBC.384.A110050.1_1 h=630E TH_DimLeaderUA: NotApplicable`
  - `5TBC.384.A110050.1_1 h=64A8 TH_DimLeaderUA: NotApplicable`
  - `5TBC.384.A110050.1_1 h=6A3C TH_XuHaoEntity: NotApplicable`
  - `5TBC.384.A110050.1_1 h=6A56 TH_XuHaoEntity: NotApplicable`
  - `5TBC.384.A110050.1_1 h=6A5A TH_XuHaoEntity: NotApplicable`

## CAD 含义

对 TH_* 专业对象做 .NET 反射得到的基类属性 `PaperOrientation`。这是 Teigha/Entity 运行时状态，不是天河件号或粗糙度。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

对沈变审图无业务含义。

### 与其他字段组合

不要和 `TH_XuHaoEntity` 组合成「序号值」——序号值不在这些属性里。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
