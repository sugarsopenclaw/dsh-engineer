import type {
  RuntimeGraph,
  RuntimeGraphLink,
  RuntimeGraphNode,
  RuntimeRequirementNode,
} from "./runtime";

/**
 * 前端本地筛选条件（业务需求层数据量小，契约要求筛选在前端完成）。
 * 需求专属筛选只作用于 business_requirement 节点；
 * 能力原子图层只受图层开关控制，不被需求筛选误伤。
 */
export interface GraphFilters {
  searchText: string;
  originKinds: Set<string>;
  requirementKinds: Set<string>;
  atomicOnly: boolean;
  customerVisibleOnly: boolean;
  needsConfirmationOnly: boolean;
  /** 图层开关：业务需求层。 */
  showBusinessRequirements: boolean;
  /** 图层开关：CAD 能力原子层。 */
  showCapabilityAtoms: boolean;
}

export const EMPTY_FILTERS: GraphFilters = {
  searchText: "",
  originKinds: new Set<string>(),
  requirementKinds: new Set<string>(),
  atomicOnly: false,
  customerVisibleOnly: false,
  needsConfirmationOnly: false,
  showBusinessRequirements: true,
  showCapabilityAtoms: true,
};

export function isFilterActive(filters: GraphFilters): boolean {
  return (
    filters.searchText.trim() !== "" ||
    filters.originKinds.size > 0 ||
    filters.requirementKinds.size > 0 ||
    filters.atomicOnly ||
    filters.customerVisibleOnly ||
    filters.needsConfirmationOnly ||
    !filters.showBusinessRequirements ||
    !filters.showCapabilityAtoms
  );
}

/** 需求专属筛选，仅匹配 business_requirement 节点。 */
export function nodeMatchesFilters(
  node: RuntimeRequirementNode,
  filters: GraphFilters,
): boolean {
  if (filters.atomicOnly && !node.atomic) return false;
  if (filters.customerVisibleOnly && !node.customerVisible) return false;
  if (filters.needsConfirmationOnly && !node.needsConfirmation) return false;
  if (filters.originKinds.size > 0 && !filters.originKinds.has(node.originKind)) {
    return false;
  }
  if (
    filters.requirementKinds.size > 0 &&
    !filters.requirementKinds.has(node.requirementKind)
  ) {
    return false;
  }
  const query = filters.searchText.trim().toLowerCase();
  if (query !== "") {
    const haystack = `${node.id} ${node.label} ${node.description ?? ""}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

/** 节点在当前筛选下图层内可见。 */
export function nodeVisible(node: RuntimeGraphNode, filters: GraphFilters): boolean {
  if (node.nodeKind === "capability_atom") {
    return filters.showCapabilityAtoms;
  }
  if (!filters.showBusinessRequirements) return false;
  return nodeMatchesFilters(node, filters);
}

/**
 * 过滤后的子图：节点按筛选保留，边只保留两端都在结果中的，绝不保留悬空边。
 */
export function filterGraph(graph: RuntimeGraph, filters: GraphFilters): RuntimeGraph {
  if (!isFilterActive(filters)) return graph;
  const nodes = graph.nodes.filter((n) => nodeVisible(n, filters));
  const visibleIds = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter(
    (l) => visibleIds.has(linkEndpointId(l.source)) && visibleIds.has(linkEndpointId(l.target)),
  );
  return { nodes, links };
}

/** react-force-graph 会把 link 的 source/target 从 id 字符串改写成节点对象引用，读取时兼容两种形态。 */
export function linkEndpointId(endpoint: string | { id: string }): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

/**
 * 计算某个节点的一阶邻接（高亮用）：相邻节点 id 集合 + 相邻边 id 集合。
 */
export function computeNeighborhood(
  nodeId: string,
  links: RuntimeGraphLink[],
): { nodeIds: Set<string>; linkIds: Set<string> } {
  const nodeIds = new Set<string>([nodeId]);
  const linkIds = new Set<string>();
  for (const link of links) {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    if (source === nodeId || target === nodeId) {
      nodeIds.add(source);
      nodeIds.add(target);
      linkIds.add(link.id);
    }
  }
  return { nodeIds, linkIds };
}
