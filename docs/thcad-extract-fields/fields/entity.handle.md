# 字段：handle

- **字段 ID**：`entity.handle`
- **JSON 路径**：`entities.jsonl / handle`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / handle`
- 作用域：`entity`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 91605}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=2BC AcDbBlockReference: 2BC`
  - `5TBC.384.A110050.1_1 h=616D AcDbText: 616D`
  - `5TBC.384.A110050.1_1 h=616E AcDbText: 616E`
  - `5TBC.384.A110050.1_1 h=616F AcDbText: 616F`
  - `5TBC.384.A110050.1_1 h=6170 AcDbText: 6170`
  - `5TBC.384.A110050.1_1 h=6171 AcDbText: 6171`

## CAD 含义

图元 Handle，跨 CAD 会话稳定。AutoCAD .NET 里 Handle 跨会话稳定，ObjectId 只在本次打开有效（https://help.autodesk.com/view/OARX/2025/ENU/?guid=GUID-8D56532D-2B17-48D1-8C81-B4AD89603A1C）。

公开资料：AutoCAD .NET 里 Handle 跨会话稳定，ObjectId 只在本次打开有效（https://help.autodesk.com/view/OARX/2025/ENU/?guid=GUID-8D56532D-2B17-48D1-8C81-B4AD89603A1C）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

定位、对账、高亮的主键。试点直线 `15D5`、气泡 `1F6A`、标题栏 `438F` 两边 CAD 能对上。

### 与其他字段组合

与 AutoCAD 抽取 oracle 做 handle 级对齐；与序号字典、明细行连接。

## 工程可用性判定

**判定：单独可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
