# 字段：rotation

- **字段 ID**：`entity.geometry.rotation`
- **JSON 路径**：`entities.jsonl / geometry.rotation`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.rotation`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 3973}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=2BC AcDbBlockReference: 0`
  - `5TBC.384.A110050.1_1 h=616D AcDbText: 0`
  - `5TBC.384.A110050.1_1 h=616E AcDbText: 0`
  - `5TBC.384.A110050.1_1 h=616F AcDbText: 0`
  - `5TBC.384.A110050.1_1 h=6170 AcDbText: 0`
  - `5TBC.384.A110050.1_1 h=6171 AcDbText: 0`

## CAD 含义

文字或块旋转角（弧度）。

公开资料：AutoCAD BlockReference.Rotation

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

可摆正块，无产品语义。

### 与其他字段组合

重建块插入时与 scale、position 组成变换；嵌套块的完整矩阵本抽取只有一层 block_path。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
