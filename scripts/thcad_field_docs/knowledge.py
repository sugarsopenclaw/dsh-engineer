"""Engineering-use analysis text for each THCAD extract field.

Public sources used (also logged in thcad-research-log.txt):
- 天河 PCCAD 功能/命令：https://www.thcad.net/pccad 、https://www.thcad.net/5485.html
- AutoCAD .NET Handle / Entity / GeometricExtents / XData / DimensionText
- AcDbBlockRepETag analogue: netDxf discussion of AcDbBlockRepBTag (undocumented)
- TH_* professional internals: no public field list found
"""

from __future__ import annotations

NOT_FOUND = "未找到公开的字段级说明；以下只根据 AutoCAD/.NET 同类语义 + 本仓库 out-thcad 实测，不编造 TH_* 内部参数。"

PCCAD = (
    "天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联"
    "（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、"
    "https://www.thcad.net/5485.html）。"
)
ACAD_HANDLE = (
    "AutoCAD .NET 里 Handle 跨会话稳定，ObjectId 只在本次打开有效"
    "（https://help.autodesk.com/view/OARX/2025/ENU/?guid=GUID-8D56532D-2B17-48D1-8C81-B4AD89603A1C）。"
)
ACAD_XDATA = (
    "XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释"
    "（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。"
)
ACAD_EXTENTS = (
    "Entity.GeometricExtents 是 WCS 轴对齐包围盒"
    "（https://help.autodesk.com/view/OARX/2026/ENU/?guid=OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Entity_GeometricExtents）。"
)
ACAD_DIMTEXT = (
    "Dimension.DimensionText 非空表示文字覆盖；空串才显示 Measurement"
    "（https://help.autodesk.com/view/OARX/2024/ENU?guid=OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Dimension）。"
)

# verdict: alone | combo | none
ALONE = "alone"
COMBO = "combo"
NONE = "none"

NOISE_PROPS = {
    "AutoDelete",
    "CastShadows",
    "ClassID",
    "CloneMeForDragging",
    "CollisionType",
    "DrawableType",
    "Ecs",
    "EdgeStyleId",
    "FaceStyleId",
    "ForceAnnoAllVisible",
    "HasSaveVersionOverride",
    "IsDisposed",
    "IsEraseStatusToggled",
    "IsModified",
    "IsModifiedGraphics",
    "IsModifiedXData",
    "IsNewObject",
    "IsNotifyEnabled",
    "IsNotifying",
    "IsObjectIdsInFlux",
    "IsReadEnabled",
    "IsReallyClosing",
    "IsUndoing",
    "IsWriteEnabled",
    "MergeStyle",
    "PaperOrientation",
    "PlotStyleName",
    "PlotStyleNameId",
    "ReceiveShadows",
    "UnmanagedObject",
    "VisualStyleId",
    "HasFields",
    "AnnoHeight",
    "AnnoType",
    "AnnoWidth",
    "Annotation",
    "AnnotationOffset",
}


def _pack(cad, alone, combo, verdict, research=""):
    return {
        "cad": cad,
        "alone": alone,
        "combo": combo,
        "verdict": verdict,
        "research": research or NOT_FOUND,
    }


def analysis_for(obs: dict) -> dict:
    fid = obs["id"]
    if fid in SPECIFIC:
        return SPECIFIC[fid]
    prefix_handlers = (
        ("title.", _title),
        ("bom.", _bom),
        ("pc.", _pc),
        ("entity.xdata.", _xdata_app),
        ("dict_key.", _dict_key),
        ("entity.custom.properties.", _custom_prop),
        ("entity.geometry.", _geometry_key),
        ("entity.color.", _color_key),
        ("entity.bbox.", _bbox_key),
        ("entity.text.", _text_key),
        ("entity.attributes.", _attr_key),
        ("entity.custom.explode.", _explode_key),
        ("entity.custom.", _custom_key),
        ("entity.proxy.", _proxy_key),
        ("entity.extension_dictionary.", _extdict_key),
        ("report.host.", _host_key),
        ("report.", _report_key),
        ("drawing.", _drawing_key),
        ("layer.", _table_col),
        ("linetype.", _table_col),
        ("text_style.", _table_col),
        ("dim_style.", _table_col),
        ("reg_app.", _table_col),
        ("layout.", _table_col),
        ("block.", _table_col),
        ("semantic.title.", _sem_block),
        ("semantic.bom.", _sem_block),
        ("semantic.pc.", _sem_block),
        ("semantic.prof.", _sem_prof),
        ("semantic.", _sem_top),
        ("dict.object.", _dict_obj),
        ("dict.", _dict_top),
        ("link.item.", _link_item),
        ("link.", _link_top),
        ("error.", _error_key),
        ("entity.", _entity_key),
    )
    for prefix, fn in prefix_handlers:
        if fid.startswith(prefix):
            return fn(obs)
    return _generic(obs)


def _generic(obs: dict) -> dict:
    return _pack(
        f"抽取器写出的键 `{obs['verbatim']}`。{NOT_FOUND}",
        "单看这个键不能形成沈变审图结论。",
        "需要先与同记录的 handle、runtime_class、图层一起看，才知道它挂在哪类图元上。",
        COMBO,
        NOT_FOUND,
    )


def _title(obs: dict) -> dict:
    tag = obs["verbatim"]
    if tag.startswith("标记"):
        return _pack(
            f"PCCAD 标题栏属性 tag `{tag}`，企业可定制的附加标记格。" + PCCAD,
            "七张 SZ-63000/110 图上这四格全空，单独得不到任何产品标记。",
            "只有将来图面真的填了标记，才能和 `title.产品型号` / `title.图样代号` 一起做厂标或附加代号核对。",
            NONE,
            PCCAD,
        )
    if tag.startswith("改版") or tag.startswith("处数") or tag.startswith("更改文件号"):
        return _pack(
            f"PCCAD 标题栏变更栏格子 `{tag}`（改版标记/处数/分区/更改文件号/签名/日期，三栏）。" + PCCAD,
            "七张图变更栏全空，不能用来做版本追溯。",
            "若以后图上填了改版日期/更改文件号，应与 `drawing.filename`、`title.图样代号` 对照，拦截「文件名换了、标题栏改版栏没填」。",
            NONE if True else COMBO,
            PCCAD,
        )
    return _generic(obs)


def _bom(obs: dict) -> dict:
    return _generic(obs)


def _pc(obs: dict) -> dict:
    fid = obs["id"]
    if fid == "pc.PC_CSL_BLOCK":
        return _pack(
            "PCCAD 参数栏块 `PC_CSL_BLOCK`，命令 PC_CSLEDIT / 自定义 PC_CSLDEF（https://www.thcad.net/5485.html）。",
            "七张图块表有定义、模型空间无插入，other_pc_blocks 没有该块，单独无参数栏可读。",
            "只能和 `block.name=PC_CSL_BLOCK` 一起证明「图框模板带了参数栏定义但本张没用」。不能发明未抽出的格子名。",
            NONE,
            "https://www.thcad.net/5485.html",
        )
    if "PC_FJL_BLOCK" in fid:
        return _pack(
            f"PCCAD 附加栏 `PC_FJL_BLOCK` 属性 `{obs['verbatim']}`，命令 PC_FJLEDIT。",
            f"七张图 `{obs['verbatim']}` 全是空串，不能当签字/底图总号来源。",
            "将来若填写，应与 `title.图样代号` 一起做归档元数据；现在组合也推不出日期或责任人。",
            NONE,
            "https://www.thcad.net/5485.html",
        )
    if "PC_TYDH_BLOCK" in fid:
        return _pack(
            "PCCAD 图样代号栏块 `PC_TYDH_BLOCK` 的 `图样代号` 属性，命令 PC_TYDHDEF。",
            "本栏七张都有值，且与标题栏 `title.图样代号` 一致，可作图号的第二来源。",
            "必须与 `title.图样代号` 和 `drawing.filename` 三方对照：文件名带 `_页次`，代号栏没有页次。",
            COMBO,
            "https://www.thcad.net/5485.html",
        )
    return _generic(obs)


def _xdata_app(obs: dict) -> dict:
    app = obs["verbatim"]
    known = {
        "TH_XUHAO": _pack(
            "天河序号/明细行扩展数据应用名。PCCAD 序号与明细双向关联（PC_XH / PC_MXB）。" + ACAD_XDATA,
            "明细行块参照上能读到 1000 组的序号字符串（如 handle `4575` 上 `\"1\"`），气泡 TH_XuHaoEntity 本身通常没有这包 XData。",
            "要落到图面气泡必须再连 `dict_key.PC_BOMXHRELATEDIC` / `link.item.xuhao_handle` 和 `bom.序号`。不要把 TypedValue 当成粗糙度或件号内部结构。",
            COMBO,
            PCCAD + ACAD_XDATA,
        ),
        "TH_POWERPARA": _pack(
            "天河参数化标记应用名。PCCAD 有参数化处理 PC_CRE / PC_DRI，但没有公开 TH_POWERPARA 的 TypedValue 字典。" + ACAD_XDATA,
            "量最大（铁芯轮廓线上也有，如 384.1_1 handle `18C3` 层 `1铁心-1轮廓线`），常见值是 1070:1001 + 1005:\"0\"，单独解不出参数名或表达式。",
            "可与 `entity.runtime_class` + `entity.layer` 一起把「被参数化过的几何」打标，供去标注时优先保护；不能当铁芯片宽片长来源。",
            COMBO,
            NOT_FOUND,
        ),
        "TH_XDATA_CODE": _pack(
            "挂在标题栏/明细属性定义上的逻辑字段码。实测 1000 组有 `Material`/`Name`/`Code`/`PageNo`/`Scale`/`Type`/`Weight`。" + ACAD_XDATA,
            "单独是英文字段码，不是中文格子值。",
            "必须与 `entity.attributes.tag`（中文 tag：材料/名称/代号…）或 `title.*` / `bom.*` 对照，用来理解 PCCAD 内部码与中文格子的映射。",
            COMBO,
            NOT_FOUND,
        ),
        "TH_XDATA_ORDER": _pack(
            "属性定义上的列序。实测明细 attDef handle `446D3` 值为 `\"5\"`。",
            "单独只是一个序数字符串。",
            "与 `TH_XDATA_CODE`、`entity.attributes.tag` 一起可重建明细表列顺序；不能提供零件数量。",
            COMBO,
            NOT_FOUND,
        ),
        "TH_XDATA_VTYPE": _pack(
            "属性值类型。实测 `String`。",
            "只能知道格子按字符串存，不能得到工程值。",
            "与 `TH_XDATA_CODE` 组合可做类型校验；沈变 BOM 取值仍看 `bom.*`。",
            COMBO,
            NOT_FOUND,
        ),
        "TH_XDATA_ALIGN": _pack(
            "属性对齐。实测 `LEFT`。",
            "排版信息，不是零件属性。",
            "去标注/重绘标题栏时与 geometry 文字位置一起用；审图规则用不上。",
            NONE,
            NOT_FOUND,
        ),
        "TH_XDATA_EXPRE": _pack(
            "属性表达式槽。实测为空串。",
            "空，不能当公式。",
            "若将来非空，才可能与 `TH_POWERPARA` 参数化一起看；现在不能支撑工程结论。",
            NONE,
            NOT_FOUND,
        ),
        "TH_XDATA_ROWDOWITH": _pack(
            "明细行排版策略。实测 `自动压缩`。",
            "只说明表体如何挤行，不含材料或重量。",
            "与 `bom.序号` 无关的显示策略，审图可忽略。",
            NONE,
            NOT_FOUND,
        ),
        "TH_XDATA_ORIENTION": _pack(
            "属性方向（拼写是 ORIENTION）。实测 `DEFAULT`。",
            "排版枚举，不是视图方向或铁芯取向。",
            "不能与叠片方向组合出任何结论。",
            NONE,
            NOT_FOUND,
        ),
        "TH_XDATA_EDITABLE": _pack(
            "格子是否允许编辑。实测 `True`。",
            "权限标记，不是工程数据。",
            "最多和空材料格一起解释「为什么能填却没填」；不能补材料。",
            NONE,
            NOT_FOUND,
        ),
        "TH_XDATA_ATTDEFHANDLE": _pack(
            "指向属性定义自身 handle。实测与图元 handle 相同（`446D3`）。",
            "自指，不增加新身份。",
            "与 `entity.handle` 对账用；不要当成序号气泡 handle。",
            COMBO,
            ACAD_HANDLE,
        ),
        "TH_XDATA_REFERENCEVALUE": _pack(
            "属性参考值槽。实测空串。",
            "空。",
            "现在不能当默认代号或材料。",
            NONE,
            NOT_FOUND,
        ),
        "TH_XDATA_DEFAULTVALUE": _pack(
            "属性默认值槽。实测空串。",
            "空，不能填补 `bom.材料`。",
            "与空的 `bom.材料`/`title.重量` 一起只能说明「默认也没给」。",
            NONE,
            NOT_FOUND,
        ),
        "TH_EXTENT_XDATA": _pack(
            "天河范围/约束记录。实测含 `CSTRUCT`、`c:pc_yj` 及若干 handle 字符串。",
            "不能从公开文档解出这些 token 的业务含义，单独不能当轮廓。",
            "可与 `entity.handle` 做关联线索，但在没有官方结构说明前，不得当成铁芯级或剖视符号内部参数。",
            NONE,
            NOT_FOUND,
        ),
        "TH_FrameText": _pack(
            "图框文字相关 XData。实测出现在 Wipeout 上（384.1_1 handle `24405`，1005 指向 `72EF`）。",
            "不是标题栏文字本身。",
            "与 `entity.geometry.kind=wipeout` + `entity.layer` 一起，可把图框遮罩从生产几何里剔除（去标注白名单的反向：这些不是零件轮廓）。",
            COMBO,
            NOT_FOUND,
        ),
        "AcDbBlockRepETag": _pack(
            "AutoCAD 动态块替换标记的近亲（公开讨论多见 AcDbBlockRepBTag，ETag 无官方字段文档）。" + ACAD_XDATA,
            "本批图大量普通 Line 也带 1070/1071/1005:\"0\"，不能据此判断动态块。",
            "不要当块名或零件代号。块身份用 `entity.geometry.block_name` + `block.name`。",
            NONE,
            "https://github.com/haplokuon/netDxf/discussions/340 （BTag 类比；ETag 仍无官方说明）",
        ),
        "AcadCodePageInfo": _pack(
            "代码页标记。实测 `CodePage` + 1070:39，常见于 TH_* 专业对象。",
            "只说明历史编码，不是粗糙度值。",
            "与 `TH_DimRough*` 的 xdata 一起看：粗糙度符号上往往只有这包，进一步证明内部 Ra 没抽出来。",
            NONE,
            ACAD_XDATA,
        ),
        "AcadAnnotative": _pack(
            "AutoCAD 注释性对象标记。",
            "可识别注释性文字，但不能区分技术要求与尺寸。",
            "去标注时与 `entity.runtime_class=AcDbMText` + 图层 `文字` 组合，作为标注类候选。",
            COMBO,
            ACAD_XDATA,
        ),
        "ACAD": _pack(
            "通用 ACAD 扩展包，引出/标注上常见 DSTYLE 样式覆盖。",
            "TypedValue 是 DIM 变量碎片，本抽取没有 DIM 样式表深字段，单独还原不出箭头和精度。",
            "与 `entity.geometry.dim_style` 只能对上样式名；去标注认引出靠 `runtime_class=TH_DimLeaderUA` 更直接。",
            NONE,
            ACAD_XDATA,
        ),
        "ACAD_DSTYLE_DIMRADIAL_EXTENSION": _pack(
            "半径/直径标注样式扩展。实测在 `AcDbDiametricDimension` handle `5201`。",
            "不是直径数值（数值在 `text.measurement`）。",
            "与 `entity.geometry.kind=dimension` 组合只说明这是带径向扩展的尺寸对象，供去标注分类。",
            COMBO,
            ACAD_XDATA,
        ),
        "HATCHBACKGROUNDCOLOR": _pack(
            "填充背景色。实测在 Hatch 上。",
            "颜色整数，不是剖面材料。",
            "去标注时 Hatch 本就常作标注/剖面符号；材料仍看 `bom.材料`（本批多为空）。",
            NONE,
            ACAD_XDATA,
        ),
        "CAXA_DRAFT_TXTSCALE": _pack(
            "CAXA 电子图板流转痕迹。实测 Text 上 1041:1。",
            "只能证明这张 DWG 经过 CAXA，没有 CAXA 尺寸值。",
            "与 GENIUS/MARUIYUN 一起做「多 CAD 血统」风险标记：写回必须在 THCAD，避免再降成 proxy。",
            COMBO,
            NOT_FOUND,
        ),
        "MARUIYUN": _pack(
            "第三方插件痕迹。实测 `CopyRight2000.11`。",
            "版权串，零工程含义。",
            "仅作历史流转证据，与去标注/BOM 无关。",
            NONE,
            NOT_FOUND,
        ),
        "PC_MXBTITLERECORD": _pack(
            "明细表表头块上的 PCCAD 包。实测 1070:1 与 1005 自指 handle。",
            "不能当表头文字。",
            "与 `semantic.pc.block_name=PC_MXBTITLERECORD` 一起确认「这张图有明细表表头实例」（709.1_1 没有）。",
            COMBO,
            PCCAD,
        ),
        "GENIUS_GENODEF_13": _pack(
            "老 Genius/InteCAD 血统 XData。",
            "HIER/MANEDIT 等 token 无公开释义。",
            "只作流转痕迹；几何仍用 Line/Polyline 的 start/end。",
            NONE,
            NOT_FOUND,
        ),
        "GENIUS_GENOBJ-N-FIL_13": _pack(
            "Genius 对象过滤标记。实测 OWNER/GEN。",
            "无零件语义。",
            "流转痕迹。",
            NONE,
            NOT_FOUND,
        ),
        "GENIUS_GENOBJ-N-REC_13": _pack(
            "Genius 记录标记。",
            "无零件语义。",
            "流转痕迹。",
            NONE,
            NOT_FOUND,
        ),
        "GENIUS_GENREC_14": _pack(
            "Genius 记录，含 PYDIR/PXDIR 点。",
            "方向点不是沈变铁芯坐标系。",
            "不要当叠片坐标；重建几何用 `entity.geometry`。",
            NONE,
            NOT_FOUND,
        ),
    }
    if app in known:
        return known[app]
    return _pack(
        f"实体 XData 应用名 `{app}`。" + ACAD_XDATA + " 无公开业务字段表。",
        "只有 TypedValue 外壳，不能当专业对象内部值。",
        "可与 `entity.handle` + `entity.runtime_class` 统计「谁身上有这包数据」；在解出 code 含义前不能支撑 BOM 或去标注删除决策。",
        NONE,
        NOT_FOUND,
    )


def _dict_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mechanical = {
        "PC_BOM_DIC": _pack(
            "PCCAD 明细表记录字典，子对象类 TH_BOMRecorder。官网：序号与明细双向关联。",
            "只能拿到 recorder handle 与键 1..N，记录体字段抽不出。",
            "行内容走 `bom.*`；气泡对应走 `PC_BOMXHRELATEDIC`。不要假装 recorder 里有材料。",
            COMBO,
            PCCAD,
        ),
        "PC_BOMXHRELATEDIC": _pack(
            "序号气泡 ↔ 明细行关联字典。键格式 `序号#气泡Handle十进制`。",
            "字典键本身就能解析出序号和气泡 handle（8042 → `1F6A`）。",
            "与 `bom.handle` / `link.item.*` 组合成完整「点气泡到行」。709.1_1 有气泡无明细、709.1_2 有明细无气泡时，这本字典对不上业务。",
            COMBO,
            PCCAD,
        ),
        "PC_MXBSORTDIC": _pack(
            "明细排序字典，TH_BOMSortRecoder。",
            "仅键与 handle，无排序规则正文。",
            "实际行序用 `bom.序号` + 插入点 y；本字典目前不能单独排序。",
            NONE,
            PCCAD,
        ),
        "PC_PAPER_DIC": _pack(
            "图幅记录：TH_CSLRecorder / TH_PaperRecorder / TH_PaperSizeRecorder。",
            "只有类名与 handle，没有图幅尺寸数字。",
            "图幅不能从这里读；比例看 `title.比例`。",
            NONE,
            PCCAD,
        ),
        "PC_CRYPTO_PAPER_DIC": _pack(
            "加密图幅字典。七张 count=0。",
            "空。",
            "无工程用途。",
            NONE,
            PCCAD,
        ),
        "PC_CRYPTO_MXBSORTDIC": _pack(
            "加密排序字典。七张为空。",
            "空。",
            "无工程用途。",
            NONE,
            PCCAD,
        ),
        "PC_ENCRY_BOM_DIC": _pack(
            "加密 BOM 字典。七张为空。",
            "空。",
            "BOM 仍读 `PC_MXB_BLOCK` 属性。",
            NONE,
            PCCAD,
        ),
        "明细表分列记录": _pack(
            "中文键字典，仅 5TBC.384.A110050.1_1 出现。",
            "没有公开列定义，单独不能当第二张明细表。",
            "与该图 45 行 `bom.*` 对照可研究是否分列排版；在解开 items 业务字段前不能当数量来源。",
            NONE,
            NOT_FOUND,
        ),
        "ACAD_LAYOUT": _pack(
            "标准布局字典。",
            "与 `tables.json` layouts 重复。",
            "模型空间实体计数用 `layout.model_type` + `block.entity_count`；本批图纸内容都在 Model。",
            COMBO,
            "AutoCAD named objects dictionary ACAD_LAYOUT",
        ),
        "ACAD_DATALINK": _pack(
            "Excel/表格数据链接字典。仅 384.1_1 出现。",
            "有字典不等于链了铁芯参数表。",
            "未解 items 前不能当叠片参数来源；铁芯一期仍要外部明细表。",
            NONE,
            "AutoCAD DataLink",
        ),
        "ACAD_WIPEOUT_VARS": _pack(
            "Wipeout 系统变量字典。",
            "不是遮罩几何。",
            "遮罩图元看 `entity.geometry.kind=wipeout`（42 个）。",
            COMBO,
            "AutoCAD WIPEOUT",
        ),
    }
    if key in mechanical:
        return mechanical[key]
    if key.startswith("ACAD") or key.startswith("AcDb") or key.startswith("BCAD"):
        return _pack(
            f"命名字典 `{key}`，AutoCAD/浩辰内核条目，字段目录已说明与机械语义无关。",
            "没有沈变标题栏/明细/序号。",
            "最多证明这张 DWG 带标准 CAD 样式/材质/打印容器；审图规则不要读它当 BOM。",
            NONE,
            "AutoCAD Named Objects Dictionary",
        )
    return _pack(
        f"命名字典键 `{key}`。",
        "未见公开机械语义。",
        "先当未知容器，不要映射到件号。",
        NONE,
        NOT_FOUND,
    )


def _custom_prop(obs: dict) -> dict:
    name = obs["verbatim"]
    if name in NOISE_PROPS:
        return _pack(
            f"对 TH_* 专业对象做 .NET 反射得到的基类属性 `{name}`。这是 Teigha/Entity 运行时状态，不是天河件号或粗糙度。",
            "对沈变审图无业务含义。",
            "不要和 `TH_XuHaoEntity` 组合成「序号值」——序号值不在这些属性里。",
            NONE,
            NOT_FOUND,
        )
    useful = {
        "Handle": (
            COMBO,
            "与 `entity.handle` 同值，专业对象外壳的定位键。",
            "和 `link.item.xuhao_handle` 对齐气泡。",
        ),
        "Layer": (
            COMBO,
            "与 `entity.layer` 重复。实测序号多在 `7标注层`。",
            "去标注：`runtime_class` 以 TH_ 开头且图层为标注层 → 标注类。",
        ),
        "Visible": (
            COMBO,
            "可见性。隐藏序号仍可能在数据库里。",
            "与 PCCAD「序号隐藏」命令对应；去标注仍应按类删除而不是只看 Visible。",
        ),
        "Color": (NONE, "颜色对象字符串，不是材料。", "分类请用 runtime_class，不要用颜色猜标注。"),
        "ColorIndex": (NONE, "ACI 色号。", "不能映射 Q355B。"),
        "Linetype": (COMBO, "线型名。", "中心线层常用 CENTER；去标注时中心线是否保留要单独规则，不能靠专业对象属性。"),
        "LineWeight": (NONE, "线宽枚举整数。", "不是板厚。板厚在 `bom.名称` 文本或空的材料格里。"),
        "GeometricExtents": (COMBO, "包围盒字符串。" + ACAD_EXTENTS, "与 `entity.bbox` 同信息，给序号/引出定位。"),
        "Bounds": (COMBO, "另一形式包围盒。", "同 bbox。"),
        "Length": (NONE, "反射到的长度。专业对象 explode 常 eNotApplicable，此长度不是可靠轮廓长。", "铁芯/油箱长度用 Line/Polyline 的 geometry，不要用 TH_* 的 Length。"),
        "Area": (NONE, "面积反射值，专业对象上不可靠。", "不要当油箱容积。"),
        "StartPoint": (NONE, "基类点。不是基准字母。", "基准符号内部字母抽不出。"),
        "EndPoint": (NONE, "基类点。", "引出终点不能当零件锚点除非 explode 成功。"),
        "Closed": (NONE, "是否闭合。", "轮廓闭合看 lwpolyline.closed。"),
        "Normal": (NONE, "法向。二维图几乎是 (0,0,1)。", "不能当叠片法向。"),
        "NumVertices": (NONE, "顶点数。", "专业对象常无真实折线。"),
        "HasArrowHead": (COMBO, "引出是否有箭头。", "去标注认引出优先用类名 TH_DimLeaderUA。"),
        "HasHookLine": (NONE, "钩线标记。", "无件号。"),
        "DimensionStyleName": (COMBO, "标注样式名，如 TH_GBDIM。", "与 `dim_style.name` 对照；DIM 变量仍没抽。"),
        "DimensionStyle": (NONE, "样式 id 字符串。", "用 Name 字段即可。"),
        "Dimtxt": (NONE, "文字高 DIMTXT 反射。", "不是图面尺寸数字。"),
        "Dimscale": (NONE, "标注全局比例。", "绘图比例看 `title.比例`。"),
        "BlockName": (COMBO, "若有块名。", "标题栏/明细识别用 geometry.block_name。"),
        "BlockId": (NONE, "块 ObjectId。", "跨会话用 handle。"),
        "IsAProxy": (COMBO, "TH 侧实测全 false。", "和 `entity.decode_status=full` 一致，说明天河解开了 AutoCAD 里的 zombie。"),
        "IsErased": (NONE, "删除标记。", "抽取遍历的都是未删对象。"),
        "IsPlanar": (NONE, "是否平面。", "二维图信息量低。"),
        "IsPersistent": (NONE, "是否入库。", "无审图含义。"),
        "Annotative": (COMBO, "注释性。", "去标注候选。"),
        "Thickness": (NONE, "CAD thickness，不是钢板厚。", "板厚只可能出现在 `bom.名称` 或 `title.材料标记`。"),
        "Transparency": (NONE, "透明度。", "无。"),
        "XData": (NONE, "反射出的 XData 摘要。", "完整包在 `entity.xdata`。"),
        "ExtensionDictionary": (NONE, "扩展字典 id。", "完整结构在 `entity.extension_dictionary`。"),
        "ObjectId": (NONE, "本次进程 ObjectId。", "持久化用 handle。"),
        "Id": (NONE, "同 ObjectId。", "同 handle。"),
        "OwnerId": (NONE, "所有者 id。", "用 `entity.owner_handle`。"),
        "LayerId": (NONE, "层 id。", "用 `entity.layer` 名。"),
        "LinetypeId": (NONE, "线型 id。", "用名称。"),
        "Material": (NONE, "CAD 渲染材质名，不是 Q355B。", "钢材看 `bom.材料`/`title.材料标记`。"),
        "MaterialId": (NONE, "材质 id。", "同上。"),
        "TextStyleId": (NONE, "文字样式 id。", "样式名看 text_styles。"),
        "Angle": (NONE, "角度反射。", "角度尺寸看 AcDb2LineAngularDimension 的 measurement。"),
        "Delta": (NONE, "向量增量。", "不是公差。"),
        "EndParam": (NONE, "曲线参数。", "重建用 geometry。"),
        "StartParam": (NONE, "曲线参数。", "重建用 geometry。"),
        "FirstVertex": (NONE, "首点。", "不可靠专业对象顶点。"),
        "LastVertex": (NONE, "末点。", "同上。"),
        "IsPeriodic": (NONE, "周期曲线。", "无。"),
        "IsSplined": (NONE, "样条化。", "样条看 geometry.kind=spline。"),
        "Dimasz": (NONE, "箭头尺寸变量。", "DIM 深字段未抽全，本值不能当企业箭头规范。"),
        "Dimclrd": (NONE, "尺寸线颜色。", "无。"),
        "Dimgap": (NONE, "文字间隙。", "无。"),
        "Dimldrblk": (NONE, "引线箭头块。", "无。"),
        "Dimlwd": (NONE, "尺寸线宽。", "无。"),
        "Dimsah": (NONE, "分离箭头。", "无。"),
        "Dimtad": (NONE, "文字垂直位置。", "无。"),
        "Dimtxsty": (NONE, "标注文字样式。", "无。"),
    }
    if name in useful:
        verdict, alone, combo = useful[name]
        return _pack(
            f"TH_* 反射属性 `{name}`。公开文档没有天河专业对象自己的字段表，这些是基类 Entity/Dimension 属性。",
            alone,
            combo,
            verdict,
            NOT_FOUND,
        )
    return _pack(
        f"反射属性 `{name}`，来自 TH_* 外壳。不是粗糙度数值或基准字母。",
        "无直接工程含义。",
        "禁止把反射属性表当成 TH_DimRough / TH_XuHao 的内部参数表。",
        NONE,
        NOT_FOUND,
    )


def _geometry_key(obs: dict) -> dict:
    key = obs["verbatim"]
    table = {
        "kind": _pack(
            "几何分类标签，由 GeometryOf 按 .NET 类型写入。并集含 line/circle/arc/…/wipeout/polyline2d/unparsed/professional。",
            "可直接把 wipeout/dimension/leader/professional 送进去标注桶，把 line/circle/lwpolyline 送进生产几何桶（仍要叠加图层）。",
            "与 `runtime_class` 组合：AcDbPoint→unparsed；TH_*→professional；AttributeDefinition 因继承 DBText 被标成 text（抽取器缺陷）。",
            COMBO,
            "DrawingExtractor.GeometryOf",
        ),
        "start": _pack(
            "直线起点 WCS。" + ACAD_EXTENTS,
            "可重建该线段，但不能知道它是油箱轮廓还是尺寸界线。",
            "与 `end` + `layer` + `runtime_class=AcDbLine` 做轮廓/中心线/虚线分类，是铁芯与油箱几何重建的基本边。",
            COMBO,
            "AutoCAD Line.StartPoint",
        ),
        "end": _pack(
            "直线终点。",
            "同 start。",
            "与 start 算长度，再和 `text.measurement` 比对，做「标注 vs 几何」。",
            COMBO,
            "AutoCAD Line.EndPoint",
        ),
        "center": _pack(
            "圆/弧/椭圆圆心。",
            "孔位候选，但中心线圆也有圆心。",
            "与 `radius` + 图层（轮廓 vs 中心线）区分开孔和符号。",
            COMBO,
            "AutoCAD Circle.Center",
        ),
        "radius": _pack(
            "圆/弧半径，绘图单位。",
            "是几何半径，不一定等于标注的 R 值。",
            "与 `text.measurement`（径向标注）比对；`title.比例` 只是出图比例，模型空间半径通常已是 1:1 毫米（本批 insunits=Undefined，需约定）。",
            COMBO,
            "AutoCAD Circle.Radius",
        ),
        "normal": _pack(
            "平面法向。二维图多为 (0,0,1)。",
            "不能当叠片方向。",
            "仅用于确认图在 XY 平面。",
            NONE,
            "AutoCAD Circle.Normal",
        ),
        "start_angle": _pack(
            "弧/椭圆起始角（弧度）。",
            "可重建弧，不是倒角注释。",
            "与 end_angle、center、radius 重建圆弧轮廓。",
            COMBO,
            "AutoCAD Arc.StartAngle",
        ),
        "end_angle": _pack(
            "弧/椭圆终止角。",
            "同 start_angle。",
            "重建弧段。",
            COMBO,
            "AutoCAD Arc.EndAngle",
        ),
        "major_axis": _pack(
            "椭圆长轴向量。七张里椭圆极少。",
            "单独几乎无产品语义。",
            "与 radius_ratio 重建椭圆孔或符号。",
            COMBO,
            "AutoCAD Ellipse.MajorAxis",
        ),
        "radius_ratio": _pack(
            "椭圆长短轴比。",
            "无。",
            "重建椭圆。",
            COMBO,
            "AutoCAD Ellipse.RadiusRatio",
        ),
        "closed": _pack(
            "多段线/样条是否闭合。",
            "闭合是轮廓候选的强信号。",
            "与 vertices + 图层做油箱/铁芯外轮廓；开口多段线可能是中心线或剖切。",
            COMBO,
            "AutoCAD Polyline.Closed",
        ),
        "elevation": _pack(
            "二维多段线高程。",
            "Z 向偏移，本批二维图通常为 0。",
            "非零时要小心「看起来重合、实际不在一平面」——与铁芯错位无关，先当数据质量问题。",
            NONE,
            "AutoCAD Polyline.Elevation",
        ),
        "constant_width": _pack(
            "多段线全局宽度。",
            "不是板厚。",
            "宽线可能是示意，去标注/净化时按轮廓中心线重建，不要把宽度当钢板。",
            NONE,
            "AutoCAD Polyline.ConstantWidth",
        ),
        "vertex_count": _pack(
            "顶点数。",
            "复杂度指标。",
            "与 vertices_truncated 一起判断轮廓是否被截断（上限 20000）。",
            COMBO,
            "DrawingExtractor MaxPolylineVertices=20000",
        ),
        "vertices_truncated": _pack(
            "顶点是否截断。",
            "true 时几何不完整，不能做轮廓校验。",
            "必须与 vertex_count 一起作为「本图不能自动过」闸门。",
            COMBO,
            "DrawingExtractor",
        ),
        "vertices": _pack(
            "顶点列（point + bulge）。bulge≠0 表示圆弧段。",
            "这是 lwpolyline/polyline2d 重建的本体。",
            "与 closed、图层做生产轮廓；去标注不得删除 bulge 轮廓。",
            COMBO,
            "AutoCAD Polyline.GetPoint3dAt / GetBulgeAt",
        ),
        "degree": _pack(
            "样条次数。",
            "无产品名。",
            "与 control_points 重建样条轮廓（油箱圆角等）。",
            COMBO,
            "AutoCAD Spline.Degree",
        ),
        "control_point_count": _pack(
            "样条控制点数。",
            "同 vertex_count。",
            "与 truncated 标志一起做完整性闸门。",
            COMBO,
            "AutoCAD Spline.NumControlPoints",
        ),
        "control_points_truncated": _pack(
            "样条控制点截断（上限 8000）。",
            "截断则不能校验。",
            "与 count 组合。",
            COMBO,
            "DrawingExtractor MaxSplinePoints=8000",
        ),
        "control_points": _pack(
            "样条控制点坐标。",
            "可重建曲线。",
            "生产几何白名单。",
            COMBO,
            "AutoCAD Spline.GetControlPointAt",
        ),
        "position": _pack(
            "文字/块插入点/属性定义位置。",
            "可定位标题栏、气泡邻域、明细行。",
            "标题栏/明细用块 position；序号定位优先用专业对象 bbox，因为气泡内部参数没有。",
            COMBO,
            "AutoCAD BlockReference.Position / DBText.Position",
        ),
        "height": _pack(
            "文字高度。",
            "排版，不是件高。",
            "去标注可辅助区分标题栏大字与细小注释，但不能当尺寸。",
            NONE,
            "AutoCAD DBText.Height",
        ),
        "rotation": _pack(
            "文字或块旋转角（弧度）。",
            "可摆正块，无产品语义。",
            "重建块插入时与 scale、position 组成变换；嵌套块的完整矩阵本抽取只有一层 block_path。",
            COMBO,
            "AutoCAD BlockReference.Rotation",
        ),
        "alignment": _pack(
            "单行文字对齐点。",
            "排版。",
            "OCR/抓字时用，不参与几何校验。",
            NONE,
            "AutoCAD DBText.AlignmentPoint",
        ),
        "horizontal_mode": _pack(
            "文字水平对齐模式。实测 attDef 常见 TextFit。",
            "排版枚举。",
            "无审图规则。",
            NONE,
            "AutoCAD TextHorizontalMode",
        ),
        "location": _pack(
            "MText 插入点。",
            "定位技术要求段落。",
            "与 `text.plain` + 图层 `6文字层`/`文字` 区分技术要求 vs 尺寸。软规则才判断要不要保留。",
            COMBO,
            "AutoCAD MText.Location",
        ),
        "width": _pack(
            "MText 栏宽。",
            "排版。",
            "无。",
            NONE,
            "AutoCAD MText.Width",
        ),
        "attachment": _pack(
            "MText 附着点枚举。",
            "排版。",
            "无。",
            NONE,
            "AutoCAD MText.Attachment",
        ),
        "block_name": _pack(
            "块参照名。PC_TITLE_BLOCK / PC_MXB_BLOCK 是机械语义入口。",
            "见到 PC_TITLE_BLOCK 就能知道这是标题栏实例（七张各 1 个）。",
            "与 attributes.tag 组合成标题栏/明细字段；MYX* 是零件块，*Dnn 是标注匿名块（去标注可整块丢掉）。",
            ALONE,
            PCCAD,
        ),
        "scale": _pack(
            "块 XYZ 比例。",
            "不是 `title.比例` 出图比例。",
            "重建插入变换；镜像可能出现负比例。",
            COMBO,
            "AutoCAD BlockReference.ScaleFactors",
        ),
        "is_dynamic": _pack(
            "是否动态块。字段目录：只抽到布尔，没有动态参数表。",
            "true/false 本身不能还原可见性状态。",
            "动态参数求值表未抽，不能当配置表。块几何仍看炸开前的定义实体。",
            NONE,
            "AutoCAD BlockReference.IsDynamicBlock",
        ),
        "pattern": _pack(
            "填充图案名。",
            "ANSI31 等是剖面符号，不是材料牌号。",
            "去标注：hatch 默认进标注/符号桶；边界环点列未抽（字段目录已写明）。",
            COMBO,
            "AutoCAD Hatch.PatternName",
        ),
        "pattern_type": _pack(
            "填充图案类型枚举。",
            "无材料。",
            "同 pattern。",
            NONE,
            "AutoCAD Hatch.PatternType",
        ),
        "associative": _pack(
            "填充是否关联边界。",
            "true 也不给边界点列。",
            "不能靠它重建剖面区域多边形。",
            NONE,
            "AutoCAD Hatch.Associative",
        ),
        "hatch_style": _pack(
            "填充样式（普通/最外层/忽略）。",
            "无。",
            "无边界环则不能做包含判断。",
            NONE,
            "AutoCAD Hatch.HatchStyle",
        ),
        "dim_type": _pack(
            "尺寸 .NET 类型名：RotatedDimension / AlignedDimension / DiametricDimension 等。",
            "可区分线性/直径/半径/角度，供去标注分类。",
            "数值用 `text.measurement`；显示用 `text.dimension_text`。",
            COMBO,
            "AutoCAD Dimension subclasses",
        ),
        "measurement": _pack(
            "尺寸真实测量值（与 text.measurement 同源）。" + ACAD_DIMTEXT,
            "这是「几何测到的数」，不是用户覆盖文字。",
            "与 `text.dimension_text` 对比：384.1_1 handle `7326` 测量 306.5 但文字 `{600}{}{}{}`，正是标注 vs 几何。再与 Line 长度交叉验证铁芯/油箱尺寸。",
            COMBO,
            ACAD_DIMTEXT,
        ),
        "text_position": _pack(
            "尺寸文字位置。",
            "可定位尺寸数字，不是被测边。",
            "去标注删除尺寸实体时用；不要当孔坐标。",
            COMBO,
            "AutoCAD Dimension.TextPosition",
        ),
        "dim_style": _pack(
            "尺寸样式名。实测 TH_GBDIM 等。",
            "名称级，无箭头/精度。",
            "与 `dim_style.name` 表对照；精度仍未知，不能用样式名代替公差。",
            COMBO,
            "AutoCAD Dimension.DimensionStyleName",
        ),
        "has_arrow_head": _pack(
            "Leader 是否有箭头。",
            "去标注：标准 Leader 与 TH_DimLeaderUA 都是引出类。",
            "与 runtime_class 组合。",
            COMBO,
            "AutoCAD Leader.HasArrowHead",
        ),
        "rows": _pack(
            "AcDbTable 行数。抽取器会写，七张未出现 Table 实体。",
            "key absent on all seven drawings。",
            "铁芯参数表不在 DWG Table 里。",
            NONE,
            "AutoCAD Table.Rows",
        ),
        "columns": _pack(
            "AcDbTable 列数。七张 absent。",
            "key absent on all seven drawings。",
            "同 rows。",
            NONE,
            "AutoCAD Table.Columns",
        ),
        "number": _pack(
            "Viewport 编号。七张图纸空间 0 实体，key absent。",
            "无。",
            "本批图都在模型空间。",
            NONE,
            "AutoCAD Viewport.Number",
        ),
        "on": _pack(
            "Viewport 开关。absent。",
            "无。",
            "无。",
            NONE,
            "AutoCAD Viewport.On",
        ),
        "custom_scale": _pack(
            "视口自定义比例。absent。",
            "无。出图比例看标题栏。",
            "无。",
            NONE,
            "AutoCAD Viewport.CustomScale",
        ),
        "tag": _pack(
            "AttributeDefinition 的 tag 几何字段。因 GeometryOf 先匹配 DBText，本键在七张上 absent。",
            "key absent on all seven drawings。attDef 被写成 geometry.kind=text。",
            "实际 tag 要从块参照 `entity.attributes.tag` 读，或从 TH_XDATA_CODE 间接读。",
            NONE,
            "DrawingExtractor.GeometryOf 顺序：DBText 先于 AttributeDefinition",
        ),
        "invisible": _pack(
            "attDef 不可见标志。七张 geometry 上 absent（同上原因）。",
            "key absent on all seven drawings。",
            "块属性可见性看 `entity.attributes.invisible`。",
            NONE,
            "DrawingExtractor",
        ),
        "rx": _pack(
            "professional 几何里的 RX 类名，与 runtime_class 重复。",
            "TH_XuHaoEntity 等，可分类。",
            "去标注主规则：rx 以 TH_ 开头 → 标注类专业对象。内部值仍没有。",
            COMBO,
            NOT_FOUND,
        ),
        "custom": _pack(
            "professional 几何内嵌的 custom 载荷（与 entity.custom 重复一份）。",
            "含 explode_error=eNotApplicable 时没有子图形。",
            "见 entity.custom.*。",
            COMBO,
            NOT_FOUND,
        ),
        "managed_type": _pack(
            "unparsed 几何上的 .NET 类型名。实测 2276 个全是 Point。",
            "点对象没有坐标几何（也常无 bbox）。",
            "这些点不能当孔位；孔位用 Circle 或参数表。",
            NONE,
            "DrawingExtractor: Point → kind=unparsed",
        ),
        "error": _pack(
            "GeometryOf 异常时的错误串。七张未出现 kind=error。",
            "key absent on all seven drawings。",
            "若将来出现，该图元不能参与几何校验。",
            NONE,
            "DrawingExtractor.GeometryOf catch",
        ),
    }
    return table.get(key, _generic(obs))


def _color_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "index": _pack(
            "ACI 颜色号。" + "Entity.Color.ColorIndex。",
            "色号不是图层功能名。",
            "ByLayer 时要看 `is_by_layer` + `layer.color`；不要用青色=标注这种脆弱规则，去标注以类名和层名为准。",
            COMBO,
            "AutoCAD Entity.Color",
        ),
        "is_by_layer": _pack(
            "颜色是否随层。",
            "true 时 index 不代表实体自有色。",
            "与 layer.color 组合才得到显示色。",
            COMBO,
            "AutoCAD Color.IsByLayer",
        ),
        "is_by_block": _pack(
            "颜色是否随块。",
            "块内实体常见。",
            "与块参照颜色组合；分类仍用层/类。",
            COMBO,
            "AutoCAD Color.IsByBlock",
        ),
        "name": _pack(
            "颜色 ToString，如 `BYLAYER` 或 `cyan`。",
            "便于阅读，不是标准名。",
            "同 index。",
            NONE,
            "AutoCAD Color.ToString",
        ),
    }
    return mapping.get(key, _generic(obs))


def _bbox_key(obs: dict) -> dict:
    key = obs["verbatim"]
    cad = ACAD_EXTENTS + " 部分对象（如许多 AcDbPoint）没有 bbox。"
    if key == "min":
        return _pack(cad, "最小角点可定位对象邻域。", "与 max 组成框，给序号/引出/标题栏做空间索引；点对象无 bbox 时不能用。", COMBO, ACAD_EXTENTS)
    return _pack(cad, "最大角点。", "与 min 组合。", COMBO, ACAD_EXTENTS)


def _text_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "contents": _pack(
            "MText 带格式的 Contents。",
            "可能含 {\\f…} 格式码，不适合直接当尺寸。",
            "与 `plain` 组合取可读技术要求；去标注时 MText 默认标注类，是否保留给软规则。",
            COMBO,
            "AutoCAD MText.Contents",
        ),
        "plain": _pack(
            "MText 纯文本。",
            "可读说明文字。",
            "与图层、位置判断是技术要求还是重复的尺寸字。",
            COMBO,
            "AutoCAD MText.Text",
        ),
        "tag": _pack(
            "AttributeReference/Definition 的 tag。因 TextOf 先匹配 DBText，attDef 的 text 变成空字符串，本键七张 absent。",
            "key absent on all seven drawings。",
            "真正的中文 tag 在 `entity.attributes.tag`。",
            NONE,
            "DrawingExtractor.TextOf 顺序",
        ),
        "prompt": _pack(
            "attDef 提示语。七张 absent。",
            "key absent on all seven drawings。",
            "无。",
            NONE,
            "DrawingExtractor.TextOf",
        ),
        "value": _pack(
            "属性值。七张 text 对象上 absent（属性值在 attributes[]）。",
            "key absent on all seven drawings。",
            "读 `entity.attributes.value` 或 `title.*`/`bom.*`。",
            NONE,
            "DrawingExtractor.TextOf",
        ),
        "dimension_text": _pack(
            "尺寸显示文字，空表示用测量值。" + ACAD_DIMTEXT,
            "空串=显示测量；`{600}{}{}{}` 这类是 PCCAD 参数/覆盖，不能当毫米数。",
            "与 `text.measurement` / `geometry.measurement` 做标注 vs 几何：覆盖存在就不要用图面字当真实长。",
            COMBO,
            ACAD_DIMTEXT,
        ),
        "measurement": _pack(
            "尺寸测量值，与 geometry.measurement 同义重复一份。",
            "真实长度/角度（CAD 单位）。",
            "与 dimension_text、以及对应边 geometry 长度三联校验。insunits=Undefined，需约定 1 单位=1 mm。",
            COMBO,
            ACAD_DIMTEXT,
        ),
    }
    return mapping.get(key, _generic(obs))


def _attr_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "handle": _pack(
            "属性参照自己的 handle。" + ACAD_HANDLE,
            "可定位格子图元。",
            "与块 handle（标题栏 438F）区分：这是格子，不是整栏。",
            COMBO,
            ACAD_HANDLE,
        ),
        "tag": _pack(
            "属性标签。中文 tag 即 `产品型号`/`序号`/`代号` 等。",
            "tag 是字段名，值在 value。",
            "SemanticBlock 靠 tag 聚合成 title.* / bom.*。这是机械三张表的来源。",
            COMBO,
            PCCAD,
        ),
        "value": _pack(
            "属性文字值。空串表示图上没填。",
            "直接就是格子内容。",
            "按 tag 分流到标题栏或明细；空值要保留以区分漏抽。",
            ALONE,
            PCCAD,
        ),
        "invisible": _pack(
            "属性是否不可见。PCCAD 有「隐藏字段显示出来了」类问题（官网 FAQ）。",
            "不可见属性仍可能有值。",
            "导出 BOM 应包含 invisible 格子，但去标注不必把可见性当删除依据。",
            COMBO,
            "https://www.thcad.net/ （标题栏/明细隐藏字段 FAQ）",
        ),
        "position": _pack(
            "属性插入点。",
            "可把格子排成表。",
            "明细行 y 递增（试点图 x=16120，y 每行 +140）可校验行序是否与 `bom.序号` 一致。",
            COMBO,
            "AutoCAD AttributeReference.Position",
        ),
    }
    return mapping.get(key, _generic(obs))


def _explode_key(obs: dict) -> dict:
    key = obs["verbatim"]
    if key in ("string", "contents", "plain"):
        return _pack(
            "专业对象 Explode 得到的文字。仅 explode 成功时存在（179 次成功 / 271 次 eNotApplicable）。",
            "若有字，可能是气泡看起来的数字，但官方不保证这是序号真源。",
            "序号真源是 `PC_BOMXHRELATEDIC`；explode 文字只作对照。粗糙度 explode 失败，得不到 Ra。",
            COMBO,
            NOT_FOUND,
        )
    if key in ("position", "height", "bbox", "layer", "rx", "kind"):
        return _pack(
            f"explode 子图元的 `{key}`。",
            "只有外壳几何，不是专业参数。",
            "explode 成功时可辅助画气泡/引出的样子；失败则完全没有。去标注仍按父对象 runtime_class 删除。",
            COMBO,
            NOT_FOUND,
        )
    return _generic(obs)


def _custom_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "managed_type": _pack(
            "专业对象 .NET 全名。",
            "确认宿主解出了真类而不是 proxy。",
            "与 runtime_class 对照。",
            COMBO,
            "DrawingExtractor.CustomPayload",
        ),
        "rx": _pack(
            "RX 类名，同 runtime_class。",
            "去标注分类键。",
            "TH_DimRough2010 / TH_DimRoughA 可定位粗糙度符号，值仍没有。",
            COMBO,
            NOT_FOUND,
        ),
        "explode": _pack(
            "Explode 子图元列表。",
            "成功才有零件外观的标准图元。",
            "失败见 explode_error。不要把空 explode 解释成「没有序号」。",
            COMBO,
            "Entity.Explode",
        ),
        "explode_count": _pack(
            "explode 子图元个数。",
            "0 或缺失表示没炸开。",
            "与 explode_error 一起。",
            COMBO,
            "DrawingExtractor",
        ),
        "explode_error": _pack(
            "炸开失败信息。实测专业对象大量 `eNotApplicable`。",
            "明确告诉你拿不到内部分解图形。",
            "与 runtime_class 组合：外壳可分类，值不可读——这是去标注能做、铁芯参数不能从符号读的根因。",
            COMBO,
            "Teigha/AutoCAD eNotApplicable",
        ),
        "properties": _pack(
            "反射属性包，95 个基类属性名。",
            "不是天河专业字段表。",
            "逐项见 entity.custom.properties.*；禁止从这里「发现」粗糙度。",
            NONE,
            NOT_FOUND,
        ),
    }
    return mapping.get(key, _generic(obs))


def _proxy_key(obs: dict) -> dict:
    return _pack(
        "ProxyEntity 字段。TH 侧七张 decode_status 全是 full，proxies.jsonl 空，这些键 absent。",
        "key absent on all seven drawings。",
        "AutoCAD 侧同类图是 AcDbZombieEntity。本抽取在天河跑，不需要 proxy 回退。",
        NONE,
        "AutoCAD ProxyEntity",
    )


def _extdict_key(obs: dict) -> dict:
    key = obs["verbatim"]
    if key == "error":
        return _pack(
            "扩展字典打不开时的错误。七张未见该键。",
            "key absent on all seven drawings。",
            "无。",
            NONE,
            "DrawingExtractor.ExtDictOf",
        )
    return _pack(
        f"实体扩展字典 `{key}`（handle/runtime_class/count/items/is_proxy）。字段目录：专业气泡上往往没有。",
        "有字典不等于有业务字段。",
        "items 未做专业解析；机械语义优先块属性与 NOD 的 PC_* 键。",
        NONE,
        "AutoCAD Extension Dictionary",
    )


def _host_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "application": _pack("宿主名，固定 THCAD。", "确认抽取侧是天河不是 AutoCAD。", "与底座选型一致：写图必须 TH 侧。", ALONE, "DrawingExtractor.HostInfo"),
        "application_version": _pack("内核版本 23.2.4.0。", "可钉抽取环境。", "升级 THCAD 时与插件版本一起做回归。", COMBO, "Bricscad.ApplicationServices.Application.Version"),
        "plugin": _pack("插件名 Shb.Thcad.Extractor。", "追溯抽取器。", "与 plugin_version 组合。", COMBO, "HostInfo"),
        "plugin_version": _pack("0.2.0。", "字段集合版本。", "升插件要重跑覆盖率。", COMBO, "HostInfo"),
        "clr": _pack("CLR 4.0.30319。", "运行时。", "无产品语义。", NONE, "Environment.Version"),
        "machine": _pack("抽取机名 AMADESU。", "审计用。", "不要当项目号。", NONE, "Environment.MachineName"),
    }
    return mapping.get(key, _generic(obs))


def _report_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "schema_version": _pack("报告 schema。", "目前为 1。", "与 drawing.schema_version 对齐。", COMBO, "DrawingExtractor SchemaVersion"),
        "source": _pack("来源标签 thcad_v24_dotnet。", "区分 AutoCAD 抽取。", "对账时两边 source 不同。", ALONE, "SourceTag"),
        "drawing_id": _pack("目录名/图档 id。", "等于文件 stem。", "与 filename、title.图样代号 三方配对。", COMBO, "SafeStem"),
        "source_path": _pack("源 DWG 路径。", "可追溯 client-data。", "不要当图号。", COMBO, "Database.Filename"),
        "source_sha256": _pack("源文件 SHA-256。字段目录没把此键写成表列，数据里有。", "文件身份，防抽错版本。", "铁芯场景第一步文件配对：sha256 + 图样代号 + 页次。", ALONE, "DrawingExtractor.TryHash"),
        "source_size_bytes": _pack("源文件字节数。", "粗粒度完整性。", "与 sha256 一起，不能替代图号。", COMBO, "FileInfo.Length"),
        "started_at": _pack("抽取开始 UTC。", "审计。", "无产品。", NONE, "DateTime.UtcNow"),
        "completed_at": _pack("抽取结束 UTC。", "审计。", "无产品。", NONE, "DateTime.UtcNow"),
        "elapsed_ms": _pack("耗时。最大图约数秒。", "性能。", "无产品。", NONE, "DrawingExtractor"),
        "host": _pack("宿主对象。细项见 host.*。", "容器。", "用子字段。", COMBO, "HostInfo"),
        "entity_count": _pack("遍历到的实体数（含块定义）。", "体量。384.2_1=3570。", "与 type_counts 对账；注意含 block_definition，不等于模型空间数。", COMBO, "DrawingExtractor"),
        "proxy_count": _pack("proxy 数。TH 侧七张全 0。", "说明专业对象已是真类。", "若非 0 则去标注缺少类名。", ALONE, "Entity.IsAProxy"),
        "failed_count": _pack("序列化失败数。七张 0。", "抽取质量闸门。", "非 0 不能静默审图。", ALONE, "DrawingExtractor"),
        "did_not_save": _pack("恒 true：旁数据库只读、不写回 DWG。", "证明没有改原图。", "符合「永远不直接改原图」。", ALONE, "DrawingExtractor"),
        "type_counts": _pack("runtime_class 直方图。", "立刻看到 TH_XuHaoEntity/尺寸/Line 各多少。", "去标注工作量估计；与 entities.jsonl 逐条对账。", COMBO, "DrawingExtractor"),
        "layer_counts": _pack("按层计数。", "7标注层往往最多。", "层名规则的前置统计。", COMBO, "DrawingExtractor"),
        "owner_scope_counts": _pack("model_space vs block_definition vs paper_space。", "本批 paper_space=0。", "生产几何以 model_space 为主，块定义里的几何是零件块。", COMBO, "OwnerScope"),
        "decode_status_counts": _pack("full/proxy。七张 full=全部。", "解码质量。", "全 full 才能靠 runtime_class 去标注。", COMBO, "decode_status"),
        "semantic_title_blocks": _pack("标题栏实例数。七张都是 1。", "缺 0 则无图号。", "与 title_blocks 数组长度一致。", ALONE, "CollectSemantic"),
        "semantic_bom_rows": _pack("明细行数。709.1_1 与 312.101_1 为 0。", "0 表示这张没有明细表，不是漏抽。", "与序号气泡数对照发现不齐。", ALONE, "CollectSemantic"),
        "semantic_pc_blocks": _pack("其它 PC 块数。", "通常含图框/附加栏/代号栏/表头。", "709.1_1 无 MXBTITLERECORD。", COMBO, "CollectSemantic"),
        "semantic_professional_entities": _pack("TH_* 外壳数。", "去标注对象池大小。", "与 type_counts 中 TH_ 合计核对。", COMBO, "CollectSemantic"),
        "output_dir": _pack("本图 JSON 输出目录。", "定位原始抽取。", "无产品。", NONE, "DrawingExtractor"),
    }
    return mapping.get(key, _generic(obs))


def _drawing_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "schema_version": _pack("drawing.json schema。", "目前 1。", "读数器要钉版本。", COMBO, "SchemaVersion=1"),
        "drawing_id": _pack("文件 stem。如 5TBC.709.A110050.1_1。", "页次在 id 末尾，不在图样代号里。", "与 title.图样代号 + title.第几页 配对：709 两页共用代号 `5TBC.709.A110050.1`。", COMBO, "SafeStem"),
        "source_path": _pack("绝对路径。", "追溯。", "不要解析当图号。", COMBO, "Database.Filename"),
        "filename": _pack("DWG 文件名。", "含 `_页次`。", "必须与 图样代号 组合：文件名 `5TBC.384.A110050.2_1.DWG` vs 代号 `5TBC.384.A110050.2`。", COMBO, "Path.GetFileName"),
        "source": _pack("thcad_v24_dotnet。", "宿主标记。", "同 report.source。", ALONE, "SourceTag"),
        "tile_mode": _pack("Database.TileMode。true=当前在模型空间。字段目录未单列此键，数据里有。", "七张全 true。", "与 layouts 的 Model 实体数一起证明内容在模型空间，图纸空间空。", COMBO, "Teigha Database.TileMode"),
        "measurement": _pack("Database.Measurement=Metric。", "公制绘图。", "与 insunits=Undefined 组合：单位仍要约定 mm，不能只信这个枚举。", COMBO, "Database.Measurement"),
        "insunits": _pack("插入单位。七张 Undefined。字段目录未单列。", "单独不能换算。", "铁芯毫米判定必须外部约定 1 单位=1mm，否则 measurement 不能当 mm。", COMBO, "Database.Insunits"),
        "original_file_version": _pack("OriginalFileVersion=Current。", "对审图几乎无信息。", "不能当企业图样版本。版本看改版栏（全空）和文件名。", NONE, "Database.OriginalFileVersion"),
        "last_saved_as_version": _pack("LastSavedAsVersion=MC0To0（TH/BricsCAD 枚举）。", "不能当 A/B 版。", "无。", NONE, "Database.LastSavedAsVersion"),
        "block_inventory": _pack("块清单一份拷贝，与 tables.blocks 相同。", "容器。", "逐字段看 block.*。", COMBO, "DumpTables"),
    }
    return mapping.get(key, _generic(obs))


def _table_col(obs: dict) -> dict:
    scope = obs["scope"]
    col = obs["verbatim"]
    if scope == "layer":
        m = {
            "name": _pack("图层名。沈变图用「7标注层」「1轮廓实线层」「4油箱-1轮廓线」「1铁心-1轮廓线」等。", "层名是去标注最强启发式之一。", "必须与 runtime_class 组合：标注层上仍有轮廓，轮廓层上也可能有文字。", COMBO, "PCCAD 图层变换命令（数字切层）https://www.thcad.net/5485.html"),
            "handle": _pack("层表记录 handle。", "稳定 id。", "实体只有层名没有层 handle；对账用名字。", COMBO, ACAD_HANDLE),
            "off": _pack("层是否关闭。七张仅 `消隐层` 为是。", "关闭层上的消隐线默认不是生产轮廓。", "去标注/净化：off=true 的消隐层可进非生产桶，但仍要人工确认装配消隐规则。", COMBO, "LayerTableRecord.IsOff"),
            "frozen": _pack("冻结。七张全否。", "无冻结层。", "若将来有冻结标注层，分类时仍要读实体，不要假设冻结=不存在。", NONE, "LayerTableRecord.IsFrozen"),
            "locked": _pack("锁定。七张全否。", "无。", "锁定不改变几何。", NONE, "LayerTableRecord.IsLocked"),
            "color": _pack("层颜色。7标注层=cyan。", "显示色。", "不要只靠青色识别标注。", NONE, "LayerTableRecord.Color"),
            "linetype": _pack("层缺省线型。3中心线层=CENTER。", "中心线层提示。", "实体可能覆盖线型，要用 entity.linetype。", COMBO, "LayerTableRecord.Linetype"),
        }
        return m.get(col, _generic(obs))
    if scope == "linetype":
        m = {
            "name": _pack("线型名 Continuous/DASHED/CENTER/…。", "中心线/虚线分类线索。", "与图层、实体线型一起；去标注时中心线常需保留给加工。", COMBO, "LinetypeTableRecord.Name"),
            "handle": _pack("线型 handle。", "id。", "对账用名。", COMBO, ACAD_HANDLE),
            "ascii_description": _pack("线型 ASCII 描述。", "图案说明。", "无产品。", NONE, "LinetypeTableRecord.AsciiDescription"),
        }
        return m.get(col, _generic(obs))
    if scope == "text_style":
        m = {
            "name": _pack("文字样式名 Standard/TH_GBDIM/PC_TEXTSTYLE/THXuHaoStyle。", "THXuHaoStyle 提示序号文字，但气泡内部字仍抽不出。", "缺字库时 font 为空，属性值仍在。", COMBO, "https://www.jb51.net/softs/556498.html （社区对 TH_GBDIM/PC_TEXTSTYLE/THXuHaoStyle 的说明）"),
            "handle": _pack("样式 handle。", "id。", "用名。", COMBO, ACAD_HANDLE),
            "font_file": _pack("西文字体文件。本机缺天河库时 TH_GBDIM 为空。", "空不表示没字。", "不要因缺字体判图纸无效。", NONE, "TextStyleTableRecord.FileName"),
            "big_font_file": _pack("大字体（中文）如 hzfs.shx。", "中文显示。", "同 font_file。", NONE, "TextStyleTableRecord.BigFontFileName"),
            "text_size": _pack("样式默认字高，实测 0（用实体字高）。", "0 无信息。", "用 geometry.height。", NONE, "TextStyleTableRecord.TextSize"),
        }
        return m.get(col, _generic(obs))
    if scope == "dim_style":
        m = {
            "name": _pack("标注样式名 TH_GBDIM/ISO-25/…。字段目录：没有 DIM 变量。", "只能知道用了哪套名。", "精度/箭头未知，不能用样式名做公差判定。", NONE, "DimStyleTableRecord.Name"),
            "handle": _pack("样式 handle。", "id。", "用名。", COMBO, ACAD_HANDLE),
        }
        return m.get(col, _generic(obs))
    if scope == "reg_app":
        m = {
            "name": _pack("已注册 XData 应用名。注册≠实体上有值。", "清单。", "真正有值的看 entity.xdata.*。TH_SUPERPART 等可能只注册未挂值。", COMBO, ACAD_XDATA),
            "handle": _pack("RegApp handle。", "id。", "用名。", COMBO, ACAD_HANDLE),
        }
        return m.get(col, _generic(obs))
    if scope == "layout":
        m = {
            "name": _pack("布局名 Model/布局1/布局2。", "本批内容在 Model。", "与 model_type、block.entity_count 组合。", COMBO, "Layout.LayoutName"),
            "handle": _pack("布局 handle。", "id。", "用。", COMBO, ACAD_HANDLE),
            "tab_order": _pack("选项卡顺序。", "UI。", "无产品。", NONE, "Layout.TabOrder"),
            "model_type": _pack("是否模型空间布局。", "true=Model。", "图纸空间 0 实体，审图只扫模型。", COMBO, "Layout.ModelType"),
            "block_handle": _pack("布局对应块表记录。", "连到 *Model_Space。", "用 block.entity_count 看空间内实体数。", COMBO, "Layout.BlockTableRecordId"),
        }
        return m.get(col, _generic(obs))
    if scope == "block":
        m = {
            "name": _pack("块名。PC_* 机械块、MYX* 零件、*Dnn 标注匿名块。", "*Dnn 匿名块可整类视为标注定义。", "实例还看 entity.geometry.block_name；xref_path 本批皆空。", COMBO, PCCAD),
            "handle": _pack("块定义 handle。", "定义 id，不同于插入实例 handle。", "实例用 entity.handle。", COMBO, ACAD_HANDLE),
            "owner_scope": _pack("model_space/paper_space/block_definition。", "空间。", "与实体 owner_scope 一致。", COMBO, "OwnerScope"),
            "is_layout": _pack("是否布局空间块。", "过滤 *Model_Space。", "布局块不要当零件。", COMBO, "BlockTableRecord.IsLayout"),
            "is_anonymous": _pack("匿名块。大量 *D 尺寸块。", "true → 标注定义候选。", "去标注：匿名块定义里的线不要复制到生产 DXF。", COMBO, "BlockTableRecord.IsAnonymous"),
            "is_from_xref": _pack("是否外参。七张全 false。", "本批无 xref。", "若将来 true，要先解析 xref_path。", NONE, "BlockTableRecord.IsFromExternalReference"),
            "xref_path": _pack("外参路径。七张空串。", "无外参。", "空就不能当装配引用。", NONE, "BlockTableRecord.PathName"),
            "has_attribute_definitions": _pack("是否有属性定义。PC_TITLE/MXB/FJL/CSL/TYDH 为 true。", "机械块入口。", "与 CollectSemantic 的块名规则一致。", COMBO, "BlockTableRecord.HasAttributeDefinitions"),
            "entity_count": _pack("块内实体数。*Model_Space 在试点图 1487。", "体量。", "定义里的 99 个实体是标题栏格子图形，不是 99 个零件。", COMBO, "BlockTableRecord enumerator"),
            "origin": _pack("块原点。多数 [0,0,0]，箭头块有非零。", "插入基点。", "与实例 position 组成变换。", COMBO, "BlockTableRecord.Origin"),
        }
        return m.get(col, _generic(obs))
    return _generic(obs)


def _sem_block(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "kind": _pack("语义记录类型 title_block/bom_row/pc_block。", "分流。", "同一 handle 在 entities.jsonl 也有一条。", COMBO, "SemanticBlock"),
        "handle": _pack("块参照 handle。标题栏试点图 `438F`。", "定位主键。", "在 CAD 里高亮该 handle。", ALONE, ACAD_HANDLE),
        "block_name": _pack("PC_TITLE_BLOCK 等。", "识别机械块。", "与 geometry.block_name 相同。", ALONE, PCCAD),
        "position": _pack("插入点。明细行 x 固定、y 递增。", "可排序行。", "与 bom.序号 交叉验证行序。", COMBO, "BlockReference.Position"),
        "xdata": _pack("块上的 XData。标题栏记录常省略（null 被 JSON 丢掉）；明细行有 TH_XUHAO。", "有则带序号。", "见 entity.xdata.TH_XUHAO。", COMBO, ACAD_XDATA),
        "fields": _pack("tag→value 映射。标题栏 30 键、明细 8 键七张一致。", "机械业务表本体。", "逐 tag 见 title.* / bom.* / pc.*。", ALONE, PCCAD),
    }
    return mapping.get(key, _generic(obs))


def _sem_prof(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "handle": _pack("专业对象 handle。试点气泡 `1F6A`。", "可高亮。", "与 PC_BOMXHRELATEDIC 的气泡 handle 对齐。", COMBO, ACAD_HANDLE),
        "runtime_class": _pack("TH_XuHaoEntity / TH_DimLeaderUA / TH_ParaBasePntUA / TH_CVArrowLine / TH_DimRough2010 / TH_DimRoughA。", "去标注分类的金标准（AutoCAD 里这些是 zombie）。", "不要指望这里出现 Ra 或基准字母。", ALONE, PCCAD + " 符号命令 PC_CCD/PC_JZBZ https://www.thcad.net/5485.html"),
        "layer": _pack("所在层，多为 7标注层。", "辅证。", "与类名双保险。", COMBO, "Entity.Layer"),
        "bbox": _pack("包围盒。点不到内部锚点时用框。", "空间索引。", "点气泡找附近轮廓。", COMBO, ACAD_EXTENTS),
        "xdata": _pack("专业对象 XData。粗糙度实测往往只有 AcadCodePageInfo。", "证明内部值没挂在 XData。", "禁止把 code page 当 Ra。", NONE, NOT_FOUND),
        "custom": _pack("反射+explode 载荷。", "壳。", "见 entity.custom.*。", COMBO, NOT_FOUND),
    }
    return mapping.get(key, _generic(obs))


def _sem_top(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "schema_version": _pack("语义文件 schema。", "1。", "同 drawing。", COMBO, "DrawingExtractor"),
        "source": _pack("thcad_v24_dotnet。", "来源。", "同。", ALONE, "SourceTag"),
        "drawing_id": _pack("图 id。", "配对。", "同 drawing_id。", COMBO, "SafeStem"),
        "title_blocks": _pack("标题栏数组。七张各 1。", "图号入口。", "元素字段见 semantic.title.*。", ALONE, PCCAD),
        "bom_rows": _pack("明细行数组。可空。", "0 行是图纸性质。", "与序号气泡数对比。", ALONE, PCCAD),
        "other_pc_blocks": _pack("其它 PC/PCCAD 块。", "图框与附加栏。", "无属性的 PCCAD_TEMPLATE 不能当标题栏。", COMBO, PCCAD),
        "professional_entities": _pack("TH_* 列表。", "去标注对象池。", "逐条 runtime_class。", ALONE, NOT_FOUND),
    }
    return mapping.get(key, _generic(obs))


def _dict_obj(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "kind": _pack("子对象 kind：dictionary/xrecord/object。", "结构。", "xrecord.data 仍是未解码 TypedValue。", NONE, "DumpDbObject"),
        "handle": _pack("字典或记录 handle。", "id。", "BOM recorder handle 可与行关联，但记录体没有。", COMBO, ACAD_HANDLE),
        "runtime_class": _pack("TH_BOMRecorder 等类名。", "知道是哪种记录。", "没有字段表。", COMBO, NOT_FOUND),
        "managed_type": _pack(".NET 类型名。", "同 runtime。", "无。", NONE, "DumpDbObject"),
        "is_proxy": _pack("是否 proxy。TH 侧一般为 false。", "解码状态。", "true 则记录不可读。", COMBO, "DBObject.IsAProxy"),
        "count": _pack("子项数。PC_BOM_DIC 等于行数。", "可与 bom_rows 对账。", "count=24 且 bom 24 行则字典完整；记录体仍空。", COMBO, "DBDictionary.Count"),
        "items": _pack("子键到对象的映射。BOM 键 1..N。", "序号键。", "值只有 handle/类，没有代号。", COMBO, "DBDictionary"),
        "data": _pack("Xrecord TypedValue 列表。", "原始组码。", "未映射业务前不能当明细。", NONE, "Xrecord.Data"),
        "truncated": _pack("字典深度截断。上限 8。七张未见 truncated=true 于 NOD 顶层。", "完整性。", "若 true，深树没走完。", COMBO, "MaxDictionaryDepth=8"),
        "error": _pack("子对象读取错误。", "质量。", "有 error 的键不能用。", NONE, "DumpNamedObjects"),
    }
    return mapping.get(key, _generic(obs))


def _dict_top(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "key": _pack("NOD 项名。PC_* 与 ACAD_*。", "机械字典名见 dict_key.*。", "按名字分流。", ALONE, "NamedObjectsDictionary"),
        "object": _pack("子对象转储。", "容器。", "细看 dict.object.*。", COMBO, "DumpDbObject"),
        "error": _pack("该项读取失败。七张顶层未见 error 键。", "key absent on all seven drawings。", "若出现，该字典不可用。", NONE, "DumpNamedObjects"),
    }
    return mapping.get(key, _generic(obs))


def _link_item(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "seq": _pack("解析自字典键的序号。", "与气泡、明细行绑定的件号顺序。", "与 bom.序号、气泡 handle 三联。仅试点图有本文件。", COMBO, "PC_BOMXHRELATEDIC"),
        "xuhao_handle": _pack("气泡 TH_XuHaoEntity handle，如 `1F6A`。", "可在图上点中序号。", "不必认气泡里的字。", ALONE, PCCAD),
        "xuhao_found": _pack("实体表是否找得到该气泡。试点 24/24 true。", "关联完整性。", "false 则字典脏了，不能自动配对。", COMBO, "派生产物"),
        "bom_handle": _pack("明细行块 handle，如 `4575`。", "定位该行。", "与 bom 字段连接。", COMBO, PCCAD),
        "bom_code": _pack("该行代号拷贝。", "零件图号。", "来源仍是 bom.代号；这里是冗余。", COMBO, PCCAD),
        "bom_name": _pack("该行名称拷贝。", "名称+规格。", "同 bom.名称。", COMBO, PCCAD),
        "bom_qty": _pack("数量拷贝。", "数量。", "同 bom.数量。", COMBO, PCCAD),
        "bom_material": _pack("材料拷贝。试点全空。", "空。", "不能补材料。", NONE, PCCAD),
        "dict_key": _pack("原始键 `14#10486`。", "可逆解析。", "十进制 handle 需转十六进制才能对 entities。", COMBO, "PC_BOMXHRELATEDIC"),
        "recorder_handle": _pack("关联记录 TH_BOMItem2XuhaoAssoiateRecoder handle。", "字典记录 id。", "记录体无更多字段。", NONE, NOT_FOUND),
        "recorder_class": _pack("类名 TH_BOMItem2XuhaoAssoiateRecoder（拼写 Assoiate）。", "确认记录类型。", "无内部字段。", NONE, NOT_FOUND),
    }
    return mapping.get(key, _generic(obs))


def _link_top(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "schema_version": _pack("派生文件 schema。", "1。", "仅试点图存在该文件。", COMBO, "xuhao-bom-links.json"),
        "source": _pack("thcad_v24_dotnet。", "来源。", "同。", COMBO, "派生"),
        "drawing_id": _pack("试点图 id。", "归属。", "其它六张 key absent。", COMBO, "派生"),
        "note": _pack("说明：从 PC_BOMXHRELATEDIC 解析，无额外 CAD API。", "方法学记录。", "可复用于另外四张有明细的图。", COMBO, "派生"),
        "link_count": _pack("24。", "条数。", "应等于气泡数且等于明细行数；不齐则图纸本身不齐。", COMBO, "派生"),
        "all_xuhao_matched": _pack("全部气泡找到。", "完整性布尔。", "false 不能自动去标注依赖序号。", COMBO, "派生"),
        "links": _pack("关联数组。", "容器。", "逐条 link.item.*。", COMBO, "派生"),
    }
    return mapping.get(key, _generic(obs))


def _error_key(obs: dict) -> dict:
    return _pack(
        f"errors.jsonl 字段 `{obs['verbatim']}`。抽取器在实体不是 Entity 或抛异常时写入。",
        "七张 errors.jsonl 都是 0 字节，key absent on all seven drawings。",
        "将来若有 error，该 handle 不能进入几何校验。",
        NONE,
        "DrawingExtractor 错误记录：handle/owner_block_name/error/error_type",
    )


def _entity_key(obs: dict) -> dict:
    key = obs["verbatim"]
    mapping = {
        "drawing_handle": _pack(
            "与 handle 相同的冗余键（README 已知 PoC 问题：名字误导）。",
            "不要理解成「图纸的 handle」。值等于图元 handle。",
            "一律用 `entity.handle` 做主键。",
            COMBO,
            "dev-test README 提取器问题清单",
        ),
        "handle": _pack(
            "图元 Handle，跨 CAD 会话稳定。" + ACAD_HANDLE,
            "定位、对账、高亮的主键。试点直线 `15D5`、气泡 `1F6A`、标题栏 `438F` 两边 CAD 能对上。",
            "与 AutoCAD 抽取 oracle 做 handle 级对齐；与序号字典、明细行连接。",
            ALONE,
            ACAD_HANDLE,
        ),
        "runtime_class": _pack(
            "RX 类名。TH 侧专业对象已是真名。",
            "去标注主开关：TH_XuHaoEntity/TH_DimLeaderUA/TH_ParaBasePntUA/TH_DimRough*/TH_CVArrowLine 及 AcDb*Dimension/Leader/MText 进标注桶。",
            "叠加 layer、geometry.kind、owner_scope：标注层上的 Line 仍可能是尺寸界线，要用规则组合而不是单字段。",
            COMBO,
            "GetRXClass().Name",
        ),
        "managed_type": _pack(
            ".NET 类型名，如 Line、RotatedDimension。",
            "与 runtime_class 几乎同信息。",
            "TH_* 的 managed_type 仍是宿主包装类，没有多出 Ra 字段。",
            COMBO,
            "ent.GetType().Name",
        ),
        "dxf_name": _pack(
            "DXF 类名。",
            "对账用。",
            "同 runtime_class。",
            COMBO,
            "GetRXClass().DxfName",
        ),
        "semantic_type": _pack(
            "抽取器预留键，恒 null；JsonUtil 丢弃 null，故七张 JSON 都没有这个键。",
            "key absent on all seven drawings。",
            "不能当分类；分类用 runtime_class。",
            NONE,
            "SerializeEntity semantic_type=null + JsonUtil skip null",
        ),
        "layer": _pack(
            "实体层名。",
            "强特征：7标注层、8符号标注层、*轮廓线、3中心线层、图框层、消隐层。",
            "必须与 runtime_class 组合，否则会把标注层上的尺寸界线或轮廓层上的文字误伤。",
            COMBO,
            "Entity.Layer",
        ),
        "color": _pack(
            "颜色对象。细项 color.*。",
            "容器。",
            "见 color.index 等。",
            COMBO,
            "Entity.Color",
        ),
        "linetype": _pack(
            "实体线型。ByLayer 时要回查层。",
            "CENTER/DASHED 提示中心线/虚线。",
            "与 layer.linetype 组合。",
            COMBO,
            "Entity.Linetype",
        ),
        "lineweight": _pack(
            "线宽枚举整数。",
            "不是板厚。",
            "不要映射到 `bom.名称` 里的 20mm。",
            NONE,
            "Entity.LineWeight",
        ),
        "visible": _pack(
            "可见性。",
            "隐藏对象仍在库中。",
            "PCCAD 可隐藏序号；去标注应按类处理隐藏气泡。",
            COMBO,
            "Entity.Visible",
        ),
        "owner_scope": _pack(
            "model_space / block_definition / paper_space。",
            "模型空间才是图面；block_definition 是零件块或标注块定义。",
            "去标注生产 DXF 以 model_space 白名单为准，不要把 *D 块定义里的线当零件。",
            COMBO,
            "OwnerScope()",
        ),
        "owner_block_name": _pack(
            "所属块名。",
            "可筛 PC_TITLE_BLOCK 定义内的 attDef。",
            "与 owner_scope 组合。",
            COMBO,
            "BlockTableRecord.Name",
        ),
        "owner_handle": _pack(
            "所属块 handle。",
            "连接定义。",
            "实例 handle ≠ 定义 handle。",
            COMBO,
            ACAD_HANDLE,
        ),
        "block_path": _pack(
            "当前一层块路径数组。抽取器只写一层。",
            "无深层嵌套矩阵。",
            "不能完整还原多层块变换；零件块 MYX* 内部几何是定义坐标。",
            COMBO,
            "SerializeEntity block_path = [owner.Name]",
        ),
        "bbox": _pack(
            "包围盒对象。点对象常缺失。",
            "空间查询。",
            "见 bbox.min/max。",
            COMBO,
            ACAD_EXTENTS,
        ),
        "geometry": _pack(
            "按类型的几何对象。kind 决定子键。",
            "重建与分类的入口。",
            "逐子键见 geometry.*。",
            COMBO,
            "GeometryOf",
        ),
        "text": _pack(
            "文字。DBText 为字符串；MText/尺寸为对象；无线则 JSON 省略。",
            "单行字可直接读。",
            "尺寸要读 text.measurement 与 dimension_text；attDef 的 text 常是空串。",
            COMBO,
            "TextOf",
        ),
        "attributes": _pack(
            "块属性数组。仅 BlockReference。",
            "标题栏/明细的原始格子。",
            "聚合成 title.* / bom.*。",
            ALONE,
            "AttributesOf",
        ),
        "xdata": _pack(
            "按应用名分组的 TypedValue。" + ACAD_XDATA,
            "有哪些应用见 xdata.*。",
            "应用名是字段；不要把每个 code 当字段。",
            COMBO,
            ACAD_XDATA,
        ),
        "extension_dictionary": _pack(
            "实体扩展字典。专业气泡上常无（键被省略）。",
            "无则没扩展字典。",
            "机械语义不靠它。",
            NONE,
            "ExtDictOf",
        ),
        "source": _pack(
            "thcad_v24_dotnet。每条都有。",
            "标记抽取器。",
            "对账用。",
            NONE,
            "SourceTag",
        ),
        "decode_status": _pack(
            "full 或 proxy。七张全部 full。",
            "可信任 runtime_class。",
            "proxy 时才看 proxy.*。",
            ALONE,
            "IsAProxy",
        ),
        "custom": _pack(
            "仅 TH_* 写入。",
            "壳。",
            "见 custom.*。",
            COMBO,
            "CustomPayload",
        ),
        "proxy": _pack(
            "ProxyEntity 详情。七张无 proxy，键 absent。",
            "key absent on all seven drawings。",
            "AutoCAD 侧才需要。",
            NONE,
            "ProxyEntity",
        ),
    }
    return mapping.get(key, _generic(obs))


SPECIFIC = {
    "title.产品型号": _pack(
        "PCCAD 标题栏属性 `产品型号`。" + PCCAD,
        "七张都是 `SZ-63000/110`，可单独识别这是沈变 63000kVA/110kV 产品系列。",
        "与 `title.图样代号` 组合才能知道是上节油箱还是箱盖；与文件名配对防止拿错项目。",
        ALONE,
        PCCAD,
    ),
    "title.图样名称": _pack(
        "标题栏 `图样名称`。" + PCCAD,
        "本张图的中文名：上节油箱/下节油箱/控制线路桥架配装/联气管装配/总装配附件/箱盖。",
        "与图样代号、BOM 名称一起做「图名是否对得上装配角色」。709 两页同名「总装配附件」要靠页次区分。",
        ALONE,
        PCCAD,
    ),
    "title.图样代号": _pack(
        "标题栏 `图样代号`，沈变图号。" + PCCAD,
        "如 `5TBC.384.A110050.2`。这是图样身份，不是文件名。",
        "必须与 `drawing.filename` 组合：文件名多 `_1` 页次；709 两张代号相同、`第几页` 为 1/2。铁芯场景的文件配对就靠这一组。",
        COMBO,
        PCCAD,
    ),
    "title.比例": _pack(
        "出图比例，如 1:20 / 1:25。",
        "只说明图框比例，模型几何通常已按 1:1 画。",
        "与 `drawing.insunits=Undefined` 一起：不要把测量值再乘 20。复核打印稿时才用比例。",
        COMBO,
        PCCAD,
    ),
    "title.第几页": _pack(
        "当前页次。",
        "709.1_1=1、709.1_2=2，其它多为 1。",
        "与 `共几页`、`图样代号`、文件名 `_页次` 做多页图配对；页次不一致则停止几何校验。",
        COMBO,
        PCCAD,
    ),
    "title.共几页": _pack(
        "总页数。709 为 2，其余 1。",
        "知道套图是否缺页。",
        "共 2 页只抽到 1 页就要报文件配对异常。",
        COMBO,
        PCCAD,
    ),
    "title.重量": _pack(
        "标题栏重量格。",
        "装配图六张全空；零件图 `8TBC.312.A110050.101_1` 为 `1103`。",
        "不能汇总整台变压器重量。若要质量校核，只能和 `bom.总重`（本批也空）以及外部 ERP 组合；现在大多不能支撑。",
        COMBO,
        PCCAD,
    ),
    "title.材料标记": _pack(
        "标题栏材料标记。",
        "仅箱盖零件图填了 `16钢板Q355B`，其余空。",
        "零件图可与 `bom.材料`（空）对照发现「材料写在标题栏不在明细」；装配图此格空，不能当钢材清单。",
        COMBO,
        PCCAD,
    ),
    "bom.序号": _pack(
        "明细行 `序号`，与图面气泡对应。" + PCCAD,
        "行号，如 1。不是件号。",
        "与 `PC_BOMXHRELATEDIC` / `link.item.xuhao_handle` 连接气泡；709.1_2 有序号无气泡，709.1_1 有气泡无明细。",
        COMBO,
        PCCAD,
    ),
    "bom.代号": _pack(
        "明细 `代号`，零件/部件图号。",
        "如 `8TBT.055.T00001.1`、`5TBC.051.A110050.101`。部分行为 `\\` 或空（标准件/参见）。",
        "与 `名称`+`数量` 做 BOM 配对；与子图 `title.图样代号` 做装配完整性（批量数据提取正是这个场景）。空代号不能当漏抽。",
        COMBO,
        PCCAD + " 批量提取可对装配明细与零件标题栏关联检查 https://www.thcad.net/pccad",
    ),
    "bom.名称": _pack(
        "明细 `名称`，常把规格写进同一格。",
        "如 `箱底5336×1806×428×428×328×328×20`、`加强铁140×405×40×20×0×0×20`。",
        "可解析外形尺寸候选，但那是字符串不是几何。必须与图面 Line 长度、尺寸 measurement 对照才进入铁芯/油箱校验。",
        COMBO,
        PCCAD,
    ),
    "bom.数量": _pack(
        "明细 `数量`。",
        "数字或 `(4)` 这种带括号写法；709.1_2 序号1 为 `(4)` 且备注「油箱已给(4)」。",
        "与气泡数量、图面重复件个数校核是硬规则候选；括号语义要规则化，不能当纯 int。",
        COMBO,
        PCCAD,
    ),
    "bom.材料": _pack(
        "明细 `材料`。",
        "本批几乎全空（384.2_1 的 24 行全空）。",
        "现在不能做出材料表。材料偶尔在 `title.材料标记`。空是图上没填。",
        NONE,
        PCCAD,
    ),
    "bom.单重": _pack(
        "明细 `单重`。本批全空。",
        "无。",
        "不能算重量。",
        NONE,
        PCCAD,
    ),
    "bom.总重": _pack(
        "明细 `总重`。本批全空。",
        "无。",
        "不能与 `title.重量` 对账（装配图两者都空）。",
        NONE,
        PCCAD,
    ),
    "bom.备注": _pack(
        "明细 `备注`。",
        "多数空；709.1_2 有「油箱已给(4)」这种装配关系说明。",
        "软规则：备注可能解释数量为何加括号。不能当材料。",
        COMBO,
        PCCAD,
    ),
}
