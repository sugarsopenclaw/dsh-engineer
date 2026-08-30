import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchBusinessRequirementDetail,
  fetchBusinessRequirementsGraph,
  fetchCapabilityAtomDetail,
  fetchCapabilityAtoms,
  fetchCapabilityFacets,
} from "./client";
import type { CapabilityAtomsQuery, GraphDimensions } from "./types";

/** 图谱整体数据量小（数百节点），一次加载后本地筛选，不做轮询。 */
export function useBusinessRequirementsGraph(dimensions: GraphDimensions) {
  return useQuery({
    queryKey: ["business-requirements-graph", dimensions],
    queryFn: () => fetchBusinessRequirementsGraph(dimensions),
    staleTime: Infinity,
    retry: 1,
  });
}

/** 详情只在用户点击节点后请求；requirementId 为 null 时不发起请求。 */
export function useBusinessRequirementDetail(requirementId: string | null) {
  return useQuery({
    queryKey: ["business-requirement-detail", requirementId],
    queryFn: () => fetchBusinessRequirementDetail(requirementId as string),
    enabled: requirementId !== null,
    staleTime: Infinity,
    retry: 1,
  });
}

/* ---------------- CAD 原子能力 ---------------- */

/** facets 驱动能力筛选器：前端不维护封闭枚举。 */
export function useCapabilityFacets(enabled: boolean) {
  return useQuery({
    queryKey: ["capability-facets"],
    queryFn: fetchCapabilityFacets,
    enabled,
    staleTime: Infinity,
    retry: 1,
  });
}

/** 服务端分页 + 筛选的原子列表；79,549 个原子禁止一次性加载。 */
export function useCapabilityAtoms(query: CapabilityAtomsQuery, enabled: boolean) {
  return useQuery({
    queryKey: ["capability-atoms", query],
    queryFn: () => fetchCapabilityAtoms(query),
    enabled,
    staleTime: 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

/** 原子完整详情只在用户选中后请求。 */
export function useCapabilityAtomDetail(atomId: string | null) {
  return useQuery({
    queryKey: ["capability-atom-detail", atomId],
    queryFn: () => fetchCapabilityAtomDetail(atomId as string),
    enabled: atomId !== null,
    staleTime: Infinity,
    retry: 1,
  });
}
