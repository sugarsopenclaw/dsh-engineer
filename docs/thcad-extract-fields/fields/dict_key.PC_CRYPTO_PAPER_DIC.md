# 字段：PC_CRYPTO_PAPER_DIC

- **字段 ID**：`dict_key.PC_CRYPTO_PAPER_DIC`
- **JSON 路径**：`dictionaries.jsonl / key=PC_CRYPTO_PAPER_DIC`
- **来源表/文件**：`dictionaries.jsonl`
- **作用域**：`named_dictionary`

## 实测观察

- 来源文件：`dictionaries.jsonl`
- JSON 路径：`dictionaries.jsonl / key=PC_CRYPTO_PAPER_DIC`
- 作用域：`named_dictionary`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 7}
- 实测例子：
  - `5TBC.384.A110050.1_1 NOD:PC_CRYPTO_PAPER_DIC: {"runtime_class":"AcDbDictionary","handle":"4E3B2","count":0,"kind":null}`
  - `5TBC.384.A110050.2_1 NOD:PC_CRYPTO_PAPER_DIC: {"runtime_class":"AcDbDictionary","handle":"55F1","count":0,"kind":null}`
  - `5TBC.426.A110050.1_1 NOD:PC_CRYPTO_PAPER_DIC: {"runtime_class":"AcDbDictionary","handle":"EB04","count":0,"kind":null}`
  - `5TBC.457.A110050.1_1 NOD:PC_CRYPTO_PAPER_DIC: {"runtime_class":"AcDbDictionary","handle":"26EE7","count":0,"kind":null}`
  - `5TBC.709.A110050.1_1 NOD:PC_CRYPTO_PAPER_DIC: {"runtime_class":"AcDbDictionary","handle":"92CB","count":0,"kind":null}`
  - `5TBC.709.A110050.1_2 NOD:PC_CRYPTO_PAPER_DIC: {"runtime_class":"AcDbDictionary","handle":"73CF","count":0,"kind":null}`

## CAD 含义

加密图幅字典。七张 count=0。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

空。

### 与其他字段组合

无工程用途。

## 工程可用性判定

**判定：目前不能支撑工程结论**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
