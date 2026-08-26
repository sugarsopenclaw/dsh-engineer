# 字段：TH_XDATA_ATTDEFHANDLE

- **字段 ID**：`entity.xdata.TH_XDATA_ATTDEFHANDLE`
- **JSON 路径**：`entities.jsonl / xdata.TH_XDATA_ATTDEFHANDLE`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.TH_XDATA_ATTDEFHANDLE`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 287}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=446D3 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1005,"value":"446D3"}]`
  - `5TBC.384.A110050.1_1 h=446D6 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1005,"value":"446D6"}]`
  - `5TBC.384.A110050.1_1 h=446D7 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1005,"value":"446D7"}]`
  - `5TBC.384.A110050.1_1 h=446D8 AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1005,"value":"446D8"}]`
  - `5TBC.384.A110050.1_1 h=446DC AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1005,"value":"446DC"}]`
  - `5TBC.384.A110050.1_1 h=446DF AcDbAttributeDefinition: [{"code":1070,"value":1},{"code":1005,"value":"446DF"}]`

## CAD 含义

指向属性定义自身 handle。实测与图元 handle 相同（`446D3`）。

公开资料：AutoCAD .NET 里 Handle 跨会话稳定，ObjectId 只在本次打开有效（https://help.autodesk.com/view/OARX/2025/ENU/?guid=GUID-8D56532D-2B17-48D1-8C81-B4AD89603A1C）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

自指，不增加新身份。

### 与其他字段组合

与 `entity.handle` 对账用；不要当成序号气泡 handle。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
