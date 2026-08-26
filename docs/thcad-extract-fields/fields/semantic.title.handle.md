# 字段：handle

- **字段 ID**：`semantic.title.handle`
- **JSON 路径**：`semantic-objects.json / title[].handle`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`semantic.title`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / title[].handle`
- 作用域：`semantic.title`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7}
- 实测例子：
  - `5TBC.384.A110050.1_1 title:445CD: 445CD`
  - `5TBC.384.A110050.2_1 title:438F: 438F`
  - `5TBC.426.A110050.1_1 title:A624: A624`
  - `5TBC.457.A110050.1_1 title:7E13: 7E13`
  - `5TBC.709.A110050.1_1 title:8438: 8438`
  - `5TBC.709.A110050.1_2 title:18DF: 18DF`

## CAD 含义

块参照 handle。标题栏试点图 `438F`。

公开资料：AutoCAD .NET 里 Handle 跨会话稳定，ObjectId 只在本次打开有效（https://help.autodesk.com/view/OARX/2025/ENU/?guid=GUID-8D56532D-2B17-48D1-8C81-B4AD89603A1C）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

定位主键。

### 与其他字段组合

在 CAD 里高亮该 handle。

## 工程可用性判定

**判定：单独可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
