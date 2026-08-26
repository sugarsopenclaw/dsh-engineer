# 字段：is_dynamic

- **字段 ID**：`entity.geometry.is_dynamic`
- **JSON 路径**：`entities.jsonl / geometry.is_dynamic`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.geometry`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / geometry.is_dynamic`
- 作用域：`entity.geometry`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 1498}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=2BC AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=72EE AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=72F5 AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=72F7 AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=72F9 AcDbBlockReference: False`
  - `5TBC.384.A110050.1_1 h=1A29D AcDbBlockReference: False`

## CAD 含义

是否动态块。字段目录：只抽到布尔，没有动态参数表。

公开资料：AutoCAD BlockReference.IsDynamicBlock

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

true/false 本身不能还原可见性状态。

### 与其他字段组合

动态参数求值表未抽，不能当配置表。块几何仍看炸开前的定义实体。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
