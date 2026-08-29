export interface ThcadCapability {
	id: number;
	name: string;
	artifact: string;
	markdown?: string;
	businessUse: string;
	reportPrefixes: string[];
}

export const THCAD_CAPABILITIES: readonly ThcadCapability[] = [
	{ id: 1, name: "全量实体抽取", artifact: "drawing.json", businessUse: "获取几何、文字、图层、字典、XData、块及专业对象的原始证据", reportPrefixes: ["entity_", "proxy_", "failed_", "type_", "layer_", "owner_scope_", "decode_status_"] },
	{ id: 2, name: "图框检测", artifact: "drawing-frames.json", businessUse: "识别绘图区矩形图框与四边证据", reportPrefixes: ["drawing_frame_", "outermost_drawing_frame_"] },
	{ id: 3, name: "图框分区", artifact: "drawing-zones.json", businessUse: "识别字母数字分区并按点或包围盒定位图区", reportPrefixes: ["drawing_zone_"] },
	{ id: 4, name: "机械明细表知识化", artifact: "bom-knowledge.json", businessUse: "结构化 PCCAD 明细、BOM 行、序号标注与指向关系", reportPrefixes: ["mechanical_bom_", "semantic_bom_"] },
	{ id: 5, name: "技术要求提取", artifact: "technical-requirements.json", markdown: "technical-requirements.md", businessUse: "提取技术要求标题、条目、续行及编号质量", reportPrefixes: ["technical_requirements_"] },
	{ id: 6, name: "图层分析", artifact: "layer-analysis.json", markdown: "layer-analysis.md", businessUse: "统计图层定义、状态、实体类型与使用空间", reportPrefixes: ["layer_", "used_layer_", "unused_layer_", "off_layer_", "frozen_layer_", "locked_layer_"] },
	{ id: 7, name: "中心线识别", artifact: "centerline-identification.json", markdown: "centerline-identification.md", businessUse: "识别中心几何、形态、交点及具名参考轴偏置，不越权等同对称轴", reportPrefixes: ["center_"] },
	{ id: 8, name: "全图标注识别", artifact: "annotation-identification.json", markdown: "annotation-identification.md", businessUse: "识别尺寸、序号、文字引线、符号和方向标记及成组移除候选", reportPrefixes: ["annotation_"] },
	{ id: 9, name: "尺寸拓扑", artifact: "dimension-topology.json", markdown: "dimension-topology.md", businessUse: "建立连续尺寸链、共基准剖面、闭合式、派生差值和参考轴偏置", reportPrefixes: ["dimension_linear_", "dimension_topology_", "dimension_continuous_", "dimension_equation_", "dimension_derived_", "dimension_datum_", "dimension_unsupported_"] },
	{ id: 10, name: "工程图线语义", artifact: "engineering-line-semantics.json", markdown: "engineering-line-semantics.md", businessUse: "以开放样式词汇分析图线角色、连通、轮廓、重复和对称覆盖", reportPrefixes: ["engineering_"] },
	{ id: 11, name: "块实例统一坐标", artifact: "block-instance-coordinate-facts.json", markdown: "block-instance-coordinate-facts.md", businessUse: "展开 definition/occurrence、世界变换与 ByBlock/0 层有效样式", reportPrefixes: ["block_instance_"] },
	{ id: 12, name: "切节点平面拓扑", artifact: "planar-topology.json", markdown: "planar-topology.md", businessUse: "构建规范点边、连通分量、DCEL 环面与拓扑对账", reportPrefixes: ["planar_topology_"] },
	{ id: 13, name: "工程视图区域", artifact: "engineering-view-regions.json", markdown: "engineering-view-regions.md", businessUse: "分解纸张、文档区、工程视图与局部坐标 scope", reportPrefixes: ["engineering_view_"] },
	{ id: 14, name: "表达对应关系", artifact: "representation-correspondence.json", markdown: "representation-correspondence.md", businessUse: "发现重复几何与正投影关系候选并保留残差", reportPrefixes: ["representation_correspondence_", "representation_signature_", "representation_repeated_", "representation_orthographic_"] },
	{ id: 15, name: "表示身份解析", artifact: "representation-identity-resolution.json", markdown: "representation-identity-resolution.md", businessUse: "用强弱证据和负约束形成保守对象簇", reportPrefixes: ["representation_identity_", "identity_", "physical_object_", "merged_physical_", "same_object_", "type_candidate_", "blocked_identity_"] },
	{ id: 16, name: "制造轮廓与孔槽候选", artifact: "manufacturing-profile-features.json", markdown: "manufacturing-profile-features.md", businessUse: "整理轮廓、内嵌边界、重复特征与开放拓扑候选", reportPrefixes: ["manufacturing_"] },
	{ id: 17, name: "机械接口与装配邻接", artifact: "mechanical-interface-adjacency.json", markdown: "mechanical-interface-adjacency.md", businessUse: "形成接口特征、同轴/重复模式、共边和近接证据图", reportPrefixes: ["mechanical_interface_", "mechanical_adjacency_", "mechanical_coincident_", "mechanical_open_"] },
	{ id: 18, name: "尺寸—几何绑定", artifact: "dimension-geometry-binding.json", markdown: "dimension-geometry-binding.md", businessUse: "把尺寸定义点绑定到结构并核对显示值、测量值和结构跨度", reportPrefixes: ["dimension_geometry_"] },
	{ id: 19, name: "语义图纸差分", artifact: "semantic-drawing-snapshot.json", markdown: "semantic-drawing-snapshot.md", businessUse: "构建可比较语义快照，供版本变化、同步和 issue 生命周期分析", reportPrefixes: ["semantic_drawing_snapshot_"] },
	{ id: 20, name: "跨图工程接口图", artifact: "cross-drawing-observation.json", markdown: "cross-drawing-observation.md", businessUse: "生成单图跨图 observation，并对图集汇聚引用、身份和接口比较", reportPrefixes: ["cross_drawing_"] },
] as const;

export function getCapability(id: number): ThcadCapability {
	const capability = THCAD_CAPABILITIES.find((item) => item.id === id);
	if (!capability) throw new Error(`INVALID_CAPABILITY: expected 1-20, got ${id}`);
	return capability;
}

export function catalogForModel(): Array<Pick<ThcadCapability, "id" | "name" | "businessUse">> {
	return THCAD_CAPABILITIES.map(({ id, name, businessUse }) => ({ id, name, businessUse }));
}
