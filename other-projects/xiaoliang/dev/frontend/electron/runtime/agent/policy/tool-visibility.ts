import type { AgentTool } from '@earendil-works/pi-agent-core'
import { getCadToolMetadata } from '../tools/domain/cad/metadata'

const READONLY_MODE_ALLOWED_HIDDEN_CAD_TOOLS = new Set([
  'cad_extract_selection_entities',
  'cad_extract_window_entities',
  'cad_find_text',
])
const VISIBLE_CAD_DOMAIN_TOOLS_WITHOUT_METADATA = new Set([
  'cad_evidence_image',
])
function readToolName(tool: AgentTool<any>) {
  return typeof tool.name === 'string' ? tool.name.trim() : ''
}

export function isToolVisibleToModel(toolName: string) {
  const metadata = getCadToolMetadata(toolName)
  if (toolName.startsWith('cad_')) {
    const isVisibleByMetadata = metadata
      ? metadata.visibility === 'model' ||
        (
          READONLY_MODE_ALLOWED_HIDDEN_CAD_TOOLS.has(toolName)
        )
      : VISIBLE_CAD_DOMAIN_TOOLS_WITHOUT_METADATA.has(toolName)
    if (!isVisibleByMetadata) {
      return false
    }

    return true
  }

  return metadata ? metadata.visibility === 'model' : true
}

export function filterVisibleTools(tools: AgentTool<any>[]) {
  return tools.filter((tool) => isToolVisibleToModel(readToolName(tool)))
}
