# 字段：数量

- **字段 ID**：`bom.数量`
- **JSON 路径**：`semantic-objects.json / bom_rows[].fields.数量`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`bom.fields`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / bom_rows[].fields.数量`
- 作用域：`bom.fields`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_2`
- 这些图纸上未出现该键：`5TBC.709.A110050.1_1`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 208}
- 实测例子：
  - `5TBC.384.A110050.1_1 bom:4CCA4: 1`
  - `5TBC.384.A110050.1_1 bom:4CCAE: 4`
  - `5TBC.384.A110050.1_1 bom:4CCB8: 4`
  - `5TBC.384.A110050.1_1 bom:4CCC2: 8`
  - `5TBC.384.A110050.1_1 bom:4CCCC: 20`
  - `5TBC.384.A110050.1_1 bom:4CCD6: 12`

## CAD 含义

明细 `数量`。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

数字或 `(4)` 这种带括号写法；709.1_2 序号1 为 `(4)` 且备注「油箱已给(4)」。

### 与其他字段组合

与气泡数量、图面重复件个数校核是硬规则候选；括号语义要规则化，不能当纯 int。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
