import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type {
  MLightCadDraftEntity,
  MLightCadMutateRuntimeResult,
  MLightCadRenderRuntimeResult,
  MLightCadWindow,
} from '../../../../../../src/shared/mlight-cad-runtime'
import type {
  MLightCadPrivateSession,
  MLightCadPrivateSessionRequest,
} from '../../../../cad/mlight/mlight-session-service'
import { cadToolResult, type CadSubagentToolDetails } from '../cad-subagent/tool-result'
import type { DrafterSession } from './drafter-session'
import { padBox, type PlanarBox } from './entity-records'
import { assertDrafterLayerName, DRAFTER_LAYER_PREFIX } from './layer-policy'
import { writePreviewPng } from './preview-store'

const MAX_DRAFT_ENTITIES = 2_000
const MAX_DRAFT_LAYERS = 32
const MAX_POLYLINE_POINTS = 500
const MAX_TEXT_LENGTH = 2_000
const SELF_CHECK_LONG_SIDE = 1_536
const DEFAULT_EXPORT_LONG_SIDE = 4_096
const COORDINATE_LIMIT = 1e9

export interface MLightCadDrafter {
  withPrivateSession<T>(
    request: MLightCadPrivateSessionRequest,
    run: (session: MLightCadPrivateSession) => Promise<T>,
  ): Promise<T>
}

const Point2 = Type.Tuple([Type.Number(), Type.Number()], { description: 'Drawing WCS coordinate pair.' })

const DraftShape = Type.Union([
  Type.Object({
    type: Type.Literal('line'),
    from: Point2,
    to: Point2,
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('polyline'),
    points: Type.Array(Point2, { minItems: 2, maxItems: MAX_POLYLINE_POINTS }),
    closed: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('circle'),
    center: Point2,
    radius: Type.Number({ exclusiveMinimum: 0 }),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('arc'),
    center: Point2,
    radius: Type.Number({ exclusiveMinimum: 0 }),
    start_angle: Type.Number({ description: 'Radians, counter-clockwise from +X.' }),
    end_angle: Type.Number({ description: 'Radians, counter-clockwise from +X.' }),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('text'),
    position: Point2,
    contents: Type.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
    height: Type.Number({ exclusiveMinimum: 0, description: 'Text height in drawing units.' }),
    rotation: Type.Optional(Type.Number({ description: 'Radians, counter-clockwise.' })),
  }, { additionalProperties: false }),
], { description: 'One shape to draw.' })

const CadDraftParameters = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 64,
    description: 'Base name for the produced file, for example "3-axis-reinforcement-markup".',
  }),
  base_path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description:
      'Project-relative drawing to draw on top of. The file is never modified: its content is copied '
      + 'into the output. Omit to start from a blank metric template.',
  })),
  layers: Type.Optional(Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 255 }),
    color_index: Type.Optional(Type.Integer({
      minimum: 1,
      maximum: 255,
      description: 'AutoCAD Color Index: 1 red, 2 yellow, 3 green, 4 cyan, 5 blue, 6 magenta, 7 white/black.',
    })),
  }, { additionalProperties: false }), {
    maxItems: MAX_DRAFT_LAYERS,
    description: 'Layer properties. Any layer used by an entity is created even if not listed here.',
  })),
  entities: Type.Array(Type.Object({
    layer: Type.String({
      minLength: 1,
      maxLength: 255,
      description: `Target layer; must start with ${DRAFTER_LAYER_PREFIX}.`,
    }),
    shape: DraftShape,
  }, { additionalProperties: false }), {
    minItems: 1,
    maxItems: MAX_DRAFT_ENTITIES,
    description: 'The complete set of shapes for this drawing. Each call redraws from the base.',
  }),
  self_check: Type.Optional(Type.Boolean({
    description: 'Render what was drawn and return the image path. Default true.',
  })),
}, { additionalProperties: false })

interface CadDraftInput {
  name: string
  base_path?: string
  layers?: { name: string; color_index?: number }[]
  entities: { layer: string; shape: Record<string, unknown> }[]
  self_check?: boolean
}

const CadExportParameters = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 64,
    description: 'Base name for the produced file.',
  }),
  format: Type.Union([Type.Literal('dxf'), Type.Literal('png')], {
    description: 'dxf for an editable drawing, png for a picture.',
  }),
  path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: 'Project-relative drawing to export; defaults to the drawing opened by cad_open.',
  })),
  bbox: Type.Optional(Type.Object({
    min: Point2,
    max: Point2,
  }, { additionalProperties: false, description: 'png only: region to frame. Omit for full extents.' })),
  isolate_layers: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
    minItems: 1,
    maxItems: 200,
    description: 'png only: render just these layers.',
  })),
  long_side: Type.Optional(Type.Integer({
    minimum: 256,
    maximum: 8_192,
    description: 'png only: long side in pixels. Default 4096.',
  })),
}, { additionalProperties: false })

interface CadExportInput {
  name: string
  format: 'dxf' | 'png'
  path?: string
  bbox?: { min: [number, number]; max: [number, number] }
  isolate_layers?: string[]
  long_side?: number
}

function assertFinitePoint(point: unknown, label: string): [number, number] {
  if (
    !Array.isArray(point)
    || point.length !== 2
    || point.some((value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > COORDINATE_LIMIT)
  ) throw new Error(`${label} must be a finite coordinate pair within the drawing range.`)
  return [point[0] as number, point[1] as number]
}

function assertFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > COORDINATE_LIMIT) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

/**
 * Converts one requested shape into the runtime's vocabulary.
 *
 * The schema already constrains the shape, but coordinates arrive from a model and a
 * NaN or an astronomically large value produces a drawing that opens to an empty view
 * with no error, so they are checked rather than trusted.
 */
function toDraftShape(shape: Record<string, unknown>, index: number): MLightCadDraftEntity['shape'] {
  const at = `entities[${index}]`
  switch (shape.type) {
    case 'line':
      return {
        type: 'line',
        from: assertFinitePoint(shape.from, `${at}.from`),
        to: assertFinitePoint(shape.to, `${at}.to`),
      }
    case 'polyline': {
      const points = (shape.points as unknown[]).map(
        (point, pointIndex) => assertFinitePoint(point, `${at}.points[${pointIndex}]`),
      )
      return { type: 'polyline', points, ...(shape.closed === true ? { closed: true } : {}) }
    }
    case 'circle':
      return {
        type: 'circle',
        center: assertFinitePoint(shape.center, `${at}.center`),
        radius: assertFinite(shape.radius, `${at}.radius`),
      }
    case 'arc':
      return {
        type: 'arc',
        center: assertFinitePoint(shape.center, `${at}.center`),
        radius: assertFinite(shape.radius, `${at}.radius`),
        startAngle: assertFinite(shape.start_angle, `${at}.start_angle`),
        endAngle: assertFinite(shape.end_angle, `${at}.end_angle`),
      }
    case 'text':
      return {
        type: 'text',
        position: assertFinitePoint(shape.position, `${at}.position`),
        contents: String(shape.contents),
        height: assertFinite(shape.height, `${at}.height`),
        ...(shape.rotation === undefined ? {} : { rotation: assertFinite(shape.rotation, `${at}.rotation`) }),
      }
    default:
      throw new Error(`${at}.shape has an unsupported type.`)
  }
}

function toPlanarBox(window: MLightCadWindow): PlanarBox {
  return { min: [window.min[0], window.min[1]], max: [window.max[0], window.max[1]] }
}

function toWindow(box: PlanarBox): MLightCadWindow {
  return { min: [box.min[0], box.min[1]], max: [box.max[0], box.max[1]] }
}

export function buildCadDrafterDraftTools(options: {
  session: DrafterSession
  drafter: MLightCadDrafter
}): AgentTool<any, CadSubagentToolDetails>[] {
  const { session, drafter } = options

  const cadDraft: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_draft',
    label: 'CAD Draft',
    description: [
      'Draw shapes onto a copy of a drawing, or onto a blank sheet, and save the result as a new DXF',
      'under xiaoliang-outputs/cad/. The base drawing is opened read-only and is never modified.',
      `Every layer you draw on must start with ${DRAFTER_LAYER_PREFIX}, so the user can isolate, freeze or`,
      'delete everything this agent added in one action, and existing drawing content is left untouched.',
      'This call is the whole drawing: it redraws from the base each time, so to fix something, resend',
      'the corrected full entity list rather than trying to patch the previous output.',
      'Unless self_check is false it returns an image of what was drawn — look at it before reporting',
      'the result, because a wrong coordinate or text height is obvious there and invisible in the numbers.',
    ].join('\n'),
    parameters: CadDraftParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadDraftInput
      const base = input.base_path ? session.resolveDrawing(input.base_path, 'cad_draft') : null

      const layerColors = new Map<string, number | undefined>()
      for (const layer of input.layers ?? []) {
        layerColors.set(assertDrafterLayerName(layer.name), layer.color_index)
      }
      const entities: MLightCadDraftEntity[] = input.entities.map((entity, index) => {
        const layer = assertDrafterLayerName(entity.layer)
        if (!layerColors.has(layer)) layerColors.set(layer, undefined)
        return { layer, shape: toDraftShape(entity.shape, index) }
      })
      if (layerColors.size > MAX_DRAFT_LAYERS) {
        throw new Error(`cad_draft accepts at most ${MAX_DRAFT_LAYERS} layers per call.`)
      }
      const layers = [...layerColors].map(([name, colorIndex]) => ({
        name,
        ...(colorIndex === undefined ? {} : { colorIndex }),
      }))

      const produced = await drafter.withPrivateSession(
        {
          projectRoot: session.projectRoot,
          ...(base ? { sourceRelativePath: base.project_relative_path } : {}),
          ...(signal ? { signal } : {}),
        },
        async (privateSession) => {
          const mutation = await privateSession.send({ kind: 'mutate', layers, entities })
          if (mutation.kind !== 'mutate') throw new Error('MLightCAD returned an unexpected draft result.')
          const selfCheck = input.self_check === false
            ? null
            : await renderSelfCheck(privateSession, mutation)
          const exported = await privateSession.send({ kind: 'export_dxf' })
          if (exported.kind !== 'export_dxf') throw new Error('MLightCAD returned an unexpected export result.')
          return { mutation, selfCheck, exported }
        },
      )

      const written = await session.workspace.write({
        name: input.name,
        extension: '.dxf',
        bytes: Buffer.from(produced.exported.dxfBase64, 'base64'),
        provenance: {
          ...(base ? { source: base } : {}),
          layers: layers.map((layer) => layer.name),
          note: base ? 'markup copy' : 'authored from the blank metric template',
        },
        ...(signal ? { signal } : {}),
      })

      const selfCheckImage = produced.selfCheck
        ? await writePreviewPng({
          projectRoot: session.projectRoot,
          drawingName: input.name,
          drawingPath: written.relativePath,
          fileNamePrefix: 'draft-selfcheck',
          pngBase64: produced.selfCheck.pngBase64,
        })
        : null

      const warnings = [
        ...produced.mutation.warnings,
        ...(produced.selfCheck?.warnings ?? []),
      ]
      if (!selfCheckImage) {
        warnings.push('No self-check image was produced, so the drawn geometry has not been visually verified.')
      }
      return cadToolResult('drafter.draft', toolCallId, {
        output_path: written.relativePath,
        byte_length: written.byteLength,
        base_path: base?.project_relative_path ?? null,
        entity_count: produced.mutation.createdHandles.length,
        created_layers: produced.mutation.createdLayers,
        reused_layers: produced.mutation.reusedLayers,
        drawn_extents: produced.mutation.addedExtents,
        image_path: selfCheckImage?.relativePath ?? null,
      }, warnings)
    },
  }

  const cadExport: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_export',
    label: 'CAD Export',
    description: [
      'Save a drawing to xiaoliang-outputs/cad/ as a deliverable the user can open or hand on.',
      'Use dxf to convert a DWG into an editable drawing, and png to produce a picture of it.',
      'This differs from cad_capture: capture makes an evidence image for your report, export makes',
      'a file for the user. Do not export a drawing you were only asked to read.',
    ].join('\n'),
    parameters: CadExportParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadExportInput
      const drawing = session.resolveDrawing(input.path, 'cad_export')
      const window = input.bbox ? toWindow({ min: input.bbox.min, max: input.bbox.max }) : undefined

      const produced = await drafter.withPrivateSession(
        {
          projectRoot: session.projectRoot,
          sourceRelativePath: drawing.project_relative_path,
          loadFonts: input.format === 'png',
          ...(signal ? { signal } : {}),
        },
        async (privateSession) => {
          if (input.format === 'dxf') {
            const exported = await privateSession.send({ kind: 'export_dxf' })
            if (exported.kind !== 'export_dxf') throw new Error('MLightCAD returned an unexpected export result.')
            return { bytes: Buffer.from(exported.dxfBase64, 'base64'), warnings: exported.warnings }
          }
          const rendered = await privateSession.send({
            kind: 'render',
            longSide: input.long_side ?? DEFAULT_EXPORT_LONG_SIDE,
            ...(window ? { window } : {}),
            ...(input.isolate_layers ? { isolateLayers: input.isolate_layers } : {}),
          })
          if (rendered.kind !== 'render') throw new Error('MLightCAD returned an unexpected render result.')
          return { bytes: Buffer.from(rendered.pngBase64, 'base64'), warnings: rendered.warnings }
        },
      )

      const written = await session.workspace.write({
        name: input.name,
        extension: input.format === 'dxf' ? '.dxf' : '.png',
        bytes: produced.bytes,
        provenance: { source: drawing, note: `exported as ${input.format}` },
        ...(signal ? { signal } : {}),
      })
      return cadToolResult('drafter.export', toolCallId, {
        output_path: written.relativePath,
        byte_length: written.byteLength,
        source_path: drawing.project_relative_path,
        format: input.format,
      }, produced.warnings)
    },
  }

  return [cadDraft, cadExport]
}

/**
 * Renders the region that was just drawn, with margin so it can be read in context.
 *
 * Framed on the added entities rather than the whole sheet: on a real drawing the markup
 * is a few metres inside hundreds, and a full-extents render at any reasonable pixel size
 * shows nothing legible.
 */
async function renderSelfCheck(
  privateSession: MLightCadPrivateSession,
  mutation: MLightCadMutateRuntimeResult,
): Promise<MLightCadRenderRuntimeResult | null> {
  if (!mutation.addedExtents) return null
  const result = await privateSession.send({
    kind: 'render',
    longSide: SELF_CHECK_LONG_SIDE,
    window: toWindow(padBox(toPlanarBox(mutation.addedExtents), 0.15)),
  })
  if (result.kind !== 'render') throw new Error('MLightCAD returned an unexpected render result.')
  return result
}
