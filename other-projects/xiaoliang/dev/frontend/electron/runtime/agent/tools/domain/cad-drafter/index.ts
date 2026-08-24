import type { AgentTool } from '@earendil-works/pi-agent-core'

import { buildCadQueryTool, type CadQueryUsageContext } from '../cad-subagent/cad-query'
import { buildCadSubagentProjectFileTools } from '../cad-subagent/project-files'
import type { CadSubagentToolDetails } from '../cad-subagent/tool-result'
import { buildCadDrafterCaptureTools, type MLightCadRenderer } from './capture-tools'
import { DrafterSession } from './drafter-session'
import { buildCadDrafterDrawingTools, type MLightCadDrawingReader } from './drawing-tools'
import { buildCadDrafterEntityTools } from './entity-tools'
import type { MLightCadExtractor } from '../../../../cad/mlight/mlight-extraction-service'
import type { FactsBuildService } from '../../../../cad/facts/facts-build-service'
import { buildCadFactsTools } from '../cad-subagent/facts-tools'

/** Read-side operations the backup CAD evidence child is allowed to reach. */
export type MLightCadDrafterEngine =
  MLightCadExtractor & MLightCadDrawingReader & MLightCadRenderer

export interface BuildCadDrafterToolsOptions {
  projectRoot: string
  childRunId: string
  engine: MLightCadDrafterEngine
  cadQuery: CadQueryUsageContext
  factsBuildService?: FactsBuildService
}

/**
 * Read-only tool surface for the backup CAD evidence child.
 *
 * It shares the analyst's project-file and query tools so both agents cite artifacts
 * the same way, but it never takes an AutoCAD lease.
 */
export function buildCadDrafterTools(
  options: BuildCadDrafterToolsOptions,
): AgentTool<any>[] {
  const session = new DrafterSession(options.projectRoot, options.childRunId)
  const entityTools = buildCadDrafterEntityTools({
    session,
    extractor: options.engine,
    ...(options.factsBuildService ? { factsBuildService: options.factsBuildService } : {}),
  })
  const [cadExtract, cadMeasure] = entityTools
  if (!cadExtract || !cadMeasure) throw new Error('CAD drafter entity tool contract is incomplete.')
  return [
    ...buildCadSubagentProjectFileTools(session.projectRoot),
    ...buildCadDrafterDrawingTools({ session, reader: options.engine }),
    cadExtract,
    ...(options.factsBuildService
      ? buildCadFactsTools({
          projectRoot: session.projectRoot,
          factsBuildService: options.factsBuildService,
        })
      : []),
    cadMeasure,
    ...buildCadDrafterCaptureTools({ session, renderer: options.engine }),
    buildCadQueryTool(session.projectRoot, options.cadQuery),
  ]
}

export type { MLightCadDrawingReader } from './drawing-tools'
export type { MLightCadRenderer } from './capture-tools'
export type { CadSubagentToolDetails }
