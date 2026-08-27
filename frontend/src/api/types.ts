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
