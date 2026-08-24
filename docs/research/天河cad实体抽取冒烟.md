# 天河 CAD 实体抽取冒烟

本地证据与公开资料两条线都核对过。结论：抽取侧的说法基本全对，可以信。

下面分「已经拿到」和「做不到」逐项汇报，文末两件事需要单独看。

## 「已经拿到」——全部复算通过

| 声明 | 核对结果 |
| --- | --- |
| 3570 条图元、proxy 0 | 通过。`report` 与 `entities.jsonl` 行数一致。和 AutoCAD 侧的差额（56 proxy → 53 个 TH 真类 + 3 个 `TH_WaterMark`，天河不枚举）在 milestone 文档里有记录，解释合理。 |
| 标题栏字段 | 通过。`PC_TITLE_BLOCK`（handle `438F`）属性完整：产品型号 `SZ-63000/110`、图样名称「下节油箱」、图样代号 `5TBC.384.A110050.2`、比例 `1:20`、页码 `1/1`。 |
| 明细表 24 行 | 通过。`PC_MXB_BLOCK` 24 个块引用，序号 / 代号 / 名称 / 数量都在（还有材料 / 单重 / 总重 / 备注空字段）。 |
| 序号 ↔ 明细 24/24 | 通过。未采信其 `all_xuhao_matched` 标志，从原始 `entities.jsonl` + `dictionaries.jsonl` 重新推导了 24 条链接，与 `xuhao-bom-links.json` 零差异。键格式验算过（`1#8042`，`0x1F6A = 8042`）。 |
| 例子 `1F6A` = 序号 1 = 箱底 | 通过。精确吻合（`8TBT.055.T00001.1` 箱底 `5336×1806×…`）。 |

另外确认：仓库里找不到生成 `xuhao-bom-links.json` 的代码——它是从已落地 JSON 派生的一次性产物（文件自己的 note 也这么写）。这反而坐实了「没有再用额外 CAD API」的说法。

## 「做不到」——本地和公开资料双向成立

- **`TH_XuHaoEntity` 24/24**：无 XData、无扩展字典、`explode_error: eNotApplicable`、反射属性全是 Layer / Color 这类基类字段。抽取器源码（`DrawingExtractor.cs:928/970/976`）显示 Explode 和反射是真试过的，不是嘴上说做不到。
- **`TH_DimLeaderUA`** 有 13 条带 XData，但内容是 ACAD `DSTYLE` 标注样式数据，不是专业字段；`TH_BOMRecorder` 字典记录体确实只有 handle + 类名。
- **安装目录**（`D:\THSOFT\THCAD V24_Mechanical2D`，317 个 DLL）：`PCCADMgdV24.dll` 字符串扫描只有 LISP 互操作胶水（`RTENAME` / `RTRESBUF` / `LSP_*`）和几何结构体名，没有任何 Title / Bom / Xuhao / Mxb 相关类型或方法；`Interop.THComDTS.dll` 的接口是 `ImportData` / `ExportData` / `LoadDTS`——库表导入导出，跟图纸对象无关。两条都与抽取侧说法一致。安装里只有两个用户手册 CHM，无 SDK / 头文件；`Samples/` 是示例 DWG，不是开发示例。
- **网上独立调查**：天河官方知识库的「开发参考」全是平台层 API，无专业对象章节；全网搜不到任何第三方读过这些私有对象字段的方法；竞品浩辰把「能读天河自定义实体」当卖点宣传——说明这在行业内是公认的硬点，不是没找对地方。

## 两件需要知道的事

### 1. 一处措辞要收紧

不影响结论，影响对外表述。

天河官网（thcad.net 的 PDM / ERP 集成一节）其实宣传过「基于 COM 的自动化接口可读写 PCCAD 图纸标题栏、明细表」——只是从未公开 API 文档 / 类型库，历史上属于单独授权的 THCADToolKit 或集成项目交付。

所以严格说法是 **「没有公开文档化的可用接口」**，而不是「天河没露出来」。序号、引出、粗糙度这些连宣传都没覆盖，那句「只能向天河要」对它们是成立的。标题栏 / 明细表已经用块属性绕开了这条 COM 路，不需要它。

### 2. 遗留隐患（与本汇报无关，建议马上处理）

`client-data/transformer-design-drawings/5TBC.384.A110050.2_1.DWG` 现在仍是被 THCAD 改写过的版本（243768 字节，与 `out-thcad` 报告的 sha 一致），原件在旁边的 `.bak`（226774 字节，hash 与 AutoCAD 基线报告一致）。

milestone 文档里写了「对比完成后应从 `.bak` 恢复」，没做。`AGENTS.md` 规定 `client-data` 只收不改。用 `.bak` 恢复原件属于覆盖文件操作，需明确批准后再做。
