"""Versioned human curation for the first Shenbian requirement ontology.

This module is intentionally declarative.  It separates primary customer
statements from normalized wording and domain decomposition, while keeping
stable IDs for every business requirement point.
"""

from __future__ import annotations

from typing import Any


SOURCE_DOCUMENTS: list[dict[str, Any]] = [
    {
        "source_document_id": "SRC-DOC-001",
        "name": "副本图纸审核部分优先级0821.xlsx",
        "source_kind": "customer_primary",
        "storage_ref": "client-data/client-requirements/副本图纸审核部分优先级0821.xlsx",
        "sha256": "02dac8ed394d0fc942dfb0a4f86582e49c92228b69c7a5e331273a0b502a412d",
        "authority_rank": 1,
        "parent_source_document_id": None,
    },
    {
        "source_document_id": "SRC-DOC-002",
        "name": "沈阳特变调研说明-0817.docx",
        "source_kind": "customer_primary",
        "storage_ref": "client-data/client-requirements/沈阳特变调研说明-0817.docx",
        "sha256": "d6fec106c3b9f0474d4a2c4dcbaf532e64d31b248f4877ab2b69206333de4014",
        "authority_rank": 1,
        "parent_source_document_id": None,
    },
    {
        "source_document_id": "SRC-DOC-003",
        "name": "沈阳特变电图纸删除效果说明.docx",
        "source_kind": "customer_embedded_attachment",
        "storage_ref": "client-data/client-requirements/沈阳特变调研说明-0817.docx#word/embeddings/oleObject1.bin",
        "sha256": "731c0b2362eaecec560ea5c129851ec3449190bd211ea375affac0fec528313b",
        "authority_rank": 1,
        "parent_source_document_id": "SRC-DOC-002",
    },
    {
        "source_document_id": "SRC-DOC-004",
        "name": "变压器产品工程图纸智能校审与设计辅助需求说明_v1.0.md",
        "source_kind": "derived_analysis",
        "storage_ref": "client-data/client-requirements/变压器产品工程图纸智能校审与设计辅助需求说明_v1.0.md",
        "sha256": "7392f264c66e9b0de42a256d47bdd3c3e267ee1ae8b277f1f633661e54f548be",
        "authority_rank": 2,
        "parent_source_document_id": "SRC-DOC-001",
    },
    {
        "source_document_id": "SRC-DOC-005",
        "name": "特变电工沈阳变压器图纸智能体调研整理与落地评估_v1.0.md",
        "source_kind": "derived_analysis",
        "storage_ref": "client-data/client-requirements/特变电工沈阳变压器图纸智能体调研整理与落地评估_v1.0.md",
        "sha256": "f2491c176006747707fb9d28a9ea7410e1f470b07664ed0aef36bfec99892cde",
        "authority_rank": 2,
        "parent_source_document_id": "SRC-DOC-002",
    },
]


def evidence(
    evidence_id: str,
    document_id: str,
    locator: dict[str, Any],
    verbatim_text: str,
    evidence_kind: str = "customer_statement",
) -> dict[str, Any]:
    return {
        "source_evidence_id": evidence_id,
        "source_document_id": document_id,
        "locator": locator,
        "verbatim_text": verbatim_text,
        "evidence_kind": evidence_kind,
    }


SOURCE_EVIDENCE: list[dict[str, Any]] = [
    evidence("EV-X-PRIORITY", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "E2"}, "从上到下，优先级从高到底"),
    evidence("EV-X-01", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D2"}, "二维图纸dwg/三维pdf，单件图和装配图，是否缺少尺寸标注，包括孔的定位等。尺寸标注（公差、尺寸数值、配合尺寸）包括一致性审核等"),
    evidence("EV-X-02", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D3"}, "图纸专用件，是否引用了其他不可以用的产品专用件图号（原号的基础上 母系的一个系列可以引用，否则不能引用）纯字段识别。"),
    evidence("EV-X-03", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D4"}, "各部件明细和主材提供的组部件的一致性审查，包括数量、型号等信息"),
    evidence("EV-X-04", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D5"}, "图纸关键尺寸和前期图/送审图中标准尺寸、文字、符号等信息的对比，给出差异"),
    evidence("EV-X-05", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D6"}, "图纸BOM数量和图面给出展示的组部件是否数量一致，图纸BOM尺寸和图面给出展示的组部件实际尺寸和标注尺寸是否一致"),
    evidence("EV-X-06", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D7"}, "各大部件图纸和布置图关键尺寸是否一致（和序号4可以一起做）"),
    evidence("EV-X-07", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D8"}, "根据对图纸技术要求准确性和完整性进行标准化检查"),
    evidence("EV-X-08", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D9"}, "二维图纸尺寸上在逻辑上有干涉或者冲突的，进行检查和提示"),
    evidence("EV-X-09", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D10"}, "提供类似产品图纸作为参考，对图纸中尺寸，文字要求和结构进行对比检查"),
    evidence("EV-X-10", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D11"}, "图纸中标注，设计的尺寸等是否符合综合设计平台库中的设计原则和设计规定"),
    evidence("EV-X-11", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D12"}, "2D的dwg，通过文字语言，AI对图纸进行简单修改，对孔、尺寸等进行修改，生成新的图纸"),
    evidence("EV-X-12", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D13"}, "图纸中标注尺寸和实际尺寸是否一致，是不是1:1设计"),
    evidence("EV-X-13", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "D14"}, "2D的dwg或者截图，pdf，图纸转3D模型creo格式"),
    evidence("EV-X-COLOR-04", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "C5", "computed_fill": "FFFF00"}, "序号4单元格为黄色", "source_formatting"),
    evidence("EV-X-COLOR-05", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "C6", "computed_fill": "FF0000"}, "序号5单元格为红色", "source_formatting"),
    evidence("EV-X-COLOR-06", "SRC-DOC-001", {"sheet": "Sheet1", "cell": "C7", "computed_fill": "FFFF00"}, "序号6单元格为黄色", "source_formatting"),
    evidence("EV-D-SCOPE", "SRC-DOC-002", {"paragraphs": [3, 4, 5, 6]}, "业务覆盖：变压器17类核心组件图纸智能审核+零件图纸去标注；图纸载体：天河CADV21，DWG格式，未来新增Creo 3D衍生2D图纸"),
    evidence("EV-D-S01", "SRC-DOC-002", {"table": 0, "cells": ["R1C1", "R5C1", "R6C1", "R10C1"]}, "变压器17类组件图纸审核；检查零件数量、明细表行项与主材清单、尺寸标注、字体/基准点及其他图元；依据TDP规则和质量控制表；输出问题校验报告和高亮标注"),
    evidence("EV-D-S02", "SRC-DOC-002", {"table": 1, "cells": ["R4C1", "R5C1", "R6C1", "R10C1"]}, "利用图纸重叠法反向核对叠片参数化计算；比较反向渲染叠片轮廓、开孔点位、总图对应区域轮廓和多视图边界；输出校验报告和铁芯叠片矩阵数据"),
    evidence("EV-D-S03", "SRC-DOC-002", {"table": 2, "cells": ["R1C1", "R4C1", "R5C1", "R6C1"]}, "高压/中压/低压/调压线圈；核对图纸、算单、主材表；检查尺寸、导线规格、电流密度、电气算单、主材条目和规范技术标注"),
    evidence("EV-D-S04", "SRC-DOC-002", {"table": 3, "cells": ["R1C1", "R4C1", "R5C1", "R6C1"]}, "线圈压装、高低压引线、器身装配；核对压装尺寸、出头坐标、压板开孔、引线外径、档位分区边界和出头示意图轮廓，并依据算单生成出头位置示意图"),
    evidence("EV-D-S06", "SRC-DOC-002", {"table": 4, "cells": ["R3C1", "R4C1", "R5C1", "R6C1", "R10C1"]}, "输入DWG内部布置图、输出DWG外部送审布置图；手动删减内部细节；计划处理全部图层、线条、标注、零部件细节；移除内部细节"),
    evidence("EV-D-S07", "SRC-DOC-002", {"table": 5, "cells": ["R1C1", "R3C1", "R5C1", "R10C1", "R11C1"]}, "全品类变压器对外送审图纸；输入DWG、输出DXF；处理图框、剖视图、放大图、尺寸标注、剖切符号、中心线、辅助线和内部技术文字；支持批量和生产端对接"),
    evidence("EV-DEL-01", "SRC-DOC-003", {"table": 0, "row": 1}, "按图层筛选，删除图框层、细线层、消隐层（如有）、转换层（如有）；需判断消隐层、转换层是否需要操作"),
    evidence("EV-DEL-02", "SRC-DOC-003", {"table": 0, "row": 2}, "根据“示意图”或“B”“A-A”下面有图的规律提取目标位置，再删除剖面线层内容"),
    evidence("EV-DEL-03", "SRC-DOC-003", {"table": 0, "rows": [3, 4, 5]}, "尺寸标注、一般标注和剖切符号优先按图层或块删除；非块且不在对应图层时可能漏删或误删，建议人工操作"),
    evidence("EV-DEL-04", "SRC-DOC-003", {"table": 0, "row": 6}, "读取实体自身线型；ByLayer时回溯所属图层线型；块内中心线/辅助线需判断是否打散"),
    evidence("EV-DEL-05", "SRC-DOC-003", {"table": 0, "row": 7}, "文本直接全删，但考虑剖面图等情况，删除放在逻辑最后"),
    evidence("EV-DEL-06", "SRC-DOC-003", {"table": 0, "row": 8}, "侧视图、俯视图无法单独判断，建议人工操作"),
]


NODES: dict[str, dict[str, Any]] = {}
RELATIONS: list[dict[str, Any]] = []
SOURCE_LINKS: list[dict[str, Any]] = []
ALIASES: list[dict[str, Any]] = []


def add_node(
    requirement_id: str,
    name: str,
    *,
    requirement_kind: str,
    origin_kind: str,
    atomic: bool,
    description: str | None = None,
    verification_method: str | None = None,
    priority_order: int | None = None,
    source_emphasis: str | None = None,
    customer_visible: bool = True,
    needs_confirmation: bool = False,
    source_refs: tuple[str, ...] = (),
) -> str:
    if requirement_id in NODES:
        raise ValueError(f"duplicate requirement id: {requirement_id}")
    NODES[requirement_id] = {
        "requirement_id": requirement_id,
        "name": name,
        "description": description,
        "requirement_kind": requirement_kind,
        "origin_kind": origin_kind,
        "atomic": atomic,
        "verification_method": verification_method,
        "priority_order": priority_order,
        "source_emphasis": source_emphasis,
        "customer_visible": customer_visible,
        "needs_confirmation": needs_confirmation,
        "lifecycle_status": "discovery",
    }
    for index, evidence_id in enumerate(source_refs, start=1):
        SOURCE_LINKS.append(
            {
                "requirement_source_link_id": f"RSL-{requirement_id}-{index:02d}",
                "requirement_id": requirement_id,
                "source_evidence_id": evidence_id,
                "link_kind": "stated_in" if origin_kind == "customer_stated" else "supported_by",
            }
        )
    return requirement_id


def relate(
    parent_id: str,
    child_id: str,
    *,
    display_order: int,
    relation_kind: str = "decomposes_to",
    rationale: str | None = None,
) -> None:
    RELATIONS.append(
        {
            "requirement_relation_id": f"RR-{parent_id}-{child_id}",
            "parent_requirement_id": parent_id,
            "child_requirement_id": child_id,
            "relation_kind": relation_kind,
            "display_order": display_order,
            "rationale": rationale,
            "origin_kind": "domain_modeling",
        }
    )


def group(parent_id: str, requirement_id: str, name: str, order: int) -> str:
    add_node(
        requirement_id,
        name,
        requirement_kind="requirement_group",
        origin_kind="normalized",
        atomic=False,
    )
    relate(parent_id, requirement_id, display_order=order)
    return requirement_id


def leaf(
    parent_id: str,
    requirement_id: str,
    name: str,
    order: int,
    *,
    verification_method: str,
    requirement_kind: str = "functional",
    origin_kind: str = "domain_decomposition",
    needs_confirmation: bool = False,
    source_refs: tuple[str, ...] = (),
) -> str:
    add_node(
        requirement_id,
        name,
        requirement_kind=requirement_kind,
        origin_kind=origin_kind,
        atomic=True,
        verification_method=verification_method,
        needs_confirmation=needs_confirmation,
        source_refs=source_refs,
    )
    relate(parent_id, requirement_id, display_order=order)
    return requirement_id


def alias(requirement_id: str, alternate_name: str, alias_kind: str, note: str | None = None) -> None:
    ALIASES.append(
        {
            "requirement_alias_id": f"RA-{len(ALIASES) + 1:03d}",
            "requirement_id": requirement_id,
            "alternate_name": alternate_name,
            "alias_kind": alias_kind,
            "note": note,
        }
    )


# Portfolio root and the 20 customer-readable level-one requirements.
add_node(
    "BR-000",
    "智能审核和辅助设计变压器工程图纸",
    requirement_kind="portfolio",
    origin_kind="normalized",
    atomic=False,
    description="统一承载两份原始需求源中的审图、图纸转换、受控改图与二维转三维需求。",
)

LEVEL_ONE = [
    ("BR-A01", "审核图纸上的尺寸标注", 1, "EV-X-01", None),
    ("BR-A02", "审核专用件图号能不能借用", 2, "EV-X-02", None),
    ("BR-A03", "核对各部件明细、主材清单和产品BOM", 3, "EV-X-03", None),
    ("BR-A04", "比较前期图、送审图和生产图，找出差异和矛盾", 4, "EV-X-04", "yellow"),
    ("BR-A05", "核对图纸BOM和图面上实际画出的部件", 5, "EV-X-05", "red"),
    ("BR-A06", "核对总图、布置图和部件图的关键尺寸", 6, "EV-X-06", "yellow"),
    ("BR-A07", "审核图纸技术要求", 7, "EV-X-07", None),
    ("BR-A08", "提示尺寸逻辑冲突和装配干涉", 8, "EV-X-08", None),
    ("BR-A09", "用相似产品图纸帮助复核当前设计", 9, "EV-X-09", None),
    ("BR-A10", "按企业设计原则和规定逐条审图", 10, "EV-X-10", None),
    ("BR-A11", "用自然语言让AI受控修改DWG", 11, "EV-X-11", None),
    ("BR-A12", "核对标注尺寸、实际几何、单位和比例", 12, "EV-X-12", None),
    ("BR-A13", "用二维图纸辅助生成Creo三维模型", 13, "EV-X-13", None),
]

for requirement_id, name, priority, source_ref, emphasis in LEVEL_ONE:
    add_node(
        requirement_id,
        name,
        requirement_kind="business_outcome",
        origin_kind="customer_stated",
        atomic=False,
        priority_order=priority,
        source_emphasis=emphasis,
        source_refs=(source_ref, "EV-X-PRIORITY"),
    )
    relate("BR-000", requirement_id, display_order=priority, relation_kind="contains_requirement")

SCENARIO_LEVEL_ONE = [
    ("BR-S01", "审核17类组部件图纸", 101, "EV-D-S01"),
    ("BR-S02", "校验铁心叠片图和总图是否一致", 102, "EV-D-S02"),
    ("BR-S03", "核对绕组图纸、算单、主材表和规范", 103, "EV-D-S03"),
    ("BR-S04", "核对绕组组装关系", 104, "EV-D-S04"),
    ("BR-S05", "根据算单自动生成出头位置示意图", 105, "EV-D-S04"),
    ("BR-S06", "把内部布置图转换成外部送审图", 106, "EV-D-S06"),
    ("BR-S07", "把送审或零件DWG净化成生产用DXF", 107, "EV-D-S07"),
]

for requirement_id, name, order, source_ref in SCENARIO_LEVEL_ONE:
    add_node(
        requirement_id,
        name,
        requirement_kind="business_outcome",
        origin_kind="customer_stated",
        atomic=False,
        source_refs=(source_ref,),
    )
    relate("BR-000", requirement_id, display_order=order, relation_kind="contains_requirement")


# A01 — dimension annotation review.
g = group("BR-A01", "BR-A01-G1", "判断哪些特征必须有尺寸", 1)
leaf(g, "BR-A01-001", "识别需要制造尺寸的特征", 1, verification_method="对已标注零件族逐特征核对制造尺寸需求清单")
leaf(g, "BR-A01-002", "识别需要定位尺寸的孔、槽、开口和接口", 2, verification_method="逐个定位特征核对基准与定位尺寸覆盖")
leaf(g, "BR-A01-003", "识别需要装配尺寸的接口和包络", 3, verification_method="按装配接口规则核对安装、包络和间隙尺寸覆盖")
leaf(g, "BR-A01-004", "识别需要检验尺寸的特征", 4, verification_method="按检验规则核对可检验尺寸是否给出")

g = group("BR-A01", "BR-A01-G2", "检查尺寸标注是否完整", 2)
leaf(g, "BR-A01-005", "报告孔径、孔距和孔定位尺寸缺失", 1, verification_method="在金标准孔特征集中逐项判断缺失与否")
leaf(g, "BR-A01-006", "报告轮廓长宽高、板厚、圆角、倒角和槽尺寸缺失", 2, verification_method="在受支持零件族的特征清单上逐项核对")
leaf(g, "BR-A01-007", "报告法兰和安装接口尺寸缺失", 3, verification_method="对已知接口类型核对必填接口参数")

g = group("BR-A01", "BR-A01-G3", "检查尺寸标注是否正确和规范", 3)
leaf(g, "BR-A01-008", "检查标注是否仍关联真实几何", 1, verification_method="识别悬空、失联或关联对象已删除的标注")
leaf(g, "BR-A01-009", "检查同一特征多处标注值是否一致", 2, verification_method="按特征ID汇总标注并比较数值与公差")
leaf(g, "BR-A01-010", "检查关键尺寸是否给出所需公差", 3, verification_method="按特征规则判断尺寸公差或通用公差引用")
leaf(g, "BR-A01-011", "检查配合标注是否完整且成对匹配", 4, verification_method="解析配合代号并校验孔轴配合组合")
leaf(g, "BR-A01-012", "检查基准、形位公差和工程符号是否合规", 5, verification_method="按企业制图规则逐项校验对象和引用")
leaf(g, "BR-A01-013", "检查箭头、引出线、文字高度、图层和标注样式", 6, verification_method="与受控制图模板比较样式属性")
leaf(g, "BR-A01-014", "检查尺寸链是否重复、封闭、过度或相互矛盾", 7, verification_method="建立尺寸约束图并验证独立性与闭合差")
leaf(g, "BR-A01-015", "检查同一特征在不同视图中的数量和尺寸是否一致", 8, verification_method="匹配跨视图特征后比较数量、尺寸和方向")


# A02 — special-part reuse.
leaf("BR-A02", "BR-A02-001", "提取当前产品引用的零部件图号", 1, verification_method="与人工确认的图号引用清单逐项比较")
leaf("BR-A02", "BR-A02-002", "区分通用件、借用件、专用件和标准件", 2, verification_method="与零部件主数据分类比较", needs_confirmation=True)
leaf("BR-A02", "BR-A02-003", "查明被引用专用件所属产品、母型或产品族", 3, verification_method="按主数据关系反查归属", needs_confirmation=True)
leaf("BR-A02", "BR-A02-004", "判断当前产品是否处于允许借用范围", 4, verification_method="执行正式借用范围规则并返回规则证据", needs_confirmation=True)
leaf("BR-A02", "BR-A02-005", "检查专用件版本、设计状态和替代关系是否有效", 5, verification_method="与发布、冻结、失效和替代记录比较", needs_confirmation=True)
leaf("BR-A02", "BR-A02-006", "检查材料、性能、接口和客户特殊要求是否仍适用", 6, verification_method="按适用性规则比较当前项目与原件条件", needs_confirmation=True)
leaf("BR-A02", "BR-A02-007", "报告非法或疑似非法借用及其引用位置", 7, verification_method="报告应包含图号、上级组件、归属、违反规则和审批建议")


# A03 — drawing lists, main material lists and product BOM.
g = group("BR-A03", "BR-A03-G1", "建立可比较的多来源BOM", 1)
leaf(g, "BR-A03-001", "读取图纸明细栏和部件明细", 1, verification_method="与人工转录表逐行逐列比较")
leaf(g, "BR-A03-002", "读取主材清单和Excel清单", 2, verification_method="与源表字段和行数比较")
leaf(g, "BR-A03-003", "读取产品数据系统中的工程BOM", 3, verification_method="按版本导出结果核对层级和字段", needs_confirmation=True)
leaf(g, "BR-A03-004", "保留原始值并标准化名称、规格、单位和空值", 4, verification_method="标准化结果可回溯且不覆盖原始值")
leaf(g, "BR-A03-005", "支持多层BOM正向展开", 5, verification_method="从产品根节点展开到叶件并与权威结构树比较")
leaf(g, "BR-A03-006", "支持逐层数量汇总和单位换算", 6, verification_method="用已知多层样例验证乘积、损耗和单位换算")
leaf(g, "BR-A03-007", "支持零部件反向追溯到组件和产品", 7, verification_method="按零部件ID查询所有有效上级使用关系")

g = group("BR-A03", "BR-A03-G2", "比较BOM字段和结构", 2)
leaf(g, "BR-A03-008", "比较图号、名称、型号和规格", 1, verification_method="按标准化键输出逐字段差异")
leaf(g, "BR-A03-009", "比较材料及材料牌号", 2, verification_method="按材料词典和牌号输出差异")
leaf(g, "BR-A03-010", "比较单机数量、总数量、损耗和备件数量", 3, verification_method="按装配路径计算并对照各来源数量")
leaf(g, "BR-A03-011", "比较版本、设计状态和适用产品", 4, verification_method="输出版本或适用性错配")
leaf(g, "BR-A03-012", "比较父子层级和装配关系", 5, verification_method="对权威产品结构树执行节点与边差分")
leaf(g, "BR-A03-013", "比较单重、总重和关键备注", 6, verification_method="逐项计算或比较并保留单位")
leaf(g, "BR-A03-014", "比较外购、外协、借用和标准件属性", 7, verification_method="逐项对照物料分类主数据")
leaf(g, "BR-A03-015", "比较不同版本BOM并列出变化", 8, verification_method="对两版节点、关系和属性生成差异集")


# A04 — version and lifecycle-stage comparison.
leaf("BR-A04", "BR-A04-001", "确认参与比较的产品、配置和版本基线", 1, verification_method="阻止跨产品或跨配置误配并展示身份依据")
leaf("BR-A04", "BR-A04-002", "比较图号、标题栏、版本、日期和签审状态", 2, verification_method="逐字段输出新增、删除和修改")
leaf("BR-A04", "BR-A04-003", "比较外形、孔位、法兰、开口、中心线和关键轮廓", 3, verification_method="实体配准后输出几何变化和对象定位")
leaf("BR-A04", "BR-A04-004", "比较尺寸、公差和技术参数", 4, verification_method="按语义匹配的标注逐项比较")
leaf("BR-A04", "BR-A04-005", "比较文字、技术要求和标准引用", 5, verification_method="输出文本级和条款级差异")
leaf("BR-A04", "BR-A04-006", "比较材料、焊接、表面处理和工艺符号", 6, verification_method="按工程符号类型输出差异")
leaf("BR-A04", "BR-A04-007", "比较BOM、序号气泡和数量", 7, verification_method="对BOM行、气泡关系和实例数量做差分")
leaf("BR-A04", "BR-A04-008", "比较用户接口、安装尺寸和运输边界", 8, verification_method="对已定义关键接口和包络输出差异")
leaf("BR-A04", "BR-A04-009", "核对送审意见和变更单是否落实到图纸", 9, verification_method="将意见或变更项与对象级修改证据关联")
leaf("BR-A04", "BR-A04-010", "区分正常变更、未授权变更、漏改、版本错配和疑似矛盾", 10, verification_method="在已标注差异案例上验证分类和证据")


# A05 — BOM-to-graphics reconciliation.
leaf("BR-A05", "BR-A05-001", "关联序号气泡、BOM行、图形实例和产品结构节点", 1, verification_method="与专家确认的四方关系金标准比较")
leaf("BR-A05", "BR-A05-002", "发现BOM有但图面没有的应显示部件", 2, verification_method="按图纸类型表达规则输出缺失实例")
leaf("BR-A05", "BR-A05-003", "发现图面有但BOM没有的部件", 3, verification_method="输出无法关联到BOM的实例及证据")
leaf("BR-A05", "BR-A05-004", "比较BOM数量和图面实例数量", 4, verification_method="按对称、重复、块多实例等表达规则计数")
leaf("BR-A05", "BR-A05-005", "发现序号气泡重复、缺失或未关联", 5, verification_method="验证每个应编号实例和BOM行的气泡关系")
leaf("BR-A05", "BR-A05-006", "比较BOM规格和图面标注规格", 6, verification_method="按部件类型的规格解析器逐字段比较")
leaf("BR-A05", "BR-A05-007", "比较BOM规格和图面实测几何", 7, verification_method="区分毛坯、名义和成品尺寸后比较", needs_confirmation=True)
leaf("BR-A05", "BR-A05-008", "按图纸类型处理隐藏件、对称件、标准件和示意件", 8, verification_method="在各表达类型样例上验证应显示、可省略或示意规则", needs_confirmation=True)


# A06 — cross-drawing engineering interfaces.
leaf("BR-A06", "BR-A06-001", "识别总图、布置图、装配图和部件图中的同一工程接口", 1, verification_method="按接口ID或语义特征与人工映射比较")
leaf("BR-A06", "BR-A06-002", "统一接口的坐标系、单位、视图方向和基准", 2, verification_method="将同一接口变换到共同基准并验证可逆性")
leaf("BR-A06", "BR-A06-003", "比较接口名义尺寸和公差", 3, verification_method="逐接口输出尺寸与公差差异")
leaf("BR-A06", "BR-A06-004", "比较孔数、孔径、孔距和角度分布", 4, verification_method="对孔系特征逐项比较")
leaf("BR-A06", "BR-A06-005", "比较法兰型式、接口方向和安装朝向", 5, verification_method="按接口类型和方向向量比较")
leaf("BR-A06", "BR-A06-006", "检查上下级图纸是否引用同一有效版本", 6, verification_method="沿接口关系核对图纸版本和状态")
leaf("BR-A06", "BR-A06-007", "将接口差异与变更单关联并区分正常变更和漏改", 7, verification_method="对有无变更依据的样例验证分类")


# A07 — technical requirements.
leaf("BR-A07", "BR-A07-001", "从图纸中抽取完整技术要求条目", 1, verification_method="与人工转录的序号和正文逐条比较")
leaf("BR-A07", "BR-A07-002", "检查模板、序号、术语、单位和表达格式", 2, verification_method="与受控技术要求模板逐项比较", needs_confirmation=True)
leaf("BR-A07", "BR-A07-003", "检查标准号、名称、年代号和现行状态", 3, verification_method="与受控标准目录比较", needs_confirmation=True)
leaf("BR-A07", "BR-A07-004", "判断技术要求是否适用于当前产品、材料和工艺", 4, verification_method="按产品与工艺适用性矩阵执行", needs_confirmation=True)
leaf("BR-A07", "BR-A07-005", "比较技术要求参数与标题栏、BOM、算单、协议和图面", 5, verification_method="按参数语义和单位跨来源比较")
leaf("BR-A07", "BR-A07-006", "检查制造、检验、装配、防护、运输和标识要求是否缺项", 6, verification_method="按图纸类型必填项模板逐项检查", needs_confirmation=True)
leaf("BR-A07", "BR-A07-007", "发现同图或跨文件技术要求冲突", 7, verification_method="对同一约束的互斥值或条款输出冲突证据")
leaf("BR-A07", "BR-A07-008", "每条结论引用规则原文、版本和适用条件", 8, verification_method="抽查报告能回到唯一受控条款")


# A08 — design conflicts and interference.
g = group("BR-A08", "BR-A08-G1", "检查尺寸逻辑冲突", 1)
leaf(g, "BR-A08-001", "检查总尺寸与分尺寸之和是否一致", 1, verification_method="计算尺寸链闭合差并与允许公差比较")
leaf(g, "BR-A08-002", "检查同一接口不同位置的标注是否矛盾", 2, verification_method="按接口ID汇总并比较标注")
leaf(g, "BR-A08-003", "检查公差叠加后是否仍可装配", 3, verification_method="执行最坏情况或指定统计公差计算", needs_confirmation=True)
leaf(g, "BR-A08-004", "检查孔数和角度分布是否自洽", 4, verification_method="验证圆周阵列数量、角度和闭合关系")

g = group("BR-A08", "BR-A08-G2", "检查二维几何冲突", 2)
leaf(g, "BR-A08-005", "发现同一视图中不应相交的轮廓", 1, verification_method="按对象类别和允许相交规则执行拓扑相交检查")
leaf(g, "BR-A08-006", "发现最小间隙不足", 2, verification_method="计算对象间最小距离并与规则阈值比较", needs_confirmation=True)
leaf(g, "BR-A08-007", "发现孔到边缘距离不足", 3, verification_method="计算孔边缘到轮廓边缘最小距离", needs_confirmation=True)
leaf(g, "BR-A08-008", "发现管路穿越和安装空间冲突", 4, verification_method="对已定义禁入区和包络执行相交检查", needs_confirmation=True)

g = group("BR-A08", "BR-A08-G3", "检查三维和专业装配风险", 3)
leaf(g, "BR-A08-009", "在可信三维模型中检查真实装配干涉", 1, verification_method="对装配体执行实体碰撞并排除允许接触")
leaf(g, "BR-A08-010", "检查电气净距和爬电距离", 2, verification_method="按电压等级和绝缘条件计算并比较", needs_confirmation=True)
leaf(g, "BR-A08-011", "检查油流、热膨胀、运输变形和检修空间约束", 3, verification_method="按已结构化专业规则逐项判断", needs_confirmation=True)


# A09 — similar-product review.
leaf("BR-A09", "BR-A09-001", "按产品类别、电压等级、容量、相数、频率和绝缘水平筛选参考产品", 1, verification_method="与专家选择的候选集比较")
leaf("BR-A09", "BR-A09-002", "按调压方式、联结组别、冷却方式和主要配置筛选", 2, verification_method="对结构配置条件执行精确或分级匹配")
leaf("BR-A09", "BR-A09-003", "按用户接口、运输尺寸、安装条件和产品族筛选", 3, verification_method="输出每个候选的匹配与不匹配条件")
leaf("BR-A09", "BR-A09-004", "只使用最终批准且版本状态合适的参考图纸", 4, verification_method="排除未批准、失效或错配版本")
leaf("BR-A09", "BR-A09-005", "比较当前图纸与参考图的关键尺寸、文字要求和结构", 5, verification_method="按同类语义对象输出偏差")
leaf("BR-A09", "BR-A09-006", "说明选中参考产品的原因和参数差异", 6, verification_method="报告包含可复核的筛选维度和差异")
leaf("BR-A09", "BR-A09-007", "只提示无法由项目条件解释的异常差异", 7, verification_method="不把可解释差异直接判为错误", needs_confirmation=True)


# A10 — enterprise principles and rules.
leaf("BR-A10", "BR-A10-001", "保存设计原则和设计规定的原文、编号和来源", 1, verification_method="每条规则能回到唯一原文位置")
leaf("BR-A10", "BR-A10-002", "记录规则版本、生效失效时间和审批状态", 2, verification_method="按指定历史时点返回当时有效规则")
leaf("BR-A10", "BR-A10-003", "记录规则适用产品、部件、参数范围和例外", 3, verification_method="用适用与不适用样例验证规则选择", needs_confirmation=True)
leaf("BR-A10", "BR-A10-004", "区分可计算条件、需语言理解条件和需人工判断条件", 4, verification_method="每条规则标明可执行方式和所需输入")
leaf("BR-A10", "BR-A10-005", "逐条把适用规则与图纸证据进行匹配", 5, verification_method="报告展示输入事实、判定过程和对象位置")
leaf("BR-A10", "BR-A10-006", "输出符合、不符合、不适用、信息不足或需人工判断", 6, verification_method="状态互斥且每个状态都有证据")
leaf("BR-A10", "BR-A10-007", "把规则原文和适用性分析附在结论中", 7, verification_method="抽查结论可回到受控规则版本")


# A11 — controlled drawing edits.
g = group("BR-A11", "BR-A11-G1", "把自然语言变成有限CAD操作", 1)
leaf(g, "BR-A11-001", "解析修改指令并确认目标图纸、视图和实体", 1, verification_method="对歧义指令要求确认，对明确指令定位正确对象")
leaf(g, "BR-A11-002", "修改文字、技术要求、块属性和标题栏字段", 2, verification_method="修改后字段值正确且非目标对象不变")
leaf(g, "BR-A11-003", "通过受约束几何修改已有尺寸", 3, verification_method="几何与标注同步且约束保持有效")
leaf(g, "BR-A11-004", "修改孔径、孔距、孔位和标准阵列", 4, verification_method="孔特征参数和阵列关系符合指令")
leaf(g, "BR-A11-005", "替换标准块或部件符号", 5, verification_method="块定义、属性和插入关系保持正确")
leaf(g, "BR-A11-006", "修改图层、线型、颜色和标注样式", 6, verification_method="目标对象属性变化且ByLayer语义正确")
leaf(g, "BR-A11-007", "更新序号气泡和图纸明细", 7, verification_method="气泡、BOM行和实例关系保持一致")
leaf(g, "BR-A11-008", "给变更区域添加修订云线和变更标记", 8, verification_method="变更标记覆盖全部修改对象且不覆盖无关区域")

g = group("BR-A11", "BR-A11-G2", "让自动改图可预览、可复核和可回滚", 2)
leaf(g, "BR-A11-009", "执行前生成修改计划和影响范围", 1, verification_method="计划列出动作、目标、预期差异和风险")
leaf(g, "BR-A11-010", "只在副本或新版本上修改，不覆盖原始发布图", 2, verification_method="原文件哈希不变且新版本身份完整")
leaf(g, "BR-A11-011", "修改后重新执行尺寸、BOM和跨图一致性检查", 3, verification_method="自动产生复查运行并关联修改版本")
leaf(g, "BR-A11-012", "记录对象级差异、命令、操作者、审批人和时间", 4, verification_method="任一修改可重建谁在何时为何改了什么")
leaf(g, "BR-A11-013", "保留块、属性、关联标注、外参、图层和对象ID关系", 5, verification_method="修改前后非目标关系完整性校验通过")
leaf(g, "BR-A11-014", "结构性大改、自由绘制和多图联动修改必须人工批准", 6, verification_method="未批准时不得落盘或发布", requirement_kind="governance")


# A12 — measured geometry, units and scales.
leaf("BR-A12", "BR-A12-001", "读取模型空间几何的真实测量值", 1, verification_method="与CAD原生测量结果逐对象比较")
leaf("BR-A12", "BR-A12-002", "读取标注对象的真实measurement", 2, verification_method="与CAD API返回值比较")
leaf("BR-A12", "BR-A12-003", "发现标注文字被人工覆盖", 3, verification_method="识别Text Override并保留显示值")
leaf("BR-A12", "BR-A12-004", "比较显示尺寸与真实测量值", 4, verification_method="统一单位后计算差异")
leaf("BR-A12", "BR-A12-005", "检查标注线性比例因子", 5, verification_method="验证标注比例与测量值的换算关系")
leaf("BR-A12", "BR-A12-006", "检查块和外部参照的缩放比例", 6, verification_method="识别统一与非统一缩放并计算变换后几何")
leaf("BR-A12", "BR-A12-007", "检查插入单位和图形单位", 7, verification_method="验证单位元数据和实际尺度一致")
leaf("BR-A12", "BR-A12-008", "检查布局视口、注释和详图比例", 8, verification_method="按视口变换验证纸空间显示比例")
leaf("BR-A12", "BR-A12-009", "发现非均匀缩放造成的几何畸变", 9, verification_method="检查各轴缩放并定位受影响对象")
leaf("BR-A12", "BR-A12-010", "判断模型空间是否按真实尺寸建模", 10, verification_method="用已知尺寸和单位校准后验证模型尺度")
leaf("BR-A12", "BR-A12-011", "只在可校准条件满足时测量PDF", 11, verification_method="要求矢量页、页面尺寸、出图比例、无二次缩放和可靠校准", requirement_kind="constraint")
relate(
    "BR-A01",
    "BR-A12-004",
    display_order=50,
    relation_kind="reuses_requirement",
    rationale="尺寸标注审核直接复用显示尺寸与真实测量值比较，不重复建立同义原子需求。",
)


# A13 — 2D-assisted 3D generation.
leaf("BR-A13", "BR-A13-001", "明确目标是可视化模型、中性实体、Creo原生模型还是可制造模型", 1, verification_method="任务开始前选择唯一目标层级并显示其差异")
leaf("BR-A13", "BR-A13-002", "识别适合参数化重建的标准零部件族", 2, verification_method="对板件、法兰、孔板、支架、回转件和管件分类")
leaf("BR-A13", "BR-A13-003", "利用多视图、尺寸和剖面重建三维特征", 3, verification_method="与已知三维真值比较特征和几何")
leaf("BR-A13", "BR-A13-004", "显式列出缺失尺寸、遮挡结构和视图矛盾", 4, verification_method="不得静默猜测关键制造参数")
leaf("BR-A13", "BR-A13-005", "生成STEP或Parasolid中性实体模型", 5, verification_method="文件可导入且实体拓扑与目标一致")
leaf("BR-A13", "BR-A13-006", "在Creo中验证中性模型可导入和可继续处理", 6, verification_method="执行固定Creo导入测试并记录结果")
leaf("BR-A13", "BR-A13-007", "通过受控模板或Creo接口生成原生特征模型", 7, verification_method="验证特征树、基准、参数和约束", needs_confirmation=True)
leaf("BR-A13", "BR-A13-008", "建立装配部件ID、接口、约束和BOM映射", 8, verification_method="装配树与工程BOM及接口关系一致", needs_confirmation=True)
leaf("BR-A13", "BR-A13-009", "若3D PDF含PRC或U3D则优先提取已有三维数据", 9, verification_method="检测嵌入格式并验证提取模型", requirement_kind="constraint", needs_confirmation=True)


# S01 — comprehensive component-drawing review.  It is an umbrella scenario,
# so shared requirements are linked instead of copied.
leaf("BR-S01", "BR-S01-001", "以客户正式确认的17类组部件目录限定审核范围", 1, verification_method="每份图纸能归入一个受控组部件类别或明确转人工", needs_confirmation=True)
leaf("BR-S01", "BR-S01-002", "检查图号、版本、图框、标题栏和明细表字段是否完整", 2, verification_method="按图纸类型模板逐字段检查", needs_confirmation=True)
leaf("BR-S01", "BR-S01-003", "检查图层、线型、字体、标注样式和基准是否符合制图规范", 3, verification_method="与受控组部件制图模板比较", needs_confirmation=True)
leaf("BR-S01", "BR-S01-004", "依据TDP设计规则和质量控制表审核组部件", 4, verification_method="逐条输出适用规则、图纸证据和结论", needs_confirmation=True)
leaf("BR-S01", "BR-S01-005", "输出问题校验报告和可定位的图上高亮", 5, verification_method="每个发现可在原DWG中定位并带来源证据", requirement_kind="output")
for order, shared_id in enumerate(("BR-A01", "BR-A03", "BR-A05", "BR-A06", "BR-A07", "BR-A10"), start=20):
    relate(
        "BR-S01",
        shared_id,
        display_order=order,
        relation_kind="reuses_requirement",
        rationale="17类组部件综合审核复用该横向校审需求，不复制其原子检查点。",
    )


# S02 — core lamination consistency.
g = group("BR-S02", "BR-S02-G1", "把叠片参数表重建成预期图形", 1)
leaf(g, "BR-S02-001", "读取叠片参数化明细表全部字段", 1, verification_method="与人工转录的字段、行和值逐项比较")
leaf(g, "BR-S02-002", "校验参数字段类型、单位、可空条件和枚举", 2, verification_method="对正常、缺失、非法单位和值域样例验证", needs_confirmation=True)
leaf(g, "BR-S02-003", "按正式规则重建叠片外轮廓和台阶", 3, verification_method="与权威反向绘图结果叠加比较", needs_confirmation=True)
leaf(g, "BR-S02-004", "按正式规则重建斜接和开孔点位", 4, verification_method="比较斜接拓扑、孔数、孔径和孔中心", needs_confirmation=True)

g = group("BR-S02", "BR-S02-G2", "把预期叠片与总图正确配准", 2)
leaf(g, "BR-S02-005", "识别总图中的目标叠片区域和视图方向", 1, verification_method="与专家标注区域和方向比较", needs_confirmation=True)
leaf(g, "BR-S02-006", "识别总图和参数图形的坐标基准", 2, verification_method="验证选定基准能稳定复现配准")
leaf(g, "BR-S02-007", "处理旋转、镜像和缩放后完成几何配准", 3, verification_method="对已知变换样例恢复正确变换参数")

g = group("BR-S02", "BR-S02-G3", "比较叠片图形并报告差异", 3)
leaf(g, "BR-S02-008", "比较叠片外轮廓与总图目标轮廓", 1, verification_method="计算轮廓距离、重叠和差异区域", needs_confirmation=True)
leaf(g, "BR-S02-009", "比较叠片开孔的数量、孔径和位置", 2, verification_method="逐孔匹配后比较孔参数", needs_confirmation=True)
leaf(g, "BR-S02-010", "比较不同视图中的叠片边界", 3, verification_method="匹配多视图边界并输出不一致")
leaf(g, "BR-S02-011", "发现叠片之间的轮廓错位", 4, verification_method="按相邻叠片关系计算错层和偏移", needs_confirmation=True)
leaf(g, "BR-S02-012", "按正式公差判定叠片差异是否超限", 5, verification_method="边界值样例在公差内外得到稳定结论", needs_confirmation=True)
leaf(g, "BR-S02-013", "输出校验报告、图上证据和叠片矩阵数据", 6, verification_method="输出字段与客户确认模板一致", requirement_kind="output", needs_confirmation=True)


# S03 — winding review.
leaf("BR-S03", "BR-S03-001", "覆盖高压、中压、低压和调压绕组", 1, verification_method="每种绕组均有明确适用图纸和参数范围", requirement_kind="scope", needs_confirmation=True)
leaf("BR-S03", "BR-S03-002", "关联同一绕组的DWG、电气算单和主材表", 2, verification_method="与专家确认的跨文件配对关系比较", needs_confirmation=True)
leaf("BR-S03", "BR-S03-003", "比较绕组尺寸标注和算单结构参数", 3, verification_method="统一单位后逐参数比较", needs_confirmation=True)
leaf("BR-S03", "BR-S03-004", "比较导线规格和主材条目", 4, verification_method="按导线类型、规格、材料和数量比较", needs_confirmation=True)
leaf("BR-S03", "BR-S03-005", "复核电流密度", 5, verification_method="按客户公式和输入参数重新计算", needs_confirmation=True)
leaf("BR-S03", "BR-S03-006", "复核匝数和绕组尺寸链", 6, verification_method="按算单和客户公式重算并比较", needs_confirmation=True)
leaf("BR-S03", "BR-S03-007", "检查规范对应的技术标注", 7, verification_method="按适用规范逐项核对图纸技术标注", needs_confirmation=True)
leaf("BR-S03", "BR-S03-008", "从22套绕组规范中选择当前产品适用条款", 8, verification_method="用专家标注的适用与不适用样例验证", needs_confirmation=True)
relate("BR-S03", "BR-A03", display_order=20, relation_kind="reuses_requirement", rationale="绕组审核复用多来源BOM字段标准化与比较。")
relate("BR-S03", "BR-A07", display_order=21, relation_kind="reuses_requirement", rationale="绕组审核复用技术要求抽取与规范引用。")
relate("BR-S03", "BR-A10", display_order=22, relation_kind="reuses_requirement", rationale="绕组审核复用规则适用性和逐条审查。")


# S04 — winding assembly review.
leaf("BR-S04", "BR-S04-001", "关联绕组压装图、压板图、引线图、总图和算单", 1, verification_method="与专家确认的成套图纸关系比较", needs_confirmation=True)
leaf("BR-S04", "BR-S04-002", "比较组装图尺寸与绕组压装图尺寸", 2, verification_method="按同一装配尺寸ID逐项比较", needs_confirmation=True)
leaf("BR-S04", "BR-S04-003", "比较出头坐标和区域与总图布置", 3, verification_method="统一坐标基准后比较位置与区域包含关系", needs_confirmation=True)
leaf("BR-S04", "BR-S04-004", "比较明细表参数与图纸组件标注", 4, verification_method="按组件ID和参数名逐项比较", needs_confirmation=True)
leaf("BR-S04", "BR-S04-005", "检查压板出头孔与出头尺寸是否匹配", 5, verification_method="比较孔径、孔位和出头包络及公差", needs_confirmation=True)
leaf("BR-S04", "BR-S04-006", "检查压板出头孔与引线外径是否匹配", 6, verification_method="按装配间隙规则比较孔径和引线外径", needs_confirmation=True)
leaf("BR-S04", "BR-S04-007", "检查档位分区与总图和电气条件是否一致", 7, verification_method="按档位区域ID和电气条件比较", needs_confirmation=True)


# S05 — lead-out schematic generation, deliberately separated from S04.
leaf("BR-S05", "BR-S05-001", "从电气算单读取生成出头位置所需参数", 1, verification_method="与人工确认的输入参数集逐项比较", needs_confirmation=True)
leaf("BR-S05", "BR-S05-002", "按结构基准计算出头坐标和档位区域", 2, verification_method="与人工设计结果比较坐标和区域", needs_confirmation=True)
leaf("BR-S05", "BR-S05-003", "在原图或新图中绘制出头位置示意图", 3, verification_method="生成轮廓、位置和投影方向符合规则", needs_confirmation=True)
leaf("BR-S05", "BR-S05-004", "按统一图层、线型、标注和图框规则出图", 4, verification_method="与受控制图模板逐属性比较", needs_confirmation=True)
leaf("BR-S05", "BR-S05-005", "自动复核生成图与输入算单一致", 5, verification_method="从生成图反读坐标和参数并与输入比较")


# S06 — internal layout to external approval drawing.
g = group("BR-S06", "BR-S06-G1", "按项目条件决定送审图的删留边界", 1)
leaf(g, "BR-S06-001", "识别内部布置图中的全部图层、对象、标注和零部件细节", 1, verification_method="与全量实体抽取结果和人工分类比较")
leaf(g, "BR-S06-002", "按产品、客户、合同和送审阶段选择删留规则", 2, verification_method="给定条件时选中唯一有效规则集", needs_confirmation=True)
leaf(g, "BR-S06-003", "保留外形、安装接口和客户审查所需尺寸", 3, verification_method="转换后必保对象完整且几何不变", needs_confirmation=True)
leaf(g, "BR-S06-004", "保留必要的铭牌、接口信息、图框和标题栏", 4, verification_method="转换后必保信息完整且格式正确", needs_confirmation=True)
leaf(g, "BR-S06-005", "删除内部结构和不应对外披露的专有细节", 5, verification_method="人工确认的敏感对象不得残留", needs_confirmation=True)
leaf(g, "BR-S06-006", "删除内部工艺信息和不应披露的标注", 6, verification_method="按保密清单扫描并验证无残留", needs_confirmation=True)

g = group("BR-S06", "BR-S06-G2", "验证外部送审DWG完整且无泄露", 2)
leaf(g, "BR-S06-007", "扫描隐藏层、冻结层、块内文字、外参、布局和元数据", 1, verification_method="敏感测试信息在所有容器中均能被发现")
leaf(g, "BR-S06-008", "验证转换前后外形和接口几何一致", 2, verification_method="对必保几何执行对象和拓扑差分")
leaf(g, "BR-S06-009", "按送审规范生成可继续编辑的DWG", 3, verification_method="输出可打开、可编辑且对象结构有效", requirement_kind="output")
leaf(g, "BR-S06-010", "按客户确认的图框、标题栏和文件命名规范输出", 4, verification_method="逐字段和文件名规则校验", requirement_kind="output", needs_confirmation=True)
leaf(g, "BR-S06-011", "生成删留差异清单", 5, verification_method="所有删除、保留和条件处理对象均可追溯", requirement_kind="output")


# S07 — production DXF purification.
g = group("BR-S07", "BR-S07-G1", "按附件分步骤去除非生产内容", 1)
leaf(g, "BR-S07-001", "按图层删除图框层和明确可删除的辅助层", 1, verification_method="指定图层对象删除且制造几何不变", origin_kind="customer_stated", source_refs=("EV-DEL-01",))
leaf(g, "BR-S07-002", "消隐层和转换层仅在确认后删除", 2, verification_method="未确认时保留或转人工，确认后按规则删除", origin_kind="customer_stated", source_refs=("EV-DEL-01",), needs_confirmation=True)
leaf(g, "BR-S07-003", "根据示意图、B、A-A等标题和区域识别剖视图或放大图", 3, verification_method="与人工标注的视图区域比较", origin_kind="customer_stated", source_refs=("EV-DEL-02",))
leaf(g, "BR-S07-004", "只删除已识别剖视图或放大图范围内的剖面线和对象", 4, verification_method="目标视图删除且主制造视图不受影响", origin_kind="customer_stated", source_refs=("EV-DEL-02",))
leaf(g, "BR-S07-005", "优先按图层删除尺寸标注、一般标注和剖切符号", 5, verification_method="对应图层目标对象删除且其他对象保留", origin_kind="customer_stated", source_refs=("EV-DEL-03",))
leaf(g, "BR-S07-006", "不在标注层的块按箭头等特征识别后整块删除", 6, verification_method="标准块样例完整删除且不误删制造块", origin_kind="customer_stated", source_refs=("EV-DEL-03",))
leaf(g, "BR-S07-007", "非块且不在标注层的连线删除需人工确认", 7, verification_method="不确定连通分量不得自动删除", origin_kind="customer_stated", source_refs=("EV-DEL-03",))
leaf(g, "BR-S07-008", "按实体线型和ByLayer图层线型识别中心线与辅助线", 8, verification_method="与人工线型分类逐实体比较", origin_kind="customer_stated", source_refs=("EV-DEL-04",))
leaf(g, "BR-S07-009", "块内中心线和辅助线先判断块是否允许打散", 9, verification_method="未确认块不被破坏，允许时仅删除目标子对象", origin_kind="customer_stated", source_refs=("EV-DEL-04",), needs_confirmation=True)
leaf(g, "BR-S07-010", "在其他对象处理完成后删除文字和符号", 10, verification_method="处理顺序正确且目标文本无残留", origin_kind="customer_stated", source_refs=("EV-DEL-05",))
leaf(g, "BR-S07-011", "无法可靠识别的侧视图和俯视图转人工处理", 11, verification_method="系统不得自动删除低置信度侧视图或俯视图", origin_kind="customer_stated", source_refs=("EV-DEL-06",))

g = group("BR-S07", "BR-S07-G2", "保全生产所需几何并输出DXF", 2)
leaf(g, "BR-S07-012", "识别主视图或目标加工轮廓", 1, verification_method="与工艺人员确认的制造区域比较", needs_confirmation=True)
leaf(g, "BR-S07-013", "保留主轮廓、内轮廓、孔、圆弧和必要加工几何", 2, verification_method="关键制造几何对象零误删", needs_confirmation=True)
leaf(g, "BR-S07-014", "检查轮廓闭合、连接、断线、重复线和自交", 3, verification_method="对转换前后拓扑指标执行差分")
leaf(g, "BR-S07-015", "检查孔数量、孔径和孔中心未发生变化", 4, verification_method="逐孔匹配并比较")
leaf(g, "BR-S07-016", "检查单位、坐标、比例、包围盒、面积和周长", 5, verification_method="转换前后指标在客户公差内一致", needs_confirmation=True)
leaf(g, "BR-S07-017", "按目标DXF版本、单位、图层和命名规范输出", 6, verification_method="在目标生产软件中打开并通过格式校验", requirement_kind="output", needs_confirmation=True)
leaf(g, "BR-S07-018", "输出处理差异报告和日志", 7, verification_method="每个删除、保留、转人工和失败事件可追溯", requirement_kind="output")

g = group("BR-S07", "BR-S07-G3", "满足批处理、部署和生产系统对接要求", 3)
leaf(g, "BR-S07-019", "支持单个DWG输入并返回单个DXF", 1, verification_method="端到端单文件任务成功", requirement_kind="operational")
leaf(g, "BR-S07-020", "支持多文件和压缩包批量输入输出", 2, verification_method="混合正常与异常文件批次可独立记录结果", requirement_kind="operational")
leaf(g, "BR-S07-021", "在客户内网私有化部署且不要求独立前端页面", 3, verification_method="部署拓扑符合客户环境", requirement_kind="constraint")
leaf(g, "BR-S07-022", "支持最多10名用户同时提交处理任务", 4, verification_method="按确认的文件规模执行10用户并发测试", requirement_kind="nonfunctional", needs_confirmation=True)
leaf(g, "BR-S07-023", "与两个生产端双向推送、拉取、上传和下载图纸", 5, verification_method="两个端点分别完成契约测试", requirement_kind="integration", needs_confirmation=True)


# Aliases are labels, not duplicate requirement objects.
alias("BR-S01", "外部组件校验", "source_wording", "“外部”含义不清，规范为组部件综合审核。")
alias("BR-S03", "线圈校验", "source_wording", "正式工程语境优先使用“绕组”，保留原称便于检索。")
alias("BR-S04", "线圈组装校验", "source_wording")
alias("BR-S05", "出头示意图自动生成", "normalized_name")
alias("BR-S06", "图纸绘制智能体", "source_wording", "实际是内部布置图向外部送审图转换。")
alias("BR-S07", "图纸去标注智能体", "source_wording", "实际处理范围超过标注，且目标是生产用DXF。")
alias("BR-S07", "生产用图纸净化", "normalized_name")
alias("BR-S02", "铁芯叠片校验", "accepted_term", "正式标准常写“铁心”，场景原文使用“铁芯”。")
alias("BR-A03", "BOM拆接", "ambiguous_source_wording", "暂按BOM展开、汇总和反向追溯理解，待确认。")


DEDUP_DECISIONS: list[dict[str, Any]] = [
    {
        "dedup_decision_id": "DD-001",
        "candidate_requirement_ids": ["BR-A01", "BR-A12"],
        "decision": "keep_separate_share_children",
        "rationale": "A01关注尺寸覆盖和制图规范；A12关注标注值、真实几何、单位与比例。二者只共享测量一致性能力。",
    },
    {
        "dedup_decision_id": "DD-002",
        "candidate_requirement_ids": ["BR-A04", "BR-A06"],
        "decision": "keep_separate_share_logic",
        "rationale": "A04比较同一设计随版本/阶段的变化；A06比较同一时点不同图纸间的工程接口。",
    },
    {
        "dedup_decision_id": "DD-003",
        "candidate_requirement_ids": ["BR-S01", "BR-A01", "BR-A03", "BR-A05", "BR-A06", "BR-A07", "BR-A10"],
        "decision": "keep_umbrella_and_reuse",
        "rationale": "S01是限定17类组部件的综合业务场景，其他节点是可跨场景复用的横向校审需求。",
    },
    {
        "dedup_decision_id": "DD-004",
        "candidate_requirement_ids": ["BR-S03", "BR-A03", "BR-A07", "BR-A10"],
        "decision": "keep_specialization_and_reuse",
        "rationale": "S03保留绕组、电算和专属规范语义，复用通用BOM、技术要求和规则审查。",
    },
    {
        "dedup_decision_id": "DD-005",
        "candidate_requirement_ids": ["BR-S04", "BR-S05"],
        "decision": "split",
        "rationale": "检查已有图纸与生成新图的输入、失败模式、权限和验收标准不同。",
    },
    {
        "dedup_decision_id": "DD-006",
        "candidate_requirement_ids": ["BR-S06", "BR-S07"],
        "decision": "keep_separate",
        "rationale": "S06输出可编辑的外部送审DWG并处理披露边界；S07输出生产设备使用的DXF并保全加工几何。",
    },
]


SCOPE_DIMENSIONS: list[dict[str, Any]] = [
    {"scope_dimension_id": "SD-ORG", "name": "所属机构", "value_semantics": "组织或法人"},
    {"scope_dimension_id": "SD-DISCIPLINE", "name": "CAD专业", "value_semantics": "工程专业"},
    {"scope_dimension_id": "SD-DOMAIN", "name": "产品领域", "value_semantics": "产品或行业领域"},
    {"scope_dimension_id": "SD-PRODUCT", "name": "产品类型", "value_semantics": "产品系列或类型"},
    {"scope_dimension_id": "SD-COMPONENT", "name": "组部件", "value_semantics": "组部件类别"},
    {"scope_dimension_id": "SD-DRAWING", "name": "图纸类型", "value_semantics": "工程图纸类别"},
    {"scope_dimension_id": "SD-FORMAT", "name": "文件格式", "value_semantics": "输入或输出媒体格式"},
    {"scope_dimension_id": "SD-STAGE", "name": "设计阶段", "value_semantics": "图纸生命周期阶段"},
    {"scope_dimension_id": "SD-ROLE", "name": "使用角色", "value_semantics": "参与业务角色"},
    {"scope_dimension_id": "SD-SYSTEM", "name": "业务系统", "value_semantics": "CAD或企业系统"},
]


SCOPE_VALUES: list[dict[str, Any]] = [
    {"scope_value_id": "SV-ORG-SB", "scope_dimension_id": "SD-ORG", "name": "特变电工沈阳变压器集团有限公司", "status": "inferred_pending_formal_confirmation"},
    {"scope_value_id": "SV-DISC-MECH", "scope_dimension_id": "SD-DISCIPLINE", "name": "机械设计", "status": "observed"},
    {"scope_value_id": "SV-DOM-TRANSFORMER", "scope_dimension_id": "SD-DOMAIN", "name": "变压器", "status": "observed"},
    {"scope_value_id": "SV-PROD-ALL", "scope_dimension_id": "SD-PRODUCT", "name": "全品类变压器（边界待列举）", "status": "customer_wording_needs_definition"},
    {"scope_value_id": "SV-COMP-17", "scope_dimension_id": "SD-COMPONENT", "name": "17类核心组部件（完整目录待补）", "status": "customer_wording_needs_definition"},
    {"scope_value_id": "SV-COMP-CORE-LAM", "scope_dimension_id": "SD-COMPONENT", "name": "铁心叠片", "status": "observed"},
    {"scope_value_id": "SV-COMP-WINDING", "scope_dimension_id": "SD-COMPONENT", "name": "绕组", "status": "observed"},
    {"scope_value_id": "SV-DRAW-GENERAL", "scope_dimension_id": "SD-DRAWING", "name": "总图或布置图", "status": "observed"},
    {"scope_value_id": "SV-DRAW-ASSEMBLY", "scope_dimension_id": "SD-DRAWING", "name": "装配图", "status": "observed"},
    {"scope_value_id": "SV-DRAW-PART", "scope_dimension_id": "SD-DRAWING", "name": "零件图", "status": "observed"},
    {"scope_value_id": "SV-DRAW-APPROVAL", "scope_dimension_id": "SD-DRAWING", "name": "外部送审图", "status": "observed"},
    {"scope_value_id": "SV-FMT-DWG", "scope_dimension_id": "SD-FORMAT", "name": "DWG", "status": "observed"},
    {"scope_value_id": "SV-FMT-PDF", "scope_dimension_id": "SD-FORMAT", "name": "PDF或3D PDF", "status": "observed"},
    {"scope_value_id": "SV-FMT-DXF", "scope_dimension_id": "SD-FORMAT", "name": "DXF", "status": "observed"},
    {"scope_value_id": "SV-FMT-CREO", "scope_dimension_id": "SD-FORMAT", "name": "Creo模型（目标层级待定）", "status": "customer_wording_needs_definition"},
    {"scope_value_id": "SV-STAGE-EARLY", "scope_dimension_id": "SD-STAGE", "name": "前期方案", "status": "observed"},
    {"scope_value_id": "SV-STAGE-APPROVAL", "scope_dimension_id": "SD-STAGE", "name": "送审", "status": "observed"},
    {"scope_value_id": "SV-STAGE-PRODUCTION", "scope_dimension_id": "SD-STAGE", "name": "生产", "status": "observed"},
    {"scope_value_id": "SV-ROLE-REVIEW", "scope_dimension_id": "SD-ROLE", "name": "设计、校核、审查、审定", "status": "observed"},
    {"scope_value_id": "SV-SYS-THCAD", "scope_dimension_id": "SD-SYSTEM", "name": "天河CAD V21（完整产品名和小版本待确认）", "status": "customer_wording_needs_definition"},
]


REQUIREMENT_SCOPE_LINKS: list[dict[str, Any]] = []


def scope(requirement_id: str, scope_value_id: str, applicability: str = "includes") -> None:
    REQUIREMENT_SCOPE_LINKS.append(
        {
            "requirement_scope_link_id": f"RSC-{requirement_id}-{scope_value_id}",
            "requirement_id": requirement_id,
            "scope_value_id": scope_value_id,
            "applicability": applicability,
            "inherit_to_descendants": True,
        }
    )


for value_id in ("SV-ORG-SB", "SV-DISC-MECH", "SV-DOM-TRANSFORMER", "SV-ROLE-REVIEW", "SV-SYS-THCAD"):
    scope("BR-000", value_id)
for requirement_id in ("BR-A01", "BR-A03", "BR-A04", "BR-A05", "BR-A06", "BR-A07", "BR-A08", "BR-A09", "BR-A10", "BR-A11", "BR-A12"):
    scope(requirement_id, "SV-FMT-DWG")
scope("BR-S01", "SV-COMP-17")
scope("BR-S02", "SV-COMP-CORE-LAM")
scope("BR-S03", "SV-COMP-WINDING")
scope("BR-S04", "SV-COMP-WINDING")
scope("BR-S05", "SV-COMP-WINDING")
scope("BR-S06", "SV-DRAW-GENERAL")
scope("BR-S06", "SV-DRAW-APPROVAL")
scope("BR-S06", "SV-FMT-DWG")
scope("BR-S07", "SV-PROD-ALL")
scope("BR-S07", "SV-FMT-DWG")
scope("BR-S07", "SV-FMT-DXF")
scope("BR-A13", "SV-FMT-CREO")
for value_id in ("SV-STAGE-EARLY", "SV-STAGE-APPROVAL", "SV-STAGE-PRODUCTION"):
    scope("BR-A04", value_id)


OPEN_QUESTIONS: list[dict[str, Any]] = [
    {"open_question_id": "OQ-001", "question": "项目正式法人、业务部门和数据权属单位分别是什么？", "affects_requirement_ids": ["BR-000"], "blocking_kind": "identity"},
    {"open_question_id": "OQ-002", "question": "17类核心组部件的正式目录、层级和图号规则是什么？", "affects_requirement_ids": ["BR-S01"], "blocking_kind": "scope"},
    {"open_question_id": "OQ-003", "question": "天河CAD V21的完整产品名、小版本、平台和二次开发有哪些？", "affects_requirement_ids": ["BR-000"], "blocking_kind": "environment"},
    {"open_question_id": "OQ-004", "question": "原表中的PRM究竟是PDM、PLM、ERP还是自研系统？", "affects_requirement_ids": ["BR-A03"], "blocking_kind": "system_identity"},
    {"open_question_id": "OQ-005", "question": "专用件规则中的“母系”是母型、产品系列、图号前缀还是继承关系？", "affects_requirement_ids": ["BR-A02"], "blocking_kind": "rule_semantics"},
    {"open_question_id": "OQ-006", "question": "优先级表中黄色和红色分别代表什么？", "affects_requirement_ids": ["BR-A04", "BR-A05", "BR-A06"], "blocking_kind": "priority_semantics"},
    {"open_question_id": "OQ-007", "question": "专用件借用的正式范围、禁止条件、版本状态和审批流程在哪里维护？", "affects_requirement_ids": ["BR-A02"], "blocking_kind": "rule_data"},
    {"open_question_id": "OQ-008", "question": "DWG、发布PDF、PLM/PDM、BOM系统、算单和综合设计平台发生冲突时，字段级权威来源是什么？", "affects_requirement_ids": ["BR-A03", "BR-A04", "BR-A05", "BR-A06", "BR-A07", "BR-S03", "BR-S04"], "blocking_kind": "source_of_truth"},
    {"open_question_id": "OQ-009", "question": "图层、块、标注样式、图框、标题栏和BOM的企业制图规范及例外是什么？", "affects_requirement_ids": ["BR-A01", "BR-A05", "BR-S01", "BR-S07"], "blocking_kind": "drawing_standard"},
    {"open_question_id": "OQ-010", "question": "3D PDF是否实际内嵌PRC/U3D，Creo目标是中性实体还是原生参数化模型？", "affects_requirement_ids": ["BR-A13"], "blocking_kind": "output_definition"},
    {"open_question_id": "OQ-011", "question": "首期优先选择哪些产品族、组部件族和图纸类型？", "affects_requirement_ids": ["BR-000"], "blocking_kind": "pilot_scope"},
    {"open_question_id": "OQ-012", "question": "铁心叠片参数表字段、反向绘图规则、配准基准和允许公差是什么？", "affects_requirement_ids": ["BR-S02"], "blocking_kind": "rule_data"},
    {"open_question_id": "OQ-013", "question": "22套绕组规范的目录、适用性条件、计算公式和现有参数脚本能力是什么？", "affects_requirement_ids": ["BR-S03"], "blocking_kind": "rule_data"},
    {"open_question_id": "OQ-014", "question": "绕组压装图、压板图、引线图、总图和算单用什么稳定键关联？", "affects_requirement_ids": ["BR-S04", "BR-S05"], "blocking_kind": "identity_mapping"},
    {"open_question_id": "OQ-015", "question": "绕组组装尺寸公差、档位区域和出头图生成规则是什么？", "affects_requirement_ids": ["BR-S04", "BR-S05"], "blocking_kind": "rule_data"},
    {"open_question_id": "OQ-016", "question": "内部版转送审版在不同产品、客户、合同和阶段下的必须保留、必须删除和条件保留清单是什么？", "affects_requirement_ids": ["BR-S06"], "blocking_kind": "rule_data"},
    {"open_question_id": "OQ-017", "question": "生产DXF的主视图选择、关键制造几何白名单、DXF版本、单位、图层、文件名和目录规范是什么？", "affects_requirement_ids": ["BR-S07"], "blocking_kind": "output_definition"},
    {"open_question_id": "OQ-018", "question": "两个生产端的接口协议、字段、状态回调、错误码和重试规则是什么？", "affects_requirement_ids": ["BR-S07"], "blocking_kind": "integration_contract"},
    {"open_question_id": "OQ-019", "question": "10人并发对应的文件数、典型和最大文件大小、峰值任务以及时限是什么？", "affects_requirement_ids": ["BR-S07"], "blocking_kind": "performance_definition"},
    {"open_question_id": "OQ-020", "question": "问题报告字段、严重度、确认/驳回/关闭流程和自动修改权限如何定义？", "affects_requirement_ids": ["BR-S01", "BR-S02", "BR-S03", "BR-S04", "BR-A01", "BR-A10", "BR-A11"], "blocking_kind": "workflow"},
    {"open_question_id": "OQ-021", "question": "每类需求的金标准样本、边界案例、验收阈值和最终验收集由谁维护？", "affects_requirement_ids": ["BR-000"], "blocking_kind": "acceptance"},
]


GRAPH_VIEWS: list[dict[str, Any]] = [
    {
        "graph_view_id": "GV-BUSINESS-DEFAULT",
        "name": "沈变客户需求业务图谱",
        "description": "默认展示客户可读一级需求、原子需求、来源证据、范围和待确认项。",
        "layout_algorithm": None,
        "layout_version": "unassigned",
        "filter_set": {
            "organization": ["SV-ORG-SB"],
            "cad_discipline": ["SV-DISC-MECH"],
            "product_domain": ["SV-DOM-TRANSFORMER"],
        },
    }
]
