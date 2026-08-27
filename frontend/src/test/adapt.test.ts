import { describe, expect, it } from "vitest";
import { adaptEdge, adaptGraph, adaptNode } from "../graph/adapt";
import type {
  BusinessRequirementGraphEdgeDto,
  BusinessRequirementGraphNodeDto,
} from "../api/types";

function makeNodeDto(
  overrides: Partial<BusinessRequirementGraphNodeDto> = {},
): BusinessRequirementGraphNodeDto {
  return {
    id: "BR-TEST",
    node_kind: "business_requirement",
    label: "测试需求",
    description: null,
    requirement_kind: "business_outcome",
    origin_kind: "customer_stated",
    atomic: true,
    customer_visible: true,
    needs_confirmation: false,
    lifecycle_status: "discovery",
    priority_order: null,
    derived_min_depth: 1,
    source_proximity_rank: 1,
    position: {
      x: 180,
      y: 0,
      z: 0,
      radius: 180,
      source: "generated:initial-semantic-v1",
      locked: false,
    },
    summary: {
      direct_evidence_count: 2,
      acceptance_criterion_count: 1,
      open_question_count: 0,
      scope_value_ids: [],
    },
    ...overrides,
  };
}

function makeEdgeDto(
  overrides: Partial<BusinessRequirementGraphEdgeDto> = {},
): BusinessRequirementGraphEdgeDto {
  return {
    id: "RR-1",
    source_node_id: "A",
    target_node_id: "B",
    relation_kind: "contains_requirement",
    display_order: 1,
    rationale: null,
    origin_kind: "domain_modeling",
    ...overrides,
  };
}

describe("adaptNode", () => {
  it("映射后端语义坐标到 x/y/z", () => {
    const node = adaptNode(
      makeNodeDto({ position: { x: 12, y: -34, z: 56, radius: 66.4, source: "stored", locked: false } }),
    );
    expect(node.x).toBe(12);
    expect(node.y).toBe(-34);
    expect(node.z).toBe(56);
    expect(node.radius).toBe(66.4);
  });

  it("locked=true 时设置 fx/fy/fz", () => {
    const node = adaptNode(
      makeNodeDto({
        position: { x: 0, y: 0, z: 0, radius: 0, source: "generated:initial-semantic-v1", locked: true },
      }),
    );
    expect(node.fx).toBe(0);
    expect(node.fy).toBe(0);
    expect(node.fz).toBe(0);
  });

  it("locked=false 时不写 fx/fy/fz", () => {
    const node = adaptNode(makeNodeDto());
    expect(node.fx).toBeUndefined();
    expect(node.fy).toBeUndefined();
    expect(node.fz).toBeUndefined();
  });

  it("不复用 DTO 对象引用（防止图库 mutate 污染缓存）", () => {
    const dto = makeNodeDto();
    const node = adaptNode(dto);
    node.label = "被图库改写";
    expect(dto.label).toBe("测试需求");
  });
});

describe("adaptGraph", () => {
  it("丢弃端点缺失的悬空边", () => {
    const graph = adaptGraph(
      [makeNodeDto({ id: "A" }), makeNodeDto({ id: "B" })],
      [makeEdgeDto(), makeEdgeDto({ id: "RR-2", target_node_id: "BR-MISSING" })],
    );
    expect(graph.nodes).toHaveLength(2);
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0].id).toBe("RR-1");
  });
});

describe("adaptEdge", () => {
  it("映射关系端点与类型", () => {
    const link = adaptEdge(makeEdgeDto());
    expect(link.source).toBe("A");
    expect(link.target).toBe("B");
    expect(link.relationKind).toBe("contains_requirement");
  });
});
