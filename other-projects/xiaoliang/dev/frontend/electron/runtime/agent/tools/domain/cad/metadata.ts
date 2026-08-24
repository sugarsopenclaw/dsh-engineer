export type CadToolRiskLevel = 'low' | 'medium' | 'high'
export type CadToolApprovalMode = 'none' | 'manual-enable'
export type CadToolVisibility = 'model' | 'hidden'
export type CadCapabilityFamily = 'skills' | 'mutate' | 'commands'

export interface CadToolMetadata {
  riskLevel: CadToolRiskLevel
  approvalMode: CadToolApprovalMode
  visibility: CadToolVisibility
  capabilityFamily: CadCapabilityFamily
  readOnly: boolean
  requiresCadConnection: boolean
}

export const cadToolMetadataByName: Record<string, CadToolMetadata> = {
  cad_skill_read: {
    riskLevel: 'low',
    approvalMode: 'none',
    visibility: 'model',
    capabilityFamily: 'skills',
    readOnly: true,
    requiresCadConnection: false,
  },
  cad_algorithm_find: {
    riskLevel: 'low',
    approvalMode: 'none',
    visibility: 'model',
    capabilityFamily: 'skills',
    readOnly: true,
    requiresCadConnection: false,
  },
  cad_algorithm_write: {
    riskLevel: 'medium',
    approvalMode: 'none',
    visibility: 'model',
    capabilityFamily: 'skills',
    readOnly: false,
    requiresCadConnection: false,
  },
  cad_algorithm_run: {
    riskLevel: 'medium',
    approvalMode: 'none',
    visibility: 'model',
    capabilityFamily: 'skills',
    readOnly: true,
    requiresCadConnection: false,
  },
  cad_algorithm_save: {
    riskLevel: 'medium',
    approvalMode: 'none',
    visibility: 'model',
    capabilityFamily: 'skills',
    readOnly: false,
    requiresCadConnection: false,
  },
  // No tool currently ships under these names. The entries stay as a deny-list:
  // guardToolExecution blocks anything marked hidden / manual-enable, so a future
  // reintroduction is refused by default instead of shipping open.
  cad_send_command: {
    riskLevel: 'high',
    approvalMode: 'manual-enable',
    visibility: 'hidden',
    capabilityFamily: 'commands',
    readOnly: false,
    requiresCadConnection: true,
  },
  cad_set_variable: {
    riskLevel: 'high',
    approvalMode: 'manual-enable',
    visibility: 'hidden',
    capabilityFamily: 'commands',
    readOnly: false,
    requiresCadConnection: true,
  },
  cad_mutate_entity: {
    riskLevel: 'high',
    approvalMode: 'manual-enable',
    visibility: 'hidden',
    capabilityFamily: 'mutate',
    readOnly: false,
    requiresCadConnection: true,
  },
} as const

export function getCadToolMetadata(toolName: string) {
  return cadToolMetadataByName[toolName] ?? null
}
