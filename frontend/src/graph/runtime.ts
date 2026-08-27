import type {
  RequirementOriginKind,
  RequirementRelationKind,
} from "../api/types";

/**
 * 图渲染运行时对象：由 API DTO 适配而来，与 react-force-graph 的内部对象兼容。
 * API DTO（src/api/types.ts）不直接进入渲染层，避免图库 mutate 污染缓存的 DTO。
 */
export interface RuntimeGraphNode {
  id: string;
  label: string;
  description: string | null;
  requirementKind: string;
  originKind: RequirementOriginKind;
  atomic: boolean;
  customerVisible: boolean;
  needsConfirmation: boolean;
  lifecycleStatus: string;
  derivedMinDepth: number;
  sourceProximityRank: 0 | 1 | 2 | 3;
  directEvidenceCount: number;
  acceptanceCriterionCount: number;
  openQuestionCount: number;
  /** 后端 initial-semantic-v1 计算的语义坐标：越靠近原点越贴近客户原始需求。 */
  x: number;
  y: number;
  z: number;
  radius: number;
  positionLocked: boolean;
  /** 仅当后端标记 locked 时固定，防止力导向移动锚点。 */
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface RuntimeGraphLink {
  id: string;
  source: string;
  target: string;
  relationKind: RequirementRelationKind;
  displayOrder: number;
  rationale: string | null;
}

export interface RuntimeGraph {
  nodes: RuntimeGraphNode[];
  links: RuntimeGraphLink[];
}
