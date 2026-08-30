/**
 * API DTO 类型：与 docs/backend/business-requirements-graph-api.md 契约一一对应。
 * 这些类型只描述 HTTP 载荷，不进入图渲染层；渲染层使用 src/graph/runtime.ts 的运行时对象。
 */

export type GraphDimensions = 2 | 3;

export type RequirementOriginKind =
  | "customer_stated"
  | "normalized"
  | "domain_decomposition";

export type RequirementRelationKind =
  | "contains_requirement"
  | "decomposes_to"
  | "reuses_requirement";

export interface GraphNodePositionDto {
  x: number;
  y: number;
  z: number;
  radius: number;
  source: "generated:initial-semantic-v1" | "stored";
  locked: boolean;
}

export interface BusinessRequirementGraphNodeDto {
  id: string;
  node_kind: "business_requirement";
  label: string;
  description: string | null;
  requirement_kind: string;
  origin_kind: RequirementOriginKind;
  atomic: boolean;
  customer_visible: boolean;
  needs_confirmation: boolean;
  lifecycle_status: string;
  priority_order: number | null;
  derived_min_depth: number;
  source_proximity_rank: 0 | 1 | 2 | 3;
  position: GraphNodePositionDto;
  summary: {
    direct_evidence_count: number;
    acceptance_criterion_count: number;
    open_question_count: number;
    scope_value_ids: string[];
  };
}

export interface BusinessRequirementGraphEdgeDto {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_kind: RequirementRelationKind;
  display_order: number;
  rationale: string | null;
  origin_kind: string;
}

export interface BusinessRequirementsGraphResponse {
  schema_version: "1.0";
  dataset: {
    dataset_id: string;
    schema_version: string;
    imported_at: string;
    content_sha256: string;
  };
  view: {
    graph_view_id: string;
    name: string;
    description: string;
    dimensions: GraphDimensions;
    layout_version: string;
    position_source: "generated:initial-semantic-v1" | "stored" | "mixed";
    coordinate_system: "cartesian";
    origin_meaning: string;
    persisted: boolean;
  };
  counts: {
    nodes: number;
    edges: number;
    atomic_requirements: number;
    level_one_requirements: number;
    needs_confirmation: number;
  };
  nodes: BusinessRequirementGraphNodeDto[];
  edges: BusinessRequirementGraphEdgeDto[];
}

export interface BusinessRequirementDetailResponse {
  dataset_id: string;
  requirement: Omit<BusinessRequirementGraphNodeDto, "position"> & {
    verification_method: string | null;
    source_emphasis: string | null;
  };
  relations: {
    parents: BusinessRequirementGraphEdgeDto[];
    children: BusinessRequirementGraphEdgeDto[];
  };
  aliases: Array<{
    requirement_alias_id: string;
    alternate_name: string;
    alias_kind: string;
    note: string | null;
  }>;
  evidence: Array<{
    requirement_source_link_id: string;
    link_kind: string;
    source_evidence_id: string;
    evidence_kind: string;
    locator: Record<string, string | number>;
    verbatim_text: string;
    source_document: {
      source_document_id: string;
      name: string;
      source_kind: string;
      authority_rank: number;
    };
  }>;
  scopes: Array<{
    requirement_scope_link_id: string;
    applicability: string;
    inherit_to_descendants: boolean;
    dimension: {
      scope_dimension_id: string;
      name: string;
    };
    value: {
      scope_value_id: string;
      name: string;
      status: string;
    };
  }>;
  acceptance_criteria: Array<{
    acceptance_criterion_id: string;
    criterion_statement: string;
    criterion_status: string;
    threshold: unknown | null;
    measurement_method: string;
    origin_kind: string;
  }>;
  open_questions: Array<{
    open_question_id: string;
    question: string;
    blocking_kind: string;
    status: string;
  }>;
}

/** FastAPI 统一错误外壳。 */
export interface ApiErrorBody {
  detail?: {
    code?: string;
    message?: string;
  };
}

/* ------------------------------------------------------------------ */
/* CAD 原子能力（docs/backend/cad-capabilities-api.md）                 */
/* 筛选项取值是开放字符串，不允许在前端维护封闭枚举。                    */
/* ------------------------------------------------------------------ */

export interface CapabilityFacetValue {
  value: string;
  count: number;
}

export interface CapabilityFacetsResponse {
  schema_version: "1.0";
  dataset_id: string;
  total_atoms: number;
  surfaces: CapabilityFacetValue[];
  observed_host_ids: CapabilityFacetValue[];
  atom_kinds: CapabilityFacetValue[];
  classification_statuses: CapabilityFacetValue[];
  operation_kinds: CapabilityFacetValue[];
  domain_tags: CapabilityFacetValue[];
}

/** graph-atoms 批量流的最小投影（9 个字段）；重字段仍走 /atoms/{atom_id} 详情。 */
export interface CapabilityGraphAtomDto {
  atom_id: string;
  surface: string;
  atom_kind: string;
  observed_host_ids: string[];
  member_name: string;
  declaring_symbol_full_name: string | null;
  classification_status: string;
  operation_kinds: string[];
  domain_tags: string[];
}

export interface CapabilityAtomSummaryDto extends CapabilityGraphAtomDto {
  inventory_id: string;
  member_signature: string | null;
  return_type: string | null;
  is_static: boolean;
  summary: string | null;
  classification_confidence: number | null;
}

export interface CapabilityAtomsPageResponse {
  schema_version: "1.0";
  dataset: {
    dataset_id: string;
    schema_version: string;
    imported_at: string;
    content_sha256: string;
  };
  total: number;
  items: CapabilityAtomSummaryDto[];
  limit: number;
  offset: number;
}

/** 原子列表查询参数；空值不下发。 */
export interface CapabilityAtomsQuery {
  surface?: string;
  observed_host_id?: string;
  atom_kind?: string;
  classification_status?: string;
  operation_kind?: string;
  domain_tag?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface CapabilityAtomMemberDto {
  name?: string;
  signature?: string | null;
  return_type?: string | null;
  parameters?: Array<Record<string, unknown>>;
  is_static?: boolean;
}

export interface CapabilityAtomEvidenceDto {
  kind?: string;
  ref?: string;
  claim?: string;
}

export interface CapabilityAtomDetailDto extends CapabilityAtomSummaryDto {
  schema_version?: string;
  canonical_key: string | null;
  source_artifact: {
    artifact_id?: string;
    kind?: string;
    name?: string;
    version?: string;
    sha256?: string;
  } | null;
  declaring_symbol: {
    symbol_id?: string;
    full_name?: string;
    kind?: string;
  } | null;
  member: CapabilityAtomMemberDto | null;
  provenance: {
    extractor?: string;
    extractor_version?: string;
    source_locator?: Record<string, unknown>;
  } | null;
  surface_metadata: Record<string, unknown> | null;
  semantic_candidates: unknown[];
  evidence: CapabilityAtomEvidenceDto[];
  processor: { kind?: string; name?: string; run_id?: string } | null;
  processed_at: string | null;
  notes: string | null;
}

export interface CapabilityAtomDetailResponse {
  schema_version: "1.0";
  dataset_id: string;
  atom: CapabilityAtomDetailDto;
}
