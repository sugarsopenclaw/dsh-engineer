import type { RequirementOriginKind } from "../api/types";

/**
 * 图渲染运行时对象：由 API DTO 适配而来，与 react-force-graph 的内部对象兼容。
 * API DTO（src/api/types.ts）不直接进入渲染层，避免图库 mutate 污染缓存的 DTO。
 *
 * 同一张图承载多种节点类型（业务需求、CAD 能力原子，以及未来的
 * 任务 / AgentRun / Logic / Review 等），用 nodeKind 判别联合表达；
 * 边保持开放字符串类型，以便直接接收后端未来提供的跨层关系。
 */

export type GraphNodeKind = "business_requirement" | "capability_atom";

interface RuntimeNodeBase {
  id: string;
  label: string;
  description: string | null;
  /** 节点在语义布局中的半径（能力原子暂存区为 0，无业务含义）。 */
  radius: number;
  positionLocked: boolean;
  /** 后端语义坐标或确定性暂存区坐标。 */
  x: number;
  y: number;
  z: number;
  /** 仅当后端标记 locked 时固定，防止力导向移动锚点。 */
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface RuntimeRequirementNode extends RuntimeNodeBase {
  nodeKind: "business_requirement";
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
}

export interface RuntimeCapabilityAtomNode extends RuntimeNodeBase {
  nodeKind: "capability_atom";
  surface: string;
  atomKind: string;
  classificationStatus: string;
  operationKinds: string[];
  observedHostIds: string[];
  domainTags: string[];
  memberName: string;
  /* 以下字段只来自摘要/详情接口；graph-atoms 最小投影不含，画布节点可为空。 */
  memberSignature?: string | null;
  declaringSymbolFullName: string | null;
  returnType?: string | null;
  isStatic?: boolean;
  summary?: string | null;
  classificationConfidence?: number | null;
}

export type RuntimeGraphNode = RuntimeRequirementNode | RuntimeCapabilityAtomNode;

export interface RuntimeGraphLink {
  id: string;
  source: string;
  target: string;
  /** 开放字符串：当前只有需求关系，未来可接收跨层关系（如 uses_capability_atom）。 */
  relationKind: string;
  displayOrder: number;
  rationale: string | null;
}

export interface RuntimeGraph {
  nodes: RuntimeGraphNode[];
  links: RuntimeGraphLink[];
}
