# 字段：xuhao_found

- **字段 ID**：`link.item.xuhao_found`
- **JSON 路径**：`xuhao-bom-links.json / links[].xuhao_found`
- **来源表/文件**：`xuhao-bom-links.json`
- **作用域**：`link.item`

## 实测观察

- 来源文件：`xuhao-bom-links.json`
- JSON 路径：`xuhao-bom-links.json / links[].xuhao_found`
- 作用域：`link.item`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：否（派生产物或仅数据中出现）
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.2_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.1_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 24}
- 实测例子：
  - `5TBC.384.A110050.2_1 link:seq=14: True`
  - `5TBC.384.A110050.2_1 link:seq=8: True`
  - `5TBC.384.A110050.2_1 link:seq=17: True`
  - `5TBC.384.A110050.2_1 link:seq=20: True`
  - `5TBC.384.A110050.2_1 link:seq=12: True`
  - `5TBC.384.A110050.2_1 link:seq=18: True`

## CAD 含义

实体表是否找得到该气泡。试点 24/24 true。

公开资料：派生产物

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

关联完整性。

### 与其他字段组合

false 则字典脏了，不能自动配对。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
