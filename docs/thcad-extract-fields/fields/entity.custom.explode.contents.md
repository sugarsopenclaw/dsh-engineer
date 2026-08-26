# 字段：contents

- **字段 ID**：`entity.custom.explode.contents`
- **JSON 路径**：`entities.jsonl / custom.explode[].contents`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.custom.explode`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / custom.explode[].contents`
- 作用域：`entity.custom.explode`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_1`、`5TBC.709.A110050.1_2`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 229}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=630D TH_DimLeaderUA: \fFangSong_GB2312|b0|i0|c134|p49;\W0.6700000000;\T1.0000000000;\o\l箱盖`
  - `5TBC.384.A110050.1_1 h=630E TH_DimLeaderUA: \fFangSong_GB2312|b0|i0|c134|p49;\W0.6700000000;\T1.0000000000;\o\l箱沿`
  - `5TBC.384.A110050.1_1 h=64A8 TH_DimLeaderUA: \fFangSong_GB2312|b0|i0|c134|p49;\W0.6700000000;\T1.0000000000;\o\l箱壁弯折线直线段`
  - `5TBC.384.A110050.1_1 h=6F74 TH_DimLeaderUA: \fFangSong_GB2312|b0|i0|c134|p49;\W0.6700000000;\T1.0000000000;\o\l此处配开Φ100孔`
  - `5TBC.384.A110050.1_1 h=6F74 TH_DimLeaderUA: \fFangSong_GB2312|b0|i0|c134|p49;\W0.6700000000;\T1.0000000000;\o\l灌沙后封死，焊线打磨光滑`
  - `5TBC.384.A110050.1_1 h=72EF TH_DimLeaderUA: \fFangSong_GB2312|b0|i0|c134|p49;\W0.6700000000;\T1.0000000000;\o\l器身中心线`

## CAD 含义

专业对象 Explode 得到的文字。仅 explode 成功时存在（179 次成功 / 271 次 eNotApplicable）。

公开资料：未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

若有字，可能是气泡看起来的数字，但官方不保证这是序号真源。

### 与其他字段组合

序号真源是 `PC_BOMXHRELATEDIC`；explode 文字只作对照。粗糙度 explode 失败，得不到 Ra。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
