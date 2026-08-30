import type {
  BusinessRequirementGraphEdgeDto,
  BusinessRequirementGraphNodeDto,
  CapabilityAtomSummaryDto,
  CapabilityGraphAtomDto,
} from "../api/types";
import type {
  RuntimeCapabilityAtomNode,
  RuntimeGraph,
  RuntimeGraphLink,
  RuntimeGraphNode,
  RuntimeRequirementNode,
} from "./runtime";

/**
 * DTO → 运行时对象。
 * - position.x/y/z 原样映射：后端已算好语义坐标，前端不重新布局；
 * - 仅当 position.locked=true 时写 fx/fy/fz（力导向库中 fx/fy/fz 表示“钉死”）；
 * - 返回新对象，绝不复用 DTO 引用，防止图库 mutate 污染 react-query 缓存。
 */
export function adaptNode(dto: BusinessRequirementGraphNodeDto): RuntimeRequirementNode {
  const node: RuntimeRequirementNode = {
    nodeKind: "business_requirement",
    id: dto.id,
    label: dto.label,
    description: dto.description,
    requirementKind: dto.requirement_kind,
    originKind: dto.origin_kind,
    atomic: dto.atomic,
    customerVisible: dto.customer_visible,
    needsConfirmation: dto.needs_confirmation,
    lifecycleStatus: dto.lifecycle_status,
    derivedMinDepth: dto.derived_min_depth,
    sourceProximityRank: dto.source_proximity_rank,
    directEvidenceCount: dto.summary.direct_evidence_count,
    acceptanceCriterionCount: dto.summary.acceptance_criterion_count,
    openQuestionCount: dto.summary.open_question_count,
    x: dto.position.x,
    y: dto.position.y,
    z: dto.position.z,
    radius: dto.position.radius,
    positionLocked: dto.position.locked,
  };
  if (dto.position.locked) {
    node.fx = dto.position.x;
    node.fy = dto.position.y;
    node.fz = dto.position.z;
  }
  return node;
}

export function adaptEdge(dto: BusinessRequirementGraphEdgeDto): RuntimeGraphLink {
  return {
    id: dto.id,
    source: dto.source_node_id,
    target: dto.target_node_id,
    relationKind: dto.relation_kind,
    displayOrder: dto.display_order,
    rationale: dto.rationale,
  };
}

/**
 * 能力原子（摘要或 graph-atoms 最小投影）→ 运行时节点。
 * 坐标由调用方（暂存区布局）给出：后端当前不提供原子坐标，暂存区位置无任何业务含义。
 * 投影不含签名/摘要等字段时留空，完整信息以点击后 /atoms/{atom_id} 详情为准。
 */
export function adaptCapabilityAtom(
  dto: CapabilityGraphAtomDto,
  position: { x: number; y: number; z: number },
): RuntimeCapabilityAtomNode {
  const summaryFields = dto as Partial<CapabilityAtomSummaryDto>;
  return {
    nodeKind: "capability_atom",
    id: dto.atom_id,
    label: dto.member_name,
    description: summaryFields.summary ?? null,
    surface: dto.surface,
    atomKind: dto.atom_kind,
    classificationStatus: dto.classification_status,
    operationKinds: dto.operation_kinds,
    observedHostIds: dto.observed_host_ids,
    domainTags: dto.domain_tags,
    memberName: dto.member_name,
    memberSignature: summaryFields.member_signature ?? null,
    declaringSymbolFullName: dto.declaring_symbol_full_name,
    returnType: summaryFields.return_type ?? null,
    isStatic: summaryFields.is_static,
    summary: summaryFields.summary ?? null,
    classificationConfidence: summaryFields.classification_confidence ?? null,
    x: position.x,
    y: position.y,
    z: position.z,
    radius: 0,
    positionLocked: false,
  };
}

export function adaptGraph(
  nodes: BusinessRequirementGraphNodeDto[],
  edges: BusinessRequirementGraphEdgeDto[],
): RuntimeGraph {
  const knownIds = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map(adaptNode),
    // 防御：即使后端返回了端点缺失的边，也不把悬空边交给图库。
    links: edges
      .filter((e) => knownIds.has(e.source_node_id) && knownIds.has(e.target_node_id))
      .map(adaptEdge),
  };
}

/** 合并两个图层为同一张图； links 原样拼接，跨层边留给后端未来提供。 */
export function mergeGraphs(...graphs: RuntimeGraph[]): RuntimeGraph {
  return {
    nodes: graphs.flatMap((g) => g.nodes),
    links: graphs.flatMap((g) => g.links),
  };
}

export type { RuntimeGraphNode };
