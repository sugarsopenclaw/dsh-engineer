import type {
  RequirementOriginKind,
  RequirementRelationKind,
} from "../api/types";

/**
 * 展示语义字典。
 * 颜色只区分“来源贴近度”（origin_kind）这一契约明确给出的语义；
 * 不擅自把颜色/高度/角度解释成优先级或质量。
 */

export const ORIGIN_KIND_META: Record<
  RequirementOriginKind,
  { label: string; color: string; description: string }
> = {
  customer_stated: {
    label: "客户原始表达",
    color: "#34d399",
    description: "直接来自客户资料，最靠近原点",
  },
  normalized: {
    label: "规范化组织",
    color: "#60a5fa",
    description: "对客户表达做了命名或组织规范化",
  },
  domain_decomposition: {
    label: "领域拆分",
    color: "#c084fc",
    description: "为开发、运行和验收进行的领域拆分",
  },
};

/** 根节点 BR-000（source_proximity_rank=0）是视图锚点，用独立颜色。 */
export const ROOT_NODE_COLOR = "#fbbf24";

export function nodeColor(originKind: RequirementOriginKind, rank: number): string {
  if (rank === 0) return ROOT_NODE_COLOR;
  return ORIGIN_KIND_META[originKind]?.color ?? "#94a3b8";
}

export const RELATION_KIND_META: Record<
  RequirementRelationKind,
  { label: string; color: string }
> = {
  contains_requirement: { label: "包含", color: "rgba(148, 163, 184, 0.55)" },
  decomposes_to: { label: "拆分", color: "rgba(96, 165, 250, 0.65)" },
  reuses_requirement: { label: "复用", color: "rgba(244, 114, 182, 0.75)" },
};

export const LIFECYCLE_STATUS_LABELS: Record<string, string> = {
  discovery: "发现中",
  draft: "草稿",
  confirmed: "已确认",
  baseline: "基线",
  deprecated: "已废弃",
};

// requirement_kind 取值来自当前数据集实测，未知值回退原文展示，不臆造语义。
export const REQUIREMENT_KIND_LABELS: Record<string, string> = {
  portfolio: "需求组合",
  business_outcome: "业务成果",
  requirement_group: "需求分组",
  functional: "功能需求",
  nonfunctional: "非功能需求",
  constraint: "约束",
  governance: "治理要求",
  output: "交付产出",
  scope: "范围项",
  operational: "运行操作",
  integration: "集成需求",
};

export const EVIDENCE_KIND_LABELS: Record<string, string> = {
  verbatim_quote: "原文引用",
  table_row: "表格行",
  document_section: "文档章节",
};

export const CRITERION_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  proposed: "候选",
  confirmed: "已确认",
  rejected: "已否决",
};

export const QUESTION_STATUS_LABELS: Record<string, string> = {
  open: "待确认",
  answered: "已答复",
  closed: "已关闭",
};

export function translate(
  dictionary: Record<string, string>,
  key: string | null | undefined,
): string {
  if (key == null || key === "") return "—";
  return dictionary[key] ?? key;
}
