# 字段：custom

- **字段 ID**：`semantic.prof.custom`
- **JSON 路径**：`semantic-objects.json / prof[].custom`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`semantic.prof`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / prof[].custom`
- 作用域：`semantic.prof`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 450}
- 实测例子：
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:630D: ["managed_type","rx","explode","explode_count","properties"]`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:630E: ["managed_type","rx","explode","explode_count","properties"]`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:64A8: ["managed_type","rx","explode","explode_count","properties"]`
  - `5TBC.384.A110050.1_1 prof:TH_XuHaoEntity:6A3C: ["managed_type","rx","explode_error","properties"]`
  - `5TBC.384.A110050.1_1 prof:TH_XuHaoEntity:6A56: ["managed_type","rx","explode_error","properties"]`
  - `5TBC.384.A110050.1_1 prof:TH_XuHaoEntity:6A5A: ["managed_type","rx","explode_error","properties"]`

## CAD 含义

反射+explode 载荷。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

壳。

### 与其他字段组合

见 entity.custom.*。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
