import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type {
  MLightCadDocumentInfoRuntimeResult,
  MLightCadLayersRuntimeResult,
} from '../../../../../../src/shared/mlight-cad-runtime'
import type { MLightCadDrawingRef } from '../../../../cad/mlight/mlight-session-service'
import { cadToolResult, type CadSubagentToolDetails } from '../cad-subagent/tool-result'
import type { DrafterSession } from './drafter-session'

const MAX_REPORTED_LAYERS = 400

/**
 * The slice of {@link MLightCadSessionService} the drafter reads through. Narrowing it
 * here keeps the tools testable without an Electron window and documents exactly which
 * runtime operations this agent is allowed to reach.
 */
export interface MLightCadDrawingReader {
  documentInfo(ref: MLightCadDrawingRef): Promise<MLightCadDocumentInfoRuntimeResult>
  layers(ref: MLightCadDrawingRef): Promise<MLightCadLayersRuntimeResult>
}

interface CadOpenInput {
  path: string
}

interface CadLayersInput {
  path?: string
  name_pattern?: string
  limit?: number
}

const CadOpenParameters = Type.Object({
  path: Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: 'Project-relative path to a .dwg or .dxf drawing.',
  }),
}, { additionalProperties: false })

const CadLayersParameters = Type.Object({
  path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: 'Project-relative drawing path; defaults to the drawing opened by cad_open.',
  })),
  name_pattern: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 256,
    description: 'Case-insensitive substring filter on the layer name.',
  })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_REPORTED_LAYERS })),
}, { additionalProperties: false })

function extentsData(extents: MLightCadDocumentInfoRuntimeResult['extents']) {
  return extents ? { min: extents.min, max: extents.max } : null
}

export function buildCadDrafterDrawingTools(options: {
  session: DrafterSession
  reader: MLightCadDrawingReader
}): AgentTool<any, CadSubagentToolDetails>[] {
  const { session, reader } = options

  const cadOpen: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_open',
    label: 'CAD Open Drawing',
    description: [
      'Open a project-local DWG/DXF and report its shape.',
      'AutoCAD does not need to be installed or running; the drawing file is never modified.',
      'Returns entity/layer counts, drawing extents and missing fonts, and becomes the default drawing for later tools.',
      'When content_extents is not null the drawing has strays parked far from the sheet, so extents is much larger',
      'than the drawing itself: work from content_extents and expect unframed images to exclude those strays.',
    ].join('\n'),
    parameters: CadOpenParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadOpenInput
      const drawing = session.resolveDrawing(input.path, 'cad_open')
      const info = await reader.documentInfo({
        projectRoot: session.projectRoot,
        sourceRelativePath: drawing.project_relative_path,
        ...(signal ? { signal } : {}),
      })
      session.select(drawing.project_relative_path)
      const warnings = [...info.warnings]
      if (info.fontsNotFound.length > 0) {
        warnings.push(
          `Missing fonts rendered with fallback glyphs: ${info.fontsNotFound.slice(0, 8).join(', ')}.`,
        )
      }
      if (info.entityCount === 0) {
        warnings.push('No entities could be parsed; the drawing may be unsupported. Record this as a limitation.')
      }
      return cadToolResult('drafter.open', toolCallId, {
        drawing_path: drawing.project_relative_path,
        file_name: info.fileName,
        entity_count: info.entityCount,
        layer_count: info.layerCount,
        extents: extentsData(info.extents),
        content_extents: extentsData(info.contentExtents),
        fonts_not_found: info.fontsNotFound.slice(0, 32),
      }, warnings)
    },
  }

  const cadLayers: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_layers',
    label: 'CAD Layer Table',
    description: [
      'List the layer table of the open drawing with visibility, lock state, colour and entity count.',
      'Layers are ordered by entity count so the carrying layers come first; use name_pattern to narrow a large table.',
      'Use this instead of guessing layer names from convention.',
    ].join('\n'),
    parameters: CadLayersParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadLayersInput
      const drawing = session.resolveDrawing(input.path, 'cad_layers')
      const result = await reader.layers({
        projectRoot: session.projectRoot,
        sourceRelativePath: drawing.project_relative_path,
        ...(signal ? { signal } : {}),
      })
      session.select(drawing.project_relative_path)
      const pattern = input.name_pattern?.trim().toLowerCase()
      const matched = pattern
        ? result.layers.filter((layer) => layer.name.toLowerCase().includes(pattern))
        : result.layers
      const ordered = [...matched].sort((left, right) => (
        right.entityCount - left.entityCount || left.name.localeCompare(right.name)
      ))
      const limit = Math.min(input.limit ?? MAX_REPORTED_LAYERS, MAX_REPORTED_LAYERS)
      const reported = ordered.slice(0, limit)
      const warnings = [...result.warnings]
      if (reported.length < matched.length) {
        warnings.push(`Reported the ${reported.length} largest of ${matched.length} matching layers.`)
      }
      return cadToolResult('drafter.layers', toolCallId, {
        drawing_path: drawing.project_relative_path,
        total_layers: result.layers.length,
        matched_layers: matched.length,
        layers: reported.map((layer) => ({
          name: layer.name,
          entity_count: layer.entityCount,
          visible: layer.visible,
          frozen: layer.frozen,
          locked: layer.locked,
          color: layer.color,
        })),
      }, warnings)
    },
  }

  return [cadOpen, cadLayers]
}
