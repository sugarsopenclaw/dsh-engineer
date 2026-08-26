# 字段：source

- **字段 ID**：`entity.source`
- **JSON 路径**：`entities.jsonl / source`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / source`
- 作用域：`entity`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 91605}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=2BC AcDbBlockReference: thcad_v24_dotnet`
  - `5TBC.384.A110050.1_1 h=616D AcDbText: thcad_v24_dotnet`
  - `5TBC.384.A110050.1_1 h=616E AcDbText: thcad_v24_dotnet`
  - `5TBC.384.A110050.1_1 h=616F AcDbText: thcad_v24_dotnet`
  - `5TBC.384.A110050.1_1 h=6170 AcDbText: thcad_v24_dotnet`
  - `5TBC.384.A110050.1_1 h=6171 AcDbText: thcad_v24_dotnet`

## CAD 含义

thcad_v24_dotnet。每条都有。

公开资料：SourceTag

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

标记抽取器。

### 与其他字段组合

对账用。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
