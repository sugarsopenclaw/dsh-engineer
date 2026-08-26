# 字段：bom_qty

- **字段 ID**：`link.item.bom_qty`
- **JSON 路径**：`xuhao-bom-links.json / links[].bom_qty`
- **来源表/文件**：`xuhao-bom-links.json`
- **作用域**：`link.item`

## 实测观察

- 来源文件：`xuhao-bom-links.json`
- JSON 路径：`xuhao-bom-links.json / links[].bom_qty`
- 作用域：`link.item`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：否（派生产物或仅数据中出现）
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.2_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.1_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 24}
- 实测例子：
  - `5TBC.384.A110050.2_1 link:seq=14: 4`
  - `5TBC.384.A110050.2_1 link:seq=8: 4`
  - `5TBC.384.A110050.2_1 link:seq=17: 1`
  - `5TBC.384.A110050.2_1 link:seq=20: (1)`
  - `5TBC.384.A110050.2_1 link:seq=12: 1`
  - `5TBC.384.A110050.2_1 link:seq=18: 1`

## CAD 含义

数量拷贝。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

数量。

### 与其他字段组合

同 bom.数量。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
