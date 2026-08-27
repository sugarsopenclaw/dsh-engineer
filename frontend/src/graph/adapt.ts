import type {
  BusinessRequirementGraphEdgeDto,
  BusinessRequirementGraphNodeDto,
} from "../api/types";
import type { RuntimeGraph, RuntimeGraphLink, RuntimeGraphNode } from "./runtime";

/**
 * DTO → 运行时对象。
 * - position.x/y/z 原样映射：后端已算好语义坐标，前端不重新布局；
 * - 仅当 position.locked=true 时写 fx/fy/fz（力导向库中 fx/fy/fz 表示“钉死”）；
 * - 返回新对象，绝不复用 DTO 引用，防止图库 mutate 污染 react-query 缓存。
 */
export function adaptNode(dto: BusinessRequirementGraphNodeDto): RuntimeGraphNode {
  const node: RuntimeGraphNode = {
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
