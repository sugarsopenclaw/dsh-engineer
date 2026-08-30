import { describe, expect, it } from "vitest";
import {
  computeNeighborhood,
  EMPTY_FILTERS,
  filterGraph,
  isFilterActive,
  nodeMatchesFilters,
} from "../graph/filter";
import type { RuntimeGraph, RuntimeRequirementNode } from "../graph/runtime";

function makeNode(overrides: Partial<RuntimeRequirementNode> = {}): RuntimeRequirementNode {
  return {
    nodeKind: "business_requirement",
    id: "BR-X",
    label: "节点",
    description: null,
    requirementKind: "business_outcome",
    originKind: "customer_stated",
    atomic: true,
    customerVisible: true,
    needsConfirmation: false,
    lifecycleStatus: "discovery",
    derivedMinDepth: 1,
    sourceProximityRank: 1,
    directEvidenceCount: 0,
    acceptanceCriterionCount: 0,
    openQuestionCount: 0,
    x: 0,
    y: 0,
    z: 0,
    radius: 0,
    positionLocked: false,
    ...overrides,
  };
}

const graph: RuntimeGraph = {
  nodes: [
    makeNode({ id: "BR-000", label: "总需求", atomic: false, originKind: "normalized", sourceProximityRank: 0 }),
    makeNode({ id: "BR-A01", label: "审核图纸上的尺寸标注" }),
    makeNode({ id: "BR-B01", label: "图纸转换", atomic: false, originKind: "domain_decomposition", needsConfirmation: true }),
  ],
  links: [
    { id: "E1", source: "BR-000", target: "BR-A01", relationKind: "contains_requirement", displayOrder: 1, rationale: null },
    { id: "E2", source: "BR-000", target: "BR-B01", relationKind: "contains_requirement", displayOrder: 2, rationale: null },
    { id: "E3", source: "BR-A01", target: "BR-B01", relationKind: "reuses_requirement", displayOrder: 1, rationale: null },
  ],
};

describe("filterGraph", () => {
  it("无筛选条件时原样返回", () => {
    expect(filterGraph(graph, EMPTY_FILTERS)).toBe(graph);
    expect(isFilterActive(EMPTY_FILTERS)).toBe(false);
  });

  it("按来源类型过滤后不留悬空边", () => {
    const result = filterGraph(graph, {
      ...EMPTY_FILTERS,
      originKinds: new Set(["customer_stated"]),
    });
    expect(result.nodes.map((n) => n.id)).toEqual(["BR-A01"]);
    expect(result.links).toHaveLength(0);
  });

  it("按搜索文本匹配 id 或名称", () => {
    const byLabel = filterGraph(graph, { ...EMPTY_FILTERS, searchText: "尺寸标注" });
    expect(byLabel.nodes.map((n) => n.id)).toEqual(["BR-A01"]);

    const byId = filterGraph(graph, { ...EMPTY_FILTERS, searchText: "br-b01" });
    expect(byId.nodes.map((n) => n.id)).toEqual(["BR-B01"]);
  });

  it("只看待确认时同时收缩边", () => {
    const result = filterGraph(graph, { ...EMPTY_FILTERS, needsConfirmationOnly: true });
    expect(result.nodes.map((n) => n.id)).toEqual(["BR-B01"]);
    expect(result.links).toHaveLength(0);
  });

  it("保留两端都可见的边", () => {
    const result = filterGraph(graph, { ...EMPTY_FILTERS, atomicOnly: false, searchText: "BR-" });
    expect(result.nodes).toHaveLength(3);
    expect(result.links).toHaveLength(3);
  });

  it("图层开关：关闭业务需求层后需求节点全部隐藏", () => {
    const result = filterGraph(graph, { ...EMPTY_FILTERS, showBusinessRequirements: false });
    expect(result.nodes).toHaveLength(0);
    expect(result.links).toHaveLength(0);
    expect(isFilterActive({ ...EMPTY_FILTERS, showBusinessRequirements: false })).toBe(true);
  });
});

describe("nodeMatchesFilters", () => {
  it("原子需求过滤", () => {
    const filters = { ...EMPTY_FILTERS, atomicOnly: true };
    expect(nodeMatchesFilters(makeNode({ atomic: true }), filters)).toBe(true);
    expect(nodeMatchesFilters(makeNode({ atomic: false }), filters)).toBe(false);
  });

  it("客户可见过滤", () => {
    const filters = { ...EMPTY_FILTERS, customerVisibleOnly: true };
    expect(nodeMatchesFilters(makeNode({ customerVisible: true }), filters)).toBe(true);
    expect(nodeMatchesFilters(makeNode({ customerVisible: false }), filters)).toBe(false);
  });

  it("搜索同时匹配描述文本", () => {
    const filters = { ...EMPTY_FILTERS, searchText: "铁芯叠片" };
    expect(
      nodeMatchesFilters(makeNode({ description: "校验铁芯叠片一致性" }), filters),
    ).toBe(true);
    expect(nodeMatchesFilters(makeNode({ description: "无关描述" }), filters)).toBe(false);
  });
});

describe("computeNeighborhood", () => {
  it("返回一阶邻接节点和边", () => {
    const { nodeIds, linkIds } = computeNeighborhood("BR-A01", graph.links);
    expect(nodeIds).toEqual(new Set(["BR-A01", "BR-000", "BR-B01"]));
    expect(linkIds).toEqual(new Set(["E1", "E3"]));
  });

  it("兼容图库把端点改写成对象后的形态", () => {
    const mutated = [
      { id: "E1", source: { id: "BR-000" }, target: { id: "BR-A01" } },
    ];
    const { nodeIds } = computeNeighborhood(
      "BR-000",
      mutated as unknown as RuntimeGraph["links"],
    );
    expect(nodeIds.has("BR-A01")).toBe(true);
  });
});
