import { useQuery } from "@tanstack/react-query";
import {
  fetchBusinessRequirementDetail,
  fetchBusinessRequirementsGraph,
} from "./client";
import type { GraphDimensions } from "./types";

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
