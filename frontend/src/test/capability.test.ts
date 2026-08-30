import { describe, expect, it } from "vitest";
import { adaptCapabilityAtom, adaptGraph, mergeGraphs } from "../graph/adapt";
import {
  capabilityZoneOriginX,
  capabilityZonePosition,
  requirementExtent,
} from "../graph/capabilityLayout";
import { EMPTY_FILTERS, filterGraph } from "../graph/filter";
import type { CapabilityAtomSummaryDto } from "../api/types";
import type { RuntimeGraph } from "../graph/runtime";

function makeAtomDto(
  overrides: Partial<CapabilityAtomSummaryDto> = {},
): CapabilityAtomSummaryDto {
  return {
    atom_id: "cap:dotnet:00005aa5b4ed1aef3906cb25",
    inventory_id: "thcad-v24.dotnet",
    surface: "dotnet",
    atom_kind: "method",
    observed_host_ids: ["thcad-v24"],
    declaring_symbol_full_name: "Bricscad.Ifc.IfcString",
    member_name: "GetString",
    member_signature: "System.String GetString()",
    return_type: "System.String",
    is_static: false,
    classification_status: "classified",
    operation_kinds: ["invoke", "read", "compute"],
    domain_tags: ["application"],
    summary: "调用 Bricscad.Ifc.IfcString.GetString。",
    classification_confidence: 0.55,
    ...overrides,
  };
}

describe("adaptCapabilityAtom", () => {
  it("映射摘要字段并使用调用方给出的暂存区坐标", () => {
    const node = adaptCapabilityAtom(makeAtomDto(), { x: 1000, y: -70, z: 0 });
    expect(node.nodeKind).toBe("capability_atom");
    expect(node.id).toBe("cap:dotnet:00005aa5b4ed1aef3906cb25");
    expect(node.label).toBe("GetString");
    expect(node.surface).toBe("dotnet");
    expect(node.operationKinds).toEqual(["invoke", "read", "compute"]);
    expect(node.observedHostIds).toEqual(["thcad-v24"]);
    expect([node.x, node.y, node.z]).toEqual([1000, -70, 0]);
    // 能力原子暂存区坐标无锁定语义，不写 fx/fy/fz。
    expect(node.fx).toBeUndefined();
  });
});

describe("capabilityLayout", () => {
  it("暂存区位置确定性：同参两次结果一致", () => {
    const a = capabilityZonePosition(5, 20, 900);
    const b = capabilityZonePosition(5, 20, 900);
    expect(a).toEqual(b);
  });

  it("不同 index 落在不同格子", () => {
    const a = capabilityZonePosition(0, 20, 900);
    const b = capabilityZonePosition(1, 20, 900);
    expect(a).not.toEqual(b);
  });

  it("暂存区在需求范围之外", () => {
    const requirement: RuntimeGraph = {
      nodes: [
        adaptGraph(
          [
            {
              id: "BR-000",
              node_kind: "business_requirement",
              label: "根",
              description: null,
              requirement_kind: "portfolio",
              origin_kind: "normalized",
              atomic: false,
              customer_visible: true,
              needs_confirmation: false,
              lifecycle_status: "discovery",
              priority_order: null,
              derived_min_depth: 0,
              source_proximity_rank: 0,
              position: {
                x: 0,
                y: 0,
                z: 0,
                radius: 0,
                source: "generated:initial-semantic-v1",
                locked: true,
              },
              summary: {
                direct_evidence_count: 0,
                acceptance_criterion_count: 0,
                open_question_count: 0,
                scope_value_ids: [],
              },
            },
            {
              id: "BR-FAR",
              node_kind: "business_requirement",
              label: "远",
              description: null,
              requirement_kind: "functional",
              origin_kind: "domain_decomposition",
              atomic: true,
              customer_visible: true,
              needs_confirmation: false,
              lifecycle_status: "discovery",
              priority_order: null,
              derived_min_depth: 3,
              source_proximity_rank: 3,
              position: {
                x: 700,
                y: 0,
                z: 0,
                radius: 700,
                source: "generated:initial-semantic-v1",
                locked: false,
              },
              summary: {
                direct_evidence_count: 0,
                acceptance_criterion_count: 0,
                open_question_count: 0,
                scope_value_ids: [],
              },
            },
          ],
          [],
        ).nodes[0],
        adaptGraph(
          [
            {
              id: "BR-FAR2",
              node_kind: "business_requirement",
              label: "远2",
              description: null,
              requirement_kind: "functional",
              origin_kind: "domain_decomposition",
              atomic: true,
              customer_visible: true,
              needs_confirmation: false,
              lifecycle_status: "discovery",
              priority_order: null,
              derived_min_depth: 3,
              source_proximity_rank: 3,
              position: {
                x: 700,
                y: 0,
                z: 0,
                radius: 700,
                source: "generated:initial-semantic-v1",
                locked: false,
              },
              summary: {
                direct_evidence_count: 0,
                acceptance_criterion_count: 0,
                open_question_count: 0,
                scope_value_ids: [],
              },
            },
          ],
          [],
        ).nodes[0],
      ],
      links: [],
    };
    const extent = requirementExtent(requirement.nodes);
    expect(extent).toBe(700);
    const originX = capabilityZoneOriginX(requirement.nodes);
    expect(originX).toBeGreaterThan(extent);
    const pos = capabilityZonePosition(0, 4, originX);
    expect(pos.x).toBeGreaterThan(extent);
  });
});

describe("mergeGraphs + 图层过滤", () => {
  const requirement: RuntimeGraph = {
    nodes: [
      adaptGraph(
        [
          {
            id: "BR-A01",
            node_kind: "business_requirement",
            label: "审核图纸上的尺寸标注",
            description: null,
            requirement_kind: "business_outcome",
            origin_kind: "customer_stated",
            atomic: false,
            customer_visible: true,
            needs_confirmation: false,
            lifecycle_status: "discovery",
            priority_order: 1,
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
              acceptance_criterion_count: 0,
              open_question_count: 2,
              scope_value_ids: [],
            },
          },
        ],
        [],
      ).nodes[0],
    ],
    links: [],
  };
  const capability: RuntimeGraph = {
    nodes: [adaptCapabilityAtom(makeAtomDto(), { x: 1200, y: 0, z: 0 })],
    links: [],
  };

  it("合并后两类节点共存于同一张图", () => {
    const merged = mergeGraphs(requirement, capability);
    expect(merged.nodes).toHaveLength(2);
    expect(merged.nodes.map((n) => n.nodeKind).sort()).toEqual([
      "business_requirement",
      "capability_atom",
    ]);
  });

  it("需求筛选不误伤能力原子；图层开关可单独关闭能力层", () => {
    const merged = mergeGraphs(requirement, capability);
    // 需求侧筛选“只看待确认”不应隐藏能力原子。
    const filtered = filterGraph(merged, { ...EMPTY_FILTERS, needsConfirmationOnly: true });
    expect(filtered.nodes.map((n) => n.id)).toEqual([capability.nodes[0].id]);
    // 关闭能力原子层后只剩可见的需求节点。
    const hidden = filterGraph(merged, { ...EMPTY_FILTERS, showCapabilityAtoms: false });
    expect(hidden.nodes.map((n) => n.id)).toEqual(["BR-A01"]);
  });
});
