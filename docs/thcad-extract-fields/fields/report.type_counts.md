# 字段：type_counts

- **字段 ID**：`report.type_counts`
- **JSON 路径**：`extraction-report.json / type_counts`
- **来源表/文件**：`extraction-report.json`
- **作用域**：`report`

## 实测观察

- 来源文件：`extraction-report.json`
- JSON 路径：`extraction-report.json / type_counts`
- 作用域：`report`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7}
- 实测例子：
  - `5TBC.384.A110050.1_1 extraction-report.json: {"AcDbBlockReference":524,"AcDbText":342,"AcDbPolyline":256,"AcDbLine":17281,"AcDbSolid":467,"AcDbMText":270,"AcDbRotatedDimension":209,"TH_DimLeaderUA":31,"TH_XuHaoEntity":50,"Ac…`
  - `5TBC.384.A110050.2_1 extraction-report.json: {"AcDbBlockReference":77,"AcDbLine":1865,"AcDbArc":168,"AcDbRotatedDimension":111,"AcDbCircle":78,"AcDbPolyline":110,"AcDbText":104,"TH_DimLeaderUA":24,"AcDbSpline":103,"TH_XuHaoE…`
  - `5TBC.426.A110050.1_1 extraction-report.json: {"AcDbBlockReference":166,"AcDbLine":19697,"AcDbRotatedDimension":58,"AcDbLeader":6,"AcDbText":250,"AcDbEllipse":95,"AcDbArc":3304,"AcDbWipeout":20,"AcDbPolyline":71,"TH_DimLeader…`
  - `5TBC.457.A110050.1_1 extraction-report.json: {"AcDbBlockReference":269,"AcDbLine":10609,"AcDbArc":2603,"AcDbSpline":154,"AcDbPoint":321,"AcDbPolyline":180,"TH_DimLeaderUA":70,"AcDbText":146,"AcDbRotatedDimension":88,"AcDbCir…`
  - `5TBC.709.A110050.1_1 extraction-report.json: {"AcDbBlockReference":320,"AcDbLine":10210,"AcDbArc":2316,"AcDbCircle":671,"AcDbText":243,"AcDbPolyline":162,"AcDbSpline":464,"AcDbEllipse":21,"TH_DimLeaderUA":21,"AcDbRotatedDime…`
  - `5TBC.709.A110050.1_2 extraction-report.json: {"AcDbBlockReference":129,"AcDbLine":2603,"AcDbText":88,"AcDbPolyline":27,"AcDbRotatedDimension":46,"TH_DimLeaderUA":7,"AcDbCircle":54,"AcDbHatch":27,"AcDbArc":425,"AcDbSpline":24…`

## CAD 含义

runtime_class 直方图。

公开资料：DrawingExtractor

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

立刻看到 TH_XuHaoEntity/尺寸/Line 各多少。

### 与其他字段组合

去标注工作量估计；与 entities.jsonl 逐条对账。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
