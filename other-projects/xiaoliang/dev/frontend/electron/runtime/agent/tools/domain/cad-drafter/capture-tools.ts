import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type {
  MLightCadRenderRuntimeResult,
  MLightCadWindow,
} from '../../../../../../src/shared/mlight-cad-runtime'
import type {
  MLightCadDrawingRef,
  MLightCadRenderRequest,
} from '../../../../cad/mlight/mlight-session-service'
import { cadToolResult, type CadSubagentToolDetails } from '../cad-subagent/tool-result'
import type { DrafterSession } from './drafter-session'
import {
  describeOpaqueOverlap,
  lookupEntitiesByHandle,
  padBox,
  recordBox,
  unionBoxes,
  type PlanarBox,
} from './entity-records'
import { writePreviewPng } from './preview-store'

const MAX_DETAIL_HANDLES = 8
const DEFAULT_OVERVIEW_LONG_SIDE = 2_048
const DEFAULT_DETAIL_LONG_SIDE = 1_536
const MIN_LONG_SIDE = 256
const MAX_LONG_SIDE = 4_096
const HANDLE_PATTERN = '^(?:0[xX])?[0-9A-Fa-f]+$'

export interface MLightCadRenderer {
  render(request: MLightCadRenderRequest): Promise<MLightCadRenderRuntimeResult>
}

interface CadCaptureInput {
  path?: string
  label?: string
  bbox?: { min: [number, number]; max: [number, number] }
  isolate_layers?: string[]
  long_side?: number
}

interface CadDetailInput {
  path?: string
  handles: string[]
  padding_ratio?: number
  long_side?: number
}

const Point2 = Type.Tuple([Type.Number(), Type.Number()], {
  description: 'Drawing WCS coordinate pair.',
})

const CadCaptureParameters = Type.Object({
  path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: 'Project-relative drawing path; defaults to the drawing opened by cad_open.',
  })),
  label: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 48,
    description: 'Short slug used in the image filename, for example "overview" or "axis-3".',
  })),
  bbox: Type.Optional(Type.Object({
    min: Point2,
    max: Point2,
  }, { additionalProperties: false, description: 'Drawing-coordinate window to frame; omit for full extents.' })),
  isolate_layers: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
    minItems: 1,
    maxItems: 200,
    description: 'Render only these layers. Names must match cad_layers exactly.',
  })),
  long_side: Type.Optional(Type.Integer({ minimum: MIN_LONG_SIDE, maximum: MAX_LONG_SIDE })),
}, { additionalProperties: false })

const CadDetailParameters = Type.Object({
  path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: 'Project-relative drawing path; defaults to the drawing opened by cad_open.',
  })),
  handles: Type.Array(Type.String({ minLength: 1, maxLength: 64, pattern: HANDLE_PATTERN }), {
    minItems: 1,
    maxItems: MAX_DETAIL_HANDLES,
    description: 'Entity handles to frame, taken from the entity index.',
  }),
  padding_ratio: Type.Optional(Type.Number({
    minimum: 0,
    maximum: 0.5,
    description: 'Context margin around the entities, as a fraction of their extents. Default 0.15.',
  })),
  long_side: Type.Optional(Type.Integer({ minimum: MIN_LONG_SIDE, maximum: MAX_LONG_SIDE })),
}, { additionalProperties: false })

function toRenderWindow(box: PlanarBox): MLightCadWindow {
  return { min: [box.min[0], box.min[1]], max: [box.max[0], box.max[1]] }
}

export function buildCadDrafterCaptureTools(options: {
  session: DrafterSession
  renderer: MLightCadRenderer
}): AgentTool<any, CadSubagentToolDetails>[] {
  const { session, renderer } = options

  const renderTo = async (
    request: Omit<MLightCadRenderRequest, keyof MLightCadDrawingRef> & MLightCadDrawingRef,
  ): Promise<MLightCadRenderRuntimeResult> => renderer.render(request)

  const cadCapture: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_capture',
    label: 'CAD Capture Image',
    description: [
      'Render the drawing to a PNG under .xiaoliang/cad/previews/ and return its path.',
      'Omit bbox to frame the whole drawing; pass bbox to frame a region in drawing coordinates.',
      'Use isolate_layers to render only chosen layers, which is the reliable way to show one system on a dense sheet.',
      'Rendering runs in the built-in engine, so it neither needs nor blocks AutoCAD.',
      'Cite the returned image_path in the evidence pack; embed it as a markdown image so it is visible to the reader.',
    ].join('\n'),
    parameters: CadCaptureParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadCaptureInput
      const drawing = session.resolveDrawing(input.path, 'cad_capture')
      session.select(drawing.project_relative_path)
      const window = input.bbox
        ? toRenderWindow({ min: input.bbox.min, max: input.bbox.max })
        : undefined
      const rendered = await renderTo({
        projectRoot: session.projectRoot,
        sourceRelativePath: drawing.project_relative_path,
        longSide: input.long_side ?? DEFAULT_OVERVIEW_LONG_SIDE,
        ...(window ? { window } : {}),
        ...(input.isolate_layers ? { isolateLayers: input.isolate_layers } : {}),
        ...(signal ? { signal } : {}),
      })
      const written = await writePreviewPng({
        projectRoot: session.projectRoot,
        drawingName: drawing.name,
        drawingPath: drawing.project_relative_path,
        fileNamePrefix: input.label ?? (window ? 'region' : 'overview'),
        pngBase64: rendered.pngBase64,
      })
      const opaque = await describeOpaqueOverlap({
        projectRoot: session.projectRoot,
        drawing,
        window: rendered.window
          ? { min: rendered.window.min, max: rendered.window.max }
          : null,
        ...(signal ? { signal } : {}),
      })
      return cadToolResult('drafter.capture', toolCallId, {
        drawing_path: drawing.project_relative_path,
        image_path: written.relativePath,
        width: rendered.width,
        height: rendered.height,
        byte_length: written.byteLength,
        window: rendered.window,
        isolated_layers: input.isolate_layers ?? null,
      }, [...rendered.warnings, ...opaque])
    },
  }

  const cadDetail: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_detail',
    label: 'CAD Detail Image',
    description: [
      'Frame specific entities and render a close-up PNG around them, with a margin of surrounding context.',
      'The window is computed from the handles\' bounding boxes in the entity index, so cad_extract must have run.',
      'Returns the per-handle boxes alongside the image so each entity can be located inside it.',
      'Prefer this over cad_capture when the claim is about a named component rather than a whole area.',
    ].join('\n'),
    parameters: CadDetailParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadDetailInput
      const drawing = session.resolveDrawing(input.path, 'cad_detail')
      const lookup = await lookupEntitiesByHandle({
        projectRoot: session.projectRoot,
        drawing,
        handles: input.handles,
        ...(signal ? { signal } : {}),
      })
      const anchors = lookup.found
        .map((record) => ({ handle: record.handle, type: record.type, bbox: recordBox(record) }))
        .filter((anchor): anchor is typeof anchor & { bbox: PlanarBox } => anchor.bbox !== null)
      const union = unionBoxes(anchors.map((anchor) => anchor.bbox))
      if (!union) {
        throw new Error('None of the requested handles carry a bounding box, so no detail window can be framed.')
      }
      const rendered = await renderTo({
        projectRoot: session.projectRoot,
        sourceRelativePath: drawing.project_relative_path,
        longSide: input.long_side ?? DEFAULT_DETAIL_LONG_SIDE,
        window: toRenderWindow(padBox(union, input.padding_ratio ?? 0.15)),
        ...(signal ? { signal } : {}),
      })
      const written = await writePreviewPng({
        projectRoot: session.projectRoot,
        drawingName: drawing.name,
        drawingPath: drawing.project_relative_path,
        fileNamePrefix: `detail-${anchors[0]?.handle ?? 'entity'}`,
        pngBase64: rendered.pngBase64,
      })
      const warnings = [...rendered.warnings]
      if (lookup.missingHandles.length > 0) {
        warnings.push(`Not found in the index: ${lookup.missingHandles.slice(0, 20).join(', ')}.`)
      }
      warnings.push(...await describeOpaqueOverlap({
        projectRoot: session.projectRoot,
        drawing,
        window: rendered.window
          ? { min: rendered.window.min, max: rendered.window.max }
          : null,
        ...(signal ? { signal } : {}),
      }))
      return cadToolResult('drafter.detail', toolCallId, {
        drawing_path: drawing.project_relative_path,
        image_path: written.relativePath,
        width: rendered.width,
        height: rendered.height,
        window: rendered.window,
        anchors,
      }, warnings)
    },
  }

  return [cadCapture, cadDetail]
}
