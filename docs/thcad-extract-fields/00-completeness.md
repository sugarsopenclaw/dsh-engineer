# THCAD 抽取字段完备性对照

对照对象：

- 目录文档（`docs/dev`）：
  - `2026-08-24-THCAD全量实体数据能拿到什么.md`
  - `2026-08-24-THCAD抽取数据一览表.md`
  - `2026-08-25-THCAD批量抽取与数据底座选型.md`
- 实测数据：`dev-test/visualstudionetframework/out-thcad/` 下七张图
  - `5TBC.384.A110050.1_1`
  - `5TBC.384.A110050.2_1`
  - `5TBC.426.A110050.1_1`
  - `5TBC.457.A110050.1_1`
  - `5TBC.709.A110050.1_1`
  - `5TBC.709.A110050.1_2`
  - `8TBC.312.A110050.101_1`
- 抽取器字段图：`dev-test/visualstudionetframework/ThcadExtractor/DrawingExtractor.cs`（SerializeEntity / DumpTables / GeometryOf / TextOf / SemanticBlock / HostInfo）

字段粒度见本目录 README（不是每条 Line、不是每个 TypedValue code）。

统计：库存 **455** 个字段；两边都有 **198**；只在目录 **0**；只在数据/抽取器 **257**。

## 验证例键落在哪一侧

这些键是计划里点名要交代的。若目录已经写过，这里标明 `both` 而不是跳过。

| 字段 ID | 落点 |
| --- | --- |
| `drawing.tile_mode` | only_data |
| `drawing.insunits` | only_data |
| `drawing.measurement` | only_data |
| `drawing.original_file_version` | only_data |
| `drawing.last_saved_as_version` | only_data |
| `report.source_sha256` | only_data |
| `report.host` | only_data |
| `report.host.application` | only_data |
| `report.entity_count` | both |
| `entity.semantic_type` | only_data |
| `entity.color.index` | both |
| `entity.color.is_by_layer` | both |
| `entity.text.measurement` | both |
| `entity.text.dimension_text` | both |
| `entity.xdata.AcDbBlockRepETag` | only_data |
| `entity.geometry.kind` | both |
| `entity.custom.properties` | both |

说明：

- `drawing.tile_mode` / `insunits` / 版本枚举：字段目录只把 `drawing.json` 写成「图纸元数据」，没有把这些键列进表，故属 **只在数据**。
- `report.source_sha256` / `host.*` / 计数：字段目录把 `extraction-report.json` 写成「计数」，未列 sha256/host 子键，故属 **只在数据**。
- `entity.semantic_type`：抽取器写入但恒 null，JSON 省略，属库存中的抽取器键，目录实体表未列。
- `entity.color.*`：字段目录 §1 写成 `color.index / is_by_layer / is_by_block / name`，属 **两边都有**。
- `entity.text.measurement` + `dimension_text`：数据底座选型文明确写了尺寸同时带 measurement 与 dimension_text；字段目录 geometry 也写了 measurement，属 **两边都有**。
- `entity.xdata.AcDbBlockRepETag`：字段目录 §2.6 把它列为 **RegApp 注册名**，§11.3「实体上实际带值的 XData」表却没点它的名；实测 20319 条实体带这包数据，故作为 **实体 XData 应用名** 记入 **只在数据**（RegApp 表本身已在目录）。
- `geometry.kind` 的值 `wipeout` / `unparsed` / `polyline2d`：目录 §11.2 已写，不是独立字段；本库存只有 `entity.geometry.kind` 一个字段。

## 只在目录（only in docs）

（空集，已显式列出）

## 两边都有（in both）

- `block.entity_count`
- `block.handle`
- `block.has_attribute_definitions`
- `block.is_anonymous`
- `block.is_from_xref`
- `block.is_layout`
- `block.name`
- `block.origin`
- `block.owner_scope`
- `block.xref_path`
- `bom.代号`
- `bom.单重`
- `bom.名称`
- `bom.备注`
- `bom.序号`
- `bom.总重`
- `bom.数量`
- `bom.材料`
- `dict.key`
- `dict.object`
- `dict.object.count`
- `dict.object.handle`
- `dict.object.is_proxy`
- `dict.object.items`
- `dict.object.runtime_class`
- `dict_key.ACAD_DATALINK`
- `dict_key.ACAD_LAYOUT`
- `dict_key.PC_BOMXHRELATEDIC`
- `dict_key.PC_BOM_DIC`
- `dict_key.PC_CRYPTO_MXBSORTDIC`
- `dict_key.PC_CRYPTO_PAPER_DIC`
- `dict_key.PC_ENCRY_BOM_DIC`
- `dict_key.PC_MXBSORTDIC`
- `dict_key.PC_PAPER_DIC`
- `dict_key.明细表分列记录`
- `dim_style.handle`
- `dim_style.name`
- `drawing.drawing_id`
- `entity.attributes`
- `entity.attributes.handle`
- `entity.attributes.invisible`
- `entity.attributes.position`
- `entity.attributes.tag`
- `entity.attributes.value`
- `entity.bbox`
- `entity.bbox.max`
- `entity.bbox.min`
- `entity.block_path`
- `entity.color`
- `entity.color.index`
- `entity.color.is_by_block`
- `entity.color.is_by_layer`
- `entity.color.name`
- `entity.custom`
- `entity.custom.explode`
- `entity.custom.explode_error`
- `entity.custom.properties`
- `entity.decode_status`
- `entity.drawing_handle`
- `entity.dxf_name`
- `entity.extension_dictionary`
- `entity.geometry`
- `entity.geometry.block_name`
- `entity.geometry.center`
- `entity.geometry.end`
- `entity.geometry.is_dynamic`
- `entity.geometry.kind`
- `entity.geometry.measurement`
- `entity.geometry.pattern`
- `entity.geometry.pattern_type`
- `entity.geometry.position`
- `entity.geometry.radius`
- `entity.geometry.start`
- `entity.handle`
- `entity.layer`
- `entity.linetype`
- `entity.lineweight`
- `entity.managed_type`
- `entity.owner_block_name`
- `entity.owner_handle`
- … 其余 118 个见 `_inventory.json` / 本文件完整列表附录

完整 both 列表见附录 `_completeness-both.txt`（生成时写出）。

## 只在数据或抽取器（only in data）

数量 257。包括 drawing.json 顶层键、extraction-report 的 sha256/host/计数字段、实体嵌套 geometry.*、custom.properties.*、未写入目录 §11.3 的 XData 应用名、全部 NOD 键、错误/proxy 预留键等。

完整 only-in-data 列表：

- `dict.error`
- `dict.object.data`
- `dict.object.error`
- `dict.object.kind`
- `dict.object.managed_type`
- `dict.object.truncated`
- `dict_key.ACAD_ASSOCNETWORK`
- `dict_key.ACAD_CIP_PREVIOUS_PRODUCT_INFO`
- `dict_key.ACAD_COLOR`
- `dict_key.ACAD_DETAILVIEWSTYLE`
- `dict_key.ACAD_GROUP`
- `dict_key.ACAD_IMAGE_DICT`
- `dict_key.ACAD_IMAGE_VARS`
- `dict_key.ACAD_MATERIAL`
- `dict_key.ACAD_MLEADERSTYLE`
- `dict_key.ACAD_MLINESTYLE`
- `dict_key.ACAD_PLOTSETTINGS`
- `dict_key.ACAD_PLOTSTYLENAME`
- `dict_key.ACAD_RENDER_ACTIVE_SETTINGS`
- `dict_key.ACAD_SCALELIST`
- `dict_key.ACAD_SECTIONVIEWSTYLE`
- `dict_key.ACAD_TABLESTYLE`
- `dict_key.ACAD_VISUALSTYLE`
- `dict_key.ACAD_WIPEOUT_VARS`
- `dict_key.AcDbVariableDictionary`
- `dict_key.BCAD_Civil`
- `drawing.block_inventory`
- `drawing.filename`
- `drawing.insunits`
- `drawing.last_saved_as_version`
- `drawing.measurement`
- `drawing.original_file_version`
- `drawing.schema_version`
- `drawing.source`
- `drawing.source_path`
- `drawing.tile_mode`
- `entity.custom.explode.bbox`
- `entity.custom.explode.contents`
- `entity.custom.explode.height`
- `entity.custom.explode.kind`
- `entity.custom.explode.layer`
- `entity.custom.explode.plain`
- `entity.custom.explode.position`
- `entity.custom.explode.rx`
- `entity.custom.explode.string`
- `entity.custom.explode_count`
- `entity.custom.managed_type`
- `entity.custom.properties.Angle`
- `entity.custom.properties.AnnoHeight`
- `entity.custom.properties.AnnoType`
- `entity.custom.properties.AnnoWidth`
- `entity.custom.properties.Annotation`
- `entity.custom.properties.AnnotationOffset`
- `entity.custom.properties.Annotative`
- `entity.custom.properties.Area`
- `entity.custom.properties.AutoDelete`
- `entity.custom.properties.BlockId`
- `entity.custom.properties.BlockName`
- `entity.custom.properties.Bounds`
- `entity.custom.properties.CastShadows`
- `entity.custom.properties.ClassID`
- `entity.custom.properties.CloneMeForDragging`
- `entity.custom.properties.Closed`
- `entity.custom.properties.CollisionType`
- `entity.custom.properties.Color`
- `entity.custom.properties.ColorIndex`
- `entity.custom.properties.Delta`
- `entity.custom.properties.Dimasz`
- `entity.custom.properties.Dimclrd`
- `entity.custom.properties.DimensionStyle`
- `entity.custom.properties.DimensionStyleName`
- `entity.custom.properties.Dimgap`
- `entity.custom.properties.Dimldrblk`
- `entity.custom.properties.Dimlwd`
- `entity.custom.properties.Dimsah`
- `entity.custom.properties.Dimscale`
- `entity.custom.properties.Dimtad`
- `entity.custom.properties.Dimtxsty`
- `entity.custom.properties.Dimtxt`
- `entity.custom.properties.DrawableType`
- `entity.custom.properties.Ecs`
- `entity.custom.properties.EdgeStyleId`
- `entity.custom.properties.EndParam`
- `entity.custom.properties.EndPoint`
- `entity.custom.properties.ExtensionDictionary`
- `entity.custom.properties.FaceStyleId`
- `entity.custom.properties.FirstVertex`
- `entity.custom.properties.ForceAnnoAllVisible`
- `entity.custom.properties.GeometricExtents`
- `entity.custom.properties.Handle`
- `entity.custom.properties.HasArrowHead`
- `entity.custom.properties.HasFields`
- `entity.custom.properties.HasHookLine`
- `entity.custom.properties.HasSaveVersionOverride`
- `entity.custom.properties.Id`
- `entity.custom.properties.IsAProxy`
- `entity.custom.properties.IsDisposed`
- `entity.custom.properties.IsEraseStatusToggled`
- `entity.custom.properties.IsErased`
- `entity.custom.properties.IsModified`
- `entity.custom.properties.IsModifiedGraphics`
- `entity.custom.properties.IsModifiedXData`
- `entity.custom.properties.IsNewObject`
- `entity.custom.properties.IsNotifyEnabled`
- `entity.custom.properties.IsNotifying`
- `entity.custom.properties.IsObjectIdsInFlux`
- `entity.custom.properties.IsPeriodic`
- `entity.custom.properties.IsPersistent`
- `entity.custom.properties.IsPlanar`
- `entity.custom.properties.IsReadEnabled`
- `entity.custom.properties.IsReallyClosing`
- `entity.custom.properties.IsSplined`
- `entity.custom.properties.IsUndoing`
- `entity.custom.properties.IsWriteEnabled`
- `entity.custom.properties.LastVertex`
- `entity.custom.properties.Layer`
- `entity.custom.properties.LayerId`
- `entity.custom.properties.Length`
- `entity.custom.properties.LineWeight`
- `entity.custom.properties.Linetype`
- `entity.custom.properties.LinetypeId`
- `entity.custom.properties.LinetypeScale`
- `entity.custom.properties.Material`
- `entity.custom.properties.MaterialId`
- `entity.custom.properties.MergeStyle`
- `entity.custom.properties.Normal`
- `entity.custom.properties.NumVertices`
- `entity.custom.properties.ObjectId`
- `entity.custom.properties.OwnerId`
- `entity.custom.properties.PaperOrientation`
- `entity.custom.properties.PlotStyleName`
- `entity.custom.properties.PlotStyleNameId`
- `entity.custom.properties.ReceiveShadows`
- `entity.custom.properties.StartParam`
- `entity.custom.properties.StartPoint`
- `entity.custom.properties.TextStyleId`
- `entity.custom.properties.Thickness`
- `entity.custom.properties.Transparency`
- `entity.custom.properties.UnmanagedObject`
- `entity.custom.properties.Visible`
- `entity.custom.properties.VisualStyleId`
- `entity.custom.properties.XData`
- `entity.custom.rx`
- `entity.extension_dictionary.count`
- `entity.extension_dictionary.error`
- `entity.extension_dictionary.handle`
- `entity.extension_dictionary.is_proxy`
- `entity.extension_dictionary.items`
- `entity.extension_dictionary.runtime_class`
- `entity.geometry.alignment`
- `entity.geometry.associative`
- `entity.geometry.attachment`
- `entity.geometry.closed`
- `entity.geometry.columns`
- `entity.geometry.constant_width`
- `entity.geometry.control_point_count`
- `entity.geometry.control_points`
- `entity.geometry.control_points_truncated`
- `entity.geometry.custom`
- `entity.geometry.custom_scale`
- `entity.geometry.degree`
- `entity.geometry.dim_style`
- `entity.geometry.dim_type`
- `entity.geometry.elevation`
- `entity.geometry.end_angle`
- `entity.geometry.error`
- `entity.geometry.has_arrow_head`
- `entity.geometry.hatch_style`
- `entity.geometry.height`
- `entity.geometry.horizontal_mode`
- `entity.geometry.invisible`
- `entity.geometry.location`
- `entity.geometry.major_axis`
- `entity.geometry.managed_type`
- `entity.geometry.normal`
- `entity.geometry.number`
- `entity.geometry.on`
- `entity.geometry.radius_ratio`
- `entity.geometry.rotation`
- `entity.geometry.rows`
- `entity.geometry.rx`
- `entity.geometry.scale`
- `entity.geometry.start_angle`
- `entity.geometry.tag`
- `entity.geometry.text_position`
- `entity.geometry.vertex_count`
- `entity.geometry.vertices`
- `entity.geometry.vertices_truncated`
- `entity.geometry.width`
- `entity.proxy`
- `entity.proxy.application_description`
- `entity.proxy.original_class_name`
- `entity.proxy.original_dxf_name`
- `entity.proxy.proxy_flags`
- `entity.semantic_type`
- `entity.text.prompt`
- `entity.text.tag`
- `entity.text.value`
- `entity.xdata.ACAD`
- `entity.xdata.ACAD_DSTYLE_DIMRADIAL_EXTENSION`
- `entity.xdata.AcDbBlockRepETag`
- `entity.xdata.AcadAnnotative`
- `entity.xdata.HATCHBACKGROUNDCOLOR`
- `entity.xdata.PC_MXBTITLERECORD`
- `error.error`
- `error.error_type`
- `error.handle`
- `error.owner_block_name`
- `link.all_xuhao_matched`
- `link.drawing_id`
- `link.link_count`
- `link.links`
- `link.note`
- `link.schema_version`
- `link.source`
- `report.completed_at`
- `report.decode_status_counts`
- `report.did_not_save`
- `report.drawing_id`
- `report.elapsed_ms`
- `report.failed_count`
- `report.host`
- `report.host.application`
- `report.host.application_version`
- `report.host.clr`
- `report.host.machine`
- `report.host.plugin`
- `report.host.plugin_version`
- `report.layer_counts`
- `report.output_dir`
- `report.owner_scope_counts`
- `report.schema_version`
- `report.semantic_bom_rows`
- `report.semantic_pc_blocks`
- `report.semantic_professional_entities`
- `report.semantic_title_blocks`
- `report.source`
- `report.source_path`
- `report.source_sha256`
- `report.source_size_bytes`
- `report.started_at`
- `semantic.bom.block_name`
- `semantic.bom.kind`
- `semantic.bom_rows`
- `semantic.drawing_id`
- `semantic.other_pc_blocks`
- `semantic.pc.block_name`
- `semantic.pc.fields`
- `semantic.pc.handle`
- `semantic.pc.kind`
- `semantic.pc.position`
- `semantic.pc.xdata`
- `semantic.professional_entities`
- `semantic.schema_version`
- `semantic.source`
- `semantic.title.xdata`
- `semantic.title_blocks`
