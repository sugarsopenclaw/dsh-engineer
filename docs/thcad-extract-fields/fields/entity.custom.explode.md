# 字段：explode

- **字段 ID**：`entity.custom.explode`
- **JSON 路径**：`entities.jsonl / custom.explode`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.custom`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / custom.explode`
- 作用域：`entity.custom`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 179}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=630D TH_DimLeaderUA: explode[6]`
  - `5TBC.384.A110050.1_1 h=630E TH_DimLeaderUA: explode[6]`
  - `5TBC.384.A110050.1_1 h=64A8 TH_DimLeaderUA: explode[6]`
  - `5TBC.384.A110050.1_1 h=6F74 TH_DimLeaderUA: explode[7]`
  - `5TBC.384.A110050.1_1 h=72EF TH_DimLeaderUA: explode[6]`
  - `5TBC.384.A110050.1_1 h=D793 TH_DimLeaderUA: explode[6]`

## CAD 含义

Explode 子图元列表。

公开资料：Entity.Explode

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

成功才有零件外观的标准图元。

### 与其他字段组合

失败见 explode_error。不要把空 explode 解释成「没有序号」。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
