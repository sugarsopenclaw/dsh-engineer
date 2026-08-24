import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { MLightCadExtractor } from '../../../../cad/mlight/mlight-extraction-service'
import type { FactsBuildService } from '../../../../cad/facts/facts-build-service'
import {
  CAD_MLIGHT_ENTITIES_PRODUCER,
  inspectEntitiesArtifact,
} from '../cad-subagent/artifact-store'
import { buildMLightEntityIndex } from '../cad-subagent/entity-index'
import { cadToolResult, type CadSubagentToolDetails } from '../cad-subagent/tool-result'
import type { DrafterSession } from './drafter-session'
import {
  lookupEntitiesByHandle,
  planarPoint,
  recordBox,
  unionBoxes,
  type CadEntityRecord,
} from './entity-records'

const MAX_MEASURE_HANDLES = 50
const HANDLE_PATTERN = '^(?:0[xX])?[0-9A-Fa-f]+$'

function publicIndexProducer<T extends { name: string }>(producer: T | null | undefined): T | null | undefined {
  if (!producer) return producer
  return { ...producer, name: 'file-index' }
}

interface CadExtractInput {
  path?: string
  refresh?: boolean
}

interface CadMeasureInput {
  path?: string
  handles: string[]
}

const CadExtractParameters = Type.Object({
  path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: 'Project-relative drawing path; defaults to the drawing opened by cad_open.',
  })),
  refresh: Type.Optional(Type.Boolean({
    description: 'Rebuild the index even when a valid one already exists. Rarely needed.',
  })),
}, { additionalProperties: false })

const CadMeasureParameters = Type.Object({
  path: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: 'Project-relative drawing path; defaults to the drawing opened by cad_open.',
  })),
  handles: Type.Array(Type.String({ minLength: 1, maxLength: 64, pattern: HANDLE_PATTERN }), {
    minItems: 1,
    maxItems: MAX_MEASURE_HANDLES,
    description: 'Entity handles taken from the entity index.',
  }),
}, { additionalProperties: false })

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boxCenter(box: { min: [number, number]; max: [number, number] }): [number, number] {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]
}

/**
 * Reports only measurements the index actually carries for that entity type.
 *
 * Nothing is inferred: a closed polyline has an area, an open one does not. A dimension's
 * authored display override and its geometry-derived measurement stay separate so callers
 * cannot mistake drawing geometry for the displayed engineering value.
 */
export function measureRecord(record: CadEntityRecord) {
  const box = recordBox(record)
  const measurement: Record<string, unknown> = {
    handle: record.handle,
    type: record.type,
    layer: record.layer,
    bbox: box,
  }
  const length = finite(record.length)
  if (length !== null) measurement.length = length
  const area = finite(record.area)
  if (area !== null) measurement.area = area
  const radius = finite(record.radius)
  if (radius !== null) measurement.radius = radius
  if (typeof record.text_override === 'string') measurement.text_override = record.text_override
  const geometryMeasurement = finite(record.measurement)
  if (geometryMeasurement !== null) measurement.geometry_measurement = geometryMeasurement
  const start = planarPoint(record.start)
  const end = planarPoint(record.end)
  if (start && end) {
    measurement.start = start
    measurement.end = end
  }
  const center = planarPoint(record.center)
  if (center) measurement.center = center
  if (typeof record.closed === 'boolean') measurement.closed = record.closed
  if (Array.isArray(record.vertices)) measurement.vertex_count = record.vertices.length
  return measurement
}

export function buildCadDrafterEntityTools(options: {
  session: DrafterSession
  extractor: MLightCadExtractor
  factsBuildService?: FactsBuildService
}): AgentTool<any, CadSubagentToolDetails>[] {
  const { session, extractor } = options

  const cadExtract: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_extract',
    label: 'CAD Entity Extraction',
    description: [
      'Build or reuse the complete entity index for a project-local drawing.',
      'The index is the artifact every later claim cites: run it before cad_query, cad_measure or cad_detail.',
      'A valid index is reused as-is, so calling this repeatedly on the same drawing is cheap.',
      'It writes only under .xiaoliang/cad/ and never modifies the drawing.',
    ].join('\n'),
    parameters: CadExtractParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadExtractInput
      const drawing = session.resolveDrawing(input.path, 'cad_extract')
      session.select(drawing.project_relative_path)
      const existing = await inspectEntitiesArtifact(session.projectRoot, drawing, signal)
      if (existing.status === 'valid' && !input.refresh) {
        const factsWarnings: string[] = []
        if (options.factsBuildService) {
          try {
            const facts = await options.factsBuildService.ensureL1({
              projectRoot: session.projectRoot,
              drawing,
              ...(existing.producer?.name === CAD_MLIGHT_ENTITIES_PRODUCER.name
                ? { mlightIndexPath: existing.rawPath }
                : {}),
            })
            factsWarnings.push(...facts.warnings)
          } catch (error) {
            factsWarnings.push(
              `Four-layer facts were not built: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        return cadToolResult('drafter.extract', toolCallId, {
          drawing,
          summary: existing.summary ?? {},
          cache: {
            hit: true,
            status: existing.status,
            producer: publicIndexProducer(existing.producer),
            manifest_path: existing.manifestPath,
          },
          raw_path: existing.rawPath,
          readable_path: existing.readablePath,
        }, factsWarnings)
      }
      const published = await buildMLightEntityIndex({
        projectRoot: session.projectRoot,
        drawing,
        extractor,
        ...(options.factsBuildService ? { factsBuildService: options.factsBuildService } : {}),
        ...(signal ? { signal } : {}),
      })
      return cadToolResult('drafter.extract', toolCallId, {
        drawing,
        summary: published.summary,
        cache: {
          hit: false,
          previous_status: existing.status,
          status: 'valid',
          producer: publicIndexProducer(CAD_MLIGHT_ENTITIES_PRODUCER),
          manifest_path: published.manifestPath,
        },
        raw_path: published.rawPath,
        readable_path: published.readablePath,
      }, published.warnings)
    },
  }

  const cadMeasure: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_measure',
    label: 'CAD Measure Entities',
    description: [
      'Report the geometry the entity index holds for specific handles: length, area, radius, centre and bounding box.',
      'For dimension entities, text_override is the author-displayed value and geometry_measurement is a separate geometry-derived value used only for verification.',
      'With two or more handles it adds their combined extents and the distance between bounding-box centres; center_distance is not an annotated dimension.',
      'Values come from the published index, so cite them together with the drawing path and handle.',
      'Requires cad_extract to have produced a valid index for the drawing.',
    ].join('\n'),
    parameters: CadMeasureParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadMeasureInput
      const drawing = session.resolveDrawing(input.path, 'cad_measure')
      const lookup = await lookupEntitiesByHandle({
        projectRoot: session.projectRoot,
        drawing,
        handles: input.handles,
        ...(signal ? { signal } : {}),
      })
      const measurements = lookup.found.map(measureRecord)
      const boxes = lookup.found
        .map(recordBox)
        .filter((box): box is NonNullable<typeof box> => box !== null)
      const combined = unionBoxes(boxes)
      const warnings: string[] = []
      if (lookup.missingHandles.length > 0) {
        warnings.push(
          `Not found in the index: ${lookup.missingHandles.slice(0, 20).join(', ')}.`,
        )
      }
      if (boxes.length < lookup.found.length) {
        warnings.push('Some entities carry no bounding box, so they are absent from the combined extents.')
      }
      const pairDistance = boxes.length === 2
        ? Math.hypot(
          boxCenter(boxes[1])[0] - boxCenter(boxes[0])[0],
          boxCenter(boxes[1])[1] - boxCenter(boxes[0])[1],
        )
        : null
      return cadToolResult('drafter.measure', toolCallId, {
        drawing_path: drawing.project_relative_path,
        raw_path: lookup.rawPath,
        requested_handles: input.handles.length,
        measurements,
        combined_extents: combined,
        ...(pairDistance === null ? {} : { center_distance: pairDistance }),
        ...(pairDistance === null
          ? {}
          : { center_distance_semantics: 'distance_between_bbox_centers; not_an_annotated_dimension' }),
      }, warnings)
    },
  }

  return [cadExtract, cadMeasure]
}
