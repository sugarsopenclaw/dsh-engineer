# MLightCAD 可行性关卡报告

复现命令：

```bash
npm run build
npm run sync:cad-data
npm run probe:mlight                      # 使用内置 R2000 DXF 夹具
npm run probe:mlight -- --drawing=<真实图纸路径>
```

产物落在 `build/.mlight-probe/out/`：各步骤 PNG、导出的 DXF、`report.json`。

## 结论

隐藏 `BrowserWindow` 里的 WebGL 出图、自托管字体、会话复用、实体预览、图层隔离、DXF
导出与回环重开全部通过。可以在此之上继续做预览运行时和 cad-drafter 写侧工具。

仍未验证、需要真实环境的两项在文末「未覆盖」列出。

## 实测数据

夹具：50 个实体 / 5 个图层的 R2000 DXF（闭合 LWPOLYLINE、CIRCLE、中文 TEXT/MTEXT、
LINE），Electron 38 / Chrome 140，Windows。

| 步骤 | 耗时 | 结果 |
| --- | --- | --- |
| `document_info` 冷启动（建窗 + 字体链 + 解析） | 1168 ms | 50 实体 / 5 图层，extents `[0,0]..[23000,14000]` |
| `document_info` 复用同一会话 | 105 ms | 同上 |
| `layers` | 569 ms | 逐图层实体计数正确 |
| `render` 全图 @2048 | 172 ms | 2048×1247，75.4 KiB |
| `render` 左下象限 @1536 | 59 ms | 1536×935，38.8 KiB |
| `render` 图层隔离（WALL）@1536 | 55 ms | 仅 WALL 出图 |
| `extract`（独立无字体会话） | 66 ms | 50 条索引记录 |
| `entity_preview` 2 组 / 37 handle @1024 | 66 ms | 2 张图，0 缺失 |
| `export_dxf` | 15 ms | 13.2 KiB |
| 回环：重开导出的 DXF | 995 ms | 实体数与 extents 与源图完全一致 |

真实图纸：某住宅结构施工图 DWG，4.6 MiB / 23694 实体 / 312 图层，extents 约
2.67e6 × 9.7e5 图纸单位（两簇图框相距很远）。

| 步骤 | 耗时 | 结果 |
| --- | --- | --- |
| `document_info` 冷启动 | 8342 ms | 23694 实体 / 312 图层 |
| `document_info` 复用同一会话 | 655 ms | 同上，约 12.7 倍 |
| `render` 全图 @2048 | 840 ms | 2048×745，43.4 KiB |
| `render` 左下象限 @1536 | 89 ms | 1536×559 |
| `render` 图层隔离（THIN）@1536 | 59 ms | 仅 THIN 出图 |
| `extract`（独立无字体会话） | 265 ms | 23693 条索引记录 |
| `entity_preview` 2 组 / 1767 handle @1024 | 3444 ms | 2 张图，0 缺失 |
| `export_dxf` | 1525 ms | 22.96 MiB |
| 回环：重开导出的 DXF | 5096 ms | 实体数与图层数一致，坐标按 6 位小数取整 |

## 逐项判定

**会话复用是这次改造最大的收益。** 冷启动 1168 ms 里绝大部分是建窗、拉字体和解析；
复用已解析的 `AcDbDatabase` 后同样的问询只要 105 ms，约 11 倍。原来的实现每次抽取都
新建并销毁一个隐藏窗口，等于每次都付冷启动的钱。会话池按
`(projectRoot, 图纸真实路径, size, mtime, 是否加载字体)` 作键，不同图纸落在不同窗口里，
因此天然并行——这正是 COM 串行链路给不了的。

**中文字体走自托管 cad-data 生效。** 出图里 `办公室 / 会议室 / 设备间 / 楼梯间 /
卫生间 / 资料室` 和带 `\P` 换行的 MTEXT 标题都正确渲染，`fonts-not-found` 为空。
字体只在需要出图的会话里加载（`loadFonts`），`cad_extract` 走的仍是不加载字体的会话，
所以 cad-analyst 的抽取速度没有被字体拖慢。

**`AcApPngConvertor.convert()` 必须 await。** 它返回 Promise，第一步就是
`await view.waitUntilIdle()`，等场景把实体几何都建完再截帧。不 await 直接去读被遮蔽的
`createFileAndDownloadIt` 拿到的 canvas，在小图上因为 idle 在一个微任务内就绪而侥幸通过，
换成真实 DWG 立刻变成 `render produced no image`。上面夹具那一行 172 ms 就是这个竞态下
测出来的数，真实耗时见真实图纸表。

**出图质量取决于显式 bounds。** `AcApPngConvertor` 在不给 bounds 时按画布尺寸出图，
而隐藏窗口的容器是 1×1，所以渲染路径一律先算模型空间 extents 再显式传 bounds。extents
由实体 `geometricExtents` 求并集得到，不读 header 的 EXTMIN/EXTMAX——后者在没有 regen
过的图纸里经常是陈旧值，直接用会裁掉内容。

**图层隔离必须走 `view.updateLayer`。** 只改 `AcDbLayerTableRecord.isOff` 不会影响渲染，
第一次实测出的「隔离图」和全图一模一样。正确做法是改完记录后调 `view.updateLayer(record,
{ isOff })`；如果是把原本关闭的图层打开，还要 `await view.convertMissingEntitiesOnLayer(name)`，
因为关闭图层上的实体在打开文档时根本没有生成几何。

**导出走 `database.dxfOut()` 而不是 `AcApDxfConvertor`。** 后者拿到 DXF 字符串后会造一个
`<a download>` 并点击，在无头窗口里没有意义。`dxfOut(undefined, 6)` 直接返回内容。
`AcApPngConvertor` 没有等价的取数接口，所以用实例属性遮蔽它的
`createFileAndDownloadIt`，拿到它已经渲染好的 canvas——相机、渲染目标、像素翻转、
中心裁剪这些逻辑全部沿用上游，不重写。

**DXF 回环无损。** 导出再重开，实体数 50 → 50，extents 完全一致，重渲染的 PNG 与源图
逐像素相同。

## 写侧关卡（`npm run probe:mlight-write`）

在读侧结论之上单独验证「能不能画」。探针在夹具上建一个 `XL-PROBE` 图层（ACI 1），
各加一条 line / lwpolyline / circle / arc / mtext，然后自查出图、导出、重开、再抽取。
十二项断言全绿——前九项走运行时协议，后三项走 `cad_draft` 工具本身：

| 断言 | 实测 |
| --- | --- |
| mutate 建层与句柄 | `XL-PROBE`，5 个句柄 `1000B`–`1000F` |
| 新增实体自带 extents | `[1000,2000]`–`[1405,2320]` |
| 新增实体进入场景图（可出图） | 1024×809，见 `draft-selfcheck.png` |
| 导出后原实体不丢、新实体不多 | 50 → 55 |
| 图层随导出保留 | `XL-PROBE` 挂 5 个实体 |
| 五种形状各自回读为正确类型 | arc / circle / line / lwpolyline / mtext |
| 几何精度 | 圆回读 `[1200,2150]` r=80，与写入完全一致 |
| 中文标注回环 | `晓量 XL probe`，height 35 |
| 源图未被改动 | 仍是 50 实体 / 5 图层 |
| `cad_draft` 标注副本落盘并可重开 | `xiaoliang-outputs/cad/probe-markup-*.dxf`，55 实体 |
| `cad_draft` 自查图真的写在预览树里 | `.xiaoliang/cad/previews/*/mlight/draft-selfcheck-*.png` |
| `cad_draft` 从空白模板起稿 | `probe-scratch-*.dxf` 只有 5 个实体 |

`mutate` 本身只花 20 ms，成本全在开窗与解析，因此一次会话内「改—自查出图—导出」
连做是划算的。

**写必须开在 `AcEdOpenMode.Write`。** 读侧一直用 `Read`，写侧要在 `open` 里带
`writable`，否则文档管理器按只读装载。

**append 要包在 `beginEventBatch`/`endEventBatch` 里。** 出图读的是场景图不是数据库，
数据库 `entityAppended` 事件才是把新实体送进场景的通道；批量包一层可以让整批只触发一次
场景重建，也避免逐条 append 时反复重算。

**改完要作废缓存的 extents。** 运行时把模型空间 extents 缓存在文档上，新实体如果落在
原 extents 之外，后续出图会按旧边界取景并把新画的内容裁掉。

**从零起稿用 cad-data 自带的空白模板。** `templates/acadiso.dxf`（公制）与 `acad.dxf`
已经随字体一起同步并由 loopback 伺服，直接当底图打开即可，比手搓一份 AC1015 骨架可靠得多，
且自带标准线型、文字样式与标注样式。`withPrivateSession` 不传 `sourceRelativePath` 时走这条路。
注意模板默认文字样式挂的是 TTF，中文会以 TTF 字形渲染，与源图里 SHX 字形的观感不同——
两者都可读，但不要拿自查图去比对字形。

**导出目前只做 DXF 与 PNG。** PDF/SVG/HTML 转换器在 `cad-pdf-plugin` / `cad-svg-plugin` /
`cad-html-plugin` 里，接口是面向命令插件的 `convert(context)`，取字节要靠影子化私有的
`createFileAndDownloadIt`，无头路径未验证；用户要这几种格式时走预览面板的交互导出。

## 一个夹具层面的坑

第一版夹具写的是 R12（AC1009）风格的 DXF：没有句柄、没有 `100` 子类标记。结果是
实体本身建出来了、类型和图层都对，但几何全部回落到默认值——CIRCLE 变成圆心
`(0,0)` 半径 `1`，LINE 两端都在原点，TEXT 没有位置。只有 POLYLINE/VERTEX 侥幸正确。
这类失败不报错，只表现为「出图是空的」，排查时很容易误判成渲染器坏了。夹具改成完整
AC1015 骨架（句柄、`AcDbEntity`/`AcDbCircle` 等子类标记、BLOCK_RECORD、
`*Model_Space`/`*Paper_Space` 块、OBJECTS 字典）之后全部正常。

结论是：写侧生成 DXF 时必须按 R2000 完整结构输出，不能图省事写 R12 简写形式。

## 预览面板接线后的两处修正

`npm run probe:cad-panel -- --drawing=<路径>` 会把真正的 `ProjectCadPreview` 组件挂进
`dist/` 里的一张宿主页，因此走的是生产环境同一条 iframe 路径（相对路径解析、ready 握手、
`postMessage` 目标源）。用它跑两张真实图纸暴露了两个只在面板宽度下才明显的问题。

**打开视图要用 `Saved` 而不是 `Extents`。** 原先 `openViewMode: Extents` 再补一次
`zoomToFitDrawing()`，结果图框被缩成角落里的一小块——因为 extents 会把图面之外的零散
标记一起框进去，在 500px 宽的面板里图纸只剩几十像素。改成
`AcApOpenViewMode.Saved`（先图纸界限、再 `*ACTIVE` VPORT）后，打开位置与 AutoCAD 一致。
注意那次多余的 `zoomToFitDrawing()` 本身就会覆盖掉保存的视图，两处要一起改。

**加载态交给 viewer 自己画。** `cad-simple-ui-plugin` 在转换阶段已经有一张自带品牌的
「正在解析图元…」遮罩，面板再叠一层 spinner 只会变成两个转圈。组件现在只在 iframe 启动
完成前盖一层，之后完全让位。超时也从「打开总时长」改成「进度静默」看门狗：26k 实体的图
转换十几秒是正常的，但它全程都在报进度。

实测（500×900 面板，冷启动）：

| 图纸 | 大小 | 实体 / 图层 | ready | 打开完成 | 缺字体 |
| --- | --- | --- | --- | --- | --- |
| structural.dwg | 3.09 MiB | 26337 / 189 | 326 ms | 18.4 s | 0 |
| 202209~3.DWG | 4.51 MiB | 23694 / 313 | ~330 ms | 7.0 s | 0 |

耗时几乎全在实体转换，与文件大小关系不大。自托管字体在两张中文图纸上都是零缺失。

## 未覆盖

- **真实 AutoCAD 打开导出的 DXF。** 需要装了 AutoCAD 的机器。回环只证明了 MLightCAD
  自己能无损读回自己写的东西。
- **与 COM 链路的同图对比。** 需要一张真实的中文工程 DWG 同时跑两条链路。
  `npm run probe:mlight -- --drawing=<路径>` 已经支持直接喂真实图纸，跑出来的
  `report.json` 可以直接和 COM 侧的耗时对齐。
