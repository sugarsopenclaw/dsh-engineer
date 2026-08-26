# 字段：TH_FrameText

- **字段 ID**：`entity.xdata.TH_FrameText`
- **JSON 路径**：`entities.jsonl / xdata.TH_FrameText`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.TH_FrameText`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.426.A110050.1_1`
- 这些图纸上未出现该键：`5TBC.384.A110050.2_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 42}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=24405 AcDbWipeout: [{"code":1070,"value":1},{"code":1005,"value":"72EF"}]`
  - `5TBC.384.A110050.1_1 h=333C5 AcDbWipeout: [{"code":1070,"value":1},{"code":1005,"value":"333C6"}]`
  - `5TBC.384.A110050.1_1 h=391C8 AcDbWipeout: [{"code":1070,"value":1},{"code":1005,"value":"38894"}]`
  - `5TBC.384.A110050.1_1 h=391CA AcDbWipeout: [{"code":1070,"value":1},{"code":1005,"value":"38897"}]`
  - `5TBC.384.A110050.1_1 h=3934E AcDbWipeout: [{"code":1070,"value":1},{"code":1005,"value":"38888"}]`
  - `5TBC.384.A110050.1_1 h=39350 AcDbWipeout: [{"code":1070,"value":1},{"code":1005,"value":"388A6"}]`

## CAD 含义

图框文字相关 XData。实测出现在 Wipeout 上（384.1_1 handle `24405`，1005 指向 `72EF`）。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

不是标题栏文字本身。

### 与其他字段组合

与 `entity.geometry.kind=wipeout` + `entity.layer` 一起，可把图框遮罩从生产几何里剔除（去标注白名单的反向：这些不是零件轮廓）。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
