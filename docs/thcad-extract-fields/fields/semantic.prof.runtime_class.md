# 字段：runtime_class

- **字段 ID**：`semantic.prof.runtime_class`
- **JSON 路径**：`semantic-objects.json / prof[].runtime_class`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`semantic.prof`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / prof[].runtime_class`
- 作用域：`semantic.prof`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 450}
- 实测例子：
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:630D: TH_DimLeaderUA`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:630E: TH_DimLeaderUA`
  - `5TBC.384.A110050.1_1 prof:TH_DimLeaderUA:64A8: TH_DimLeaderUA`
  - `5TBC.384.A110050.1_1 prof:TH_XuHaoEntity:6A3C: TH_XuHaoEntity`
  - `5TBC.384.A110050.1_1 prof:TH_XuHaoEntity:6A56: TH_XuHaoEntity`
  - `5TBC.384.A110050.1_1 prof:TH_XuHaoEntity:6A5A: TH_XuHaoEntity`

## CAD 含义

TH_XuHaoEntity / TH_DimLeaderUA / TH_ParaBasePntUA / TH_CVArrowLine / TH_DimRough2010 / TH_DimRoughA。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。 符号命令 PC_CCD/PC_JZBZ https://www.thcad.net/5485.html

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

去标注分类的金标准（AutoCAD 里这些是 zombie）。

### 与其他字段组合

不要指望这里出现 Ra 或基准字母。

## 工程可用性判定

**判定：单独可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
