# 字段：PC_CSL_BLOCK

- **字段 ID**：`pc.PC_CSL_BLOCK`
- **JSON 路径**：`semantic-objects.json / other_pc_blocks[PC_CSL_BLOCK] (no instance) + tables.json blocks`
- **来源表/文件**：`semantic-objects.json`
- **作用域**：`pc.PC_CSL_BLOCK`

## 实测观察

- 来源文件：`semantic-objects.json`
- JSON 路径：`semantic-objects.json / other_pc_blocks[PC_CSL_BLOCK] (no instance) + tables.json blocks`
- 作用域：`pc.PC_CSL_BLOCK`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- **key absent on all seven drawings**：七张 `out-thcad/<图>/` 的 JSON/JSONL 都没有这个键（抽取器可能写了 null，JsonUtil 会丢弃 null；或该类图元本批没有）。
- 计数：{"seen": 0}
- 附注：
  - 七张图的块表都有 PC_CSL_BLOCK 定义，但模型空间无插入实例，other_pc_blocks 无此块；属性 tag 因 AttributeDefinition 被当成 DBText 抽成 geometry.kind=text 且 text 为空串，本抽取拿不到参数栏格子名。
- 观察结论：本键在现行七张 THCAD 抽取里不落地，工程上只能当「抽取器能力预留」或「本批图纸没有这类对象」。

## CAD 含义

PCCAD 参数栏块 `PC_CSL_BLOCK`，命令 PC_CSLEDIT / 自定义 PC_CSLDEF（https://www.thcad.net/5485.html）。

公开资料：https://www.thcad.net/5485.html

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

七张图块表有定义、模型空间无插入，other_pc_blocks 没有该块，单独无参数栏可读。

### 与其他字段组合

只能和 `block.name=PC_CSL_BLOCK` 一起证明「图框模板带了参数栏定义但本张没用」。不能发明未抽出的格子名。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
