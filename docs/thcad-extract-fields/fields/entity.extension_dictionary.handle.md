# 字段：handle

- **字段 ID**：`entity.extension_dictionary.handle`
- **JSON 路径**：`entities.jsonl / extension_dictionary.handle`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.extension_dictionary`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / extension_dictionary.handle`
- 作用域：`entity.extension_dictionary`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 564}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=62FE AcDbRotatedDimension: 62FF`
  - `5TBC.384.A110050.1_1 h=6F70 AcDbAlignedDimension: 6F71`
  - `5TBC.384.A110050.1_1 h=7326 AcDbRotatedDimension: 7327`
  - `5TBC.384.A110050.1_1 h=7329 AcDbRotatedDimension: 732A`
  - `5TBC.384.A110050.1_1 h=732C AcDbRotatedDimension: 732D`
  - `5TBC.384.A110050.1_1 h=732F AcDbRotatedDimension: 7330`

## CAD 含义

实体扩展字典 `handle`（handle/runtime_class/count/items/is_proxy）。字段目录：专业气泡上往往没有。

公开资料：AutoCAD Extension Dictionary

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

有字典不等于有业务字段。

### 与其他字段组合

items 未做专业解析；机械语义优先块属性与 NOD 的 PC_* 键。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
