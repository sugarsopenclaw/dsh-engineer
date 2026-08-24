import type { AgentTool } from '@earendil-works/pi-agent-core'

import {
  buildProjectArtifactTools,
  type ProjectAlgorithmExportExecutor,
  type ProjectDocxArtifactWriteExecutor,
  type ProjectExcelArtifactWriteExecutor,
  type ProjectPptxArtifactWriteExecutor,
  type ProjectTextArtifactWriteExecutor,
} from './domain/project-artifacts'
import {
  buildProjectFileTools,
  type ProjectDocumentParseExecutor,
} from './domain/project-files'
import {
  buildProjectComponentTools,
  type ProjectComponentDeleteExecutor,
  type ProjectComponentGetExecutor,
  type ProjectComponentsQueryExecutor,
  type ProjectComponentsSaveExecutor,
  type ProjectComponentUpdateExecutor,
} from './domain/project-components'
import { buildProjectDocumentSkillTools } from './domain/project-document-skills'
import { buildUserSkillTools } from './domain/user-skills'
import { buildSkillTools } from './domain/skills'
import { buildPiCodingTools, type PiCodingToolsOptions } from './domain/pi-coding'
import {
  buildMainAgentWebTools,
  type WebFetchExecutor,
  type WebSearchExecutor,
} from './domain/web'
import { buildPlanTools, type ExitPlanModeExecutor } from './domain/plan'
import { filterVisibleTools } from '../policy/tool-visibility'

const SAFE_PARENT_CAD_TOOL_NAMES = new Set([
  'cad_evidence_image',
  'cad_skill_read',
  'cad_algorithm_find',
  'cad_algorithm_write',
  'cad_algorithm_run',
  'cad_algorithm_save',
])

/** Evidence-grade reader names stay child-only; the parent's `web_fetch` is a separate tool. */
const CHILD_ONLY_WEB_TOOL_NAMES = new Set(['web_read', 'web_pdf'])

function enforceParentSubagentBoundary(tools: AgentTool<any>[]) {
  const forbidden = tools
    .map((tool) => (typeof tool.name === 'string' ? tool.name : ''))
    .filter((name) => (
      name.startsWith('design_')
      || name.startsWith('blender_mcp_')
      || CHILD_ONLY_WEB_TOOL_NAMES.has(name)
      || (name.startsWith('cad_') && !SAFE_PARENT_CAD_TOOL_NAMES.has(name))
    ))
  if (forbidden.length > 0) {
    throw new Error(`Main Agent subagent isolation violation: ${forbidden.join(', ')}`)
  }
  return tools
}

/** Unified main-agent tool registry. CAD and Blender execution are child-only. */
export function createAgentTools(deps: {
  subagentTools?: AgentTool<any>[]
  conversationId: string
  consumeAlgorithmSaveApproval: () => boolean
  /** Pi 七个通用编程工具;null/undefined 表示不注册(项目未绑定或开关关闭)。 */
  piCodingTools?: PiCodingToolsOptions | null
  /** Bound, readable project root for optional .xiaoliang/web spill; absent means inline-only. */
  projectRoot?: string | null
  mainWebFetchEnabled?: boolean
  webSearch: WebSearchExecutor
  webFetchFallback: WebFetchExecutor
  parseProjectDocument: ProjectDocumentParseExecutor
  saveProjectComponents: ProjectComponentsSaveExecutor
  queryProjectComponents: ProjectComponentsQueryExecutor
  getProjectComponent: ProjectComponentGetExecutor
  updateProjectComponent: ProjectComponentUpdateExecutor
  deleteProjectComponent: ProjectComponentDeleteExecutor
  writeProjectTextArtifact: ProjectTextArtifactWriteExecutor
  writeProjectExcelArtifact: ProjectExcelArtifactWriteExecutor
  writeProjectDocxArtifact: ProjectDocxArtifactWriteExecutor
  writeProjectPptxArtifact: ProjectPptxArtifactWriteExecutor
  exportProjectAlgorithm: ProjectAlgorithmExportExecutor
  loadApprovedPlanMessage: ExitPlanModeExecutor
}): Promise<AgentTool<any>[]> {
  return Promise.resolve(enforceParentSubagentBoundary(filterVisibleTools([
    ...(deps.piCodingTools ? buildPiCodingTools(deps.piCodingTools) : []),
    ...buildProjectFileTools({
      parseProjectDocument: deps.parseProjectDocument,
    }),
    ...buildProjectComponentTools({
      saveProjectComponents: deps.saveProjectComponents,
      queryProjectComponents: deps.queryProjectComponents,
      getProjectComponent: deps.getProjectComponent,
      updateProjectComponent: deps.updateProjectComponent,
      deleteProjectComponent: deps.deleteProjectComponent,
    }),
    ...buildUserSkillTools(),
    ...buildProjectDocumentSkillTools(),
    ...buildProjectArtifactTools({
      writeProjectTextArtifact: deps.writeProjectTextArtifact,
      writeProjectExcelArtifact: deps.writeProjectExcelArtifact,
      writeProjectDocxArtifact: deps.writeProjectDocxArtifact,
      writeProjectPptxArtifact: deps.writeProjectPptxArtifact,
      exportProjectAlgorithm: deps.exportProjectAlgorithm,
    }),
    ...buildMainAgentWebTools({
      searchWeb: deps.webSearch,
      fetchWebFallback: deps.webFetchFallback,
      projectRoot: deps.projectRoot,
      webFetchEnabled: deps.mainWebFetchEnabled,
      artifactReadOnly: !deps.piCodingTools
        && !deps.subagentTools?.some((tool) => tool.name === 'read')
        && Boolean(deps.projectRoot?.trim()),
    }),
    ...(deps.subagentTools ?? []),
    ...buildPlanTools({
      loadApprovedPlanMessage: deps.loadApprovedPlanMessage,
    }),
    ...buildSkillTools({
      conversationId: deps.conversationId,
      consumeAlgorithmSaveApproval: deps.consumeAlgorithmSaveApproval,
    }),
  ])))
}

export function listAgentToolNames(tools: AgentTool<any>[]) {
  return tools.flatMap((tool) => {
    const name = (tool as { name?: unknown }).name
    return typeof name === 'string' && name.trim().length > 0 ? [name.trim()] : []
  })
}
