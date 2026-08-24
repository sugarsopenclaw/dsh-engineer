import type { AgentTool } from '@earendil-works/pi-agent-core'

import type { CadApplicationFacade } from '../../../../cad/drivers/autocad-http/cad-application-facade'
import type { CadHttpRuntimeDiagnosis } from '../../../../cad/drivers/autocad-http/cad-http-runtime'
import type { MLightCadExtractor } from '../../../../cad/mlight/mlight-extraction-service'
import type { FactsBuildService } from '../../../../cad/facts/facts-build-service'
import { buildCadSubagentCadTools } from './cad-tools'
import type { CadQueryUsageContext } from './cad-query'
import { buildCadSubagentProjectFileTools } from './project-files'
import type { CadVisualIndexUsageContext } from './visual-index'

export interface BuildCadSubagentToolsOptions {
  projectRoot: string
  facade: CadApplicationFacade
  mlightExtractor?: MLightCadExtractor
  factsBuildService?: FactsBuildService
  cadQuery: CadQueryUsageContext
  visualIndex?: CadVisualIndexUsageContext
  clientRunId?: string
  childRunId?: string
  capabilities(signal?: AbortSignal): Promise<Record<string, unknown>>
  diagnose?(signal?: AbortSignal): Promise<CadHttpRuntimeDiagnosis>
}

export function buildCadSubagentTools(
  options: BuildCadSubagentToolsOptions,
): AgentTool<any>[] {
  return [
    ...buildCadSubagentProjectFileTools(options.projectRoot),
    ...buildCadSubagentCadTools(options),
  ]
}

export type { CadSubagentToolDetails } from './tool-result'
export { loadCadArtifactImage } from './project-files'
