import fs from 'node:fs'
import readline from 'node:readline'

import type { CadBridgeDrawing } from '../../../../cad/drivers/autocad-http/cad-application-facade'
import {
  inspectEntitiesArtifact,
  resolveProjectFile,
} from '../cad-subagent/artifact-store'
import {
  intersects,
  recordBox,
  type PlanarBox,
} from '../cad-subagent/entity-geometry'

export {
  intersects,
  padBox,
  planarPoint,
  recordBox,
  unionBoxes,
  type PlanarBox,
} from '../cad-subagent/entity-geometry'

const MAX_JSONL_LINES = 2_000_000
const MAX_JSONL_LINE_CHARS = 2_000_000

export interface CadEntityRecord extends Record<string, unknown> {
  handle: string
  type: string
  layer: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^0[xX]/u, '').toUpperCase()
}

export interface EntityLookupResult {
  found: CadEntityRecord[]
  missingHandles: string[]
  rawPath: string
  scannedLines: number
}

/** Index types whose interior the file-channel parser cannot reach. Mirrors the extractor. */
const OPAQUE_TYPES = new Set(['ole2frame', 'proxyentity', 'acad_proxy_entity', 'acad_proxy_object'])
/** Ignore an overlap that is a rounding sliver of the requested window. */
const OPAQUE_OVERLAP_RATIO = 0.02

function boxArea(box: PlanarBox): number {
  return Math.max(0, box.max[0] - box.min[0]) * Math.max(0, box.max[1] - box.min[1])
}

function intersection(left: PlanarBox, right: PlanarBox): PlanarBox | null {
  if (!intersects(left, right)) return null
  const box: PlanarBox = {
    min: [Math.max(left.min[0], right.min[0]), Math.max(left.min[1], right.min[1])],
    max: [Math.min(left.max[0], right.max[0]), Math.min(left.max[1], right.max[1])],
  }
  return box.min[0] < box.max[0] && box.min[1] < box.max[1] ? box : null
}

/**
 * Warns when a render window is about to frame content this engine cannot draw.
 *
 * The resulting image looks finished either way, so the caller has no way to tell that an
 * embedded table came out as a blank rectangle. Saying so before the image is cited keeps
 * an unreadable region from being written up as read. A missing or stale index is not an
 * error here: this only adds context to a render that succeeds on its own.
 */
export async function describeOpaqueOverlap(input: {
  projectRoot: string
  drawing: CadBridgeDrawing
  window: PlanarBox | null
  signal?: AbortSignal
}): Promise<string[]> {
  const { projectRoot, drawing, window, signal } = input
  let rawPath: string | undefined
  try {
    const inspection = await inspectEntitiesArtifact(projectRoot, drawing, signal)
    if (inspection.status !== 'valid' || !inspection.rawPath) return []
    rawPath = inspection.rawPath
  } catch {
    return []
  }
  try {
    const raw = resolveProjectFile(projectRoot, rawPath)
    return await describeOpaqueEntitiesInIndex(raw.absolutePath, window, signal)
  } catch {
    return []
  }
}

/** Scans a published entity index for opaque entities inside `window`. */
export async function describeOpaqueEntitiesInIndex(
  absolutePath: string,
  window: PlanarBox | null,
  signal?: AbortSignal,
): Promise<string[]> {
  const windowArea = window ? boxArea(window) : 0
  const overlapping = new Map<string, number>()
  let covered = 0
  const stream = fs.createReadStream(absolutePath, { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    let scanned = 0
    for await (const line of lines) {
      if (signal?.aborted) return []
      scanned += 1
      if (scanned > MAX_JSONL_LINES) break
      if (!line || line.length > MAX_JSONL_LINE_CHARS) continue
      // Cheap reject before JSON.parse: opaque types are a small minority of any index.
      if (!OPAQUE_TYPE_HINT.test(line)) continue
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(record) || typeof record.type !== 'string') continue
      if (!OPAQUE_TYPES.has(record.type)) continue
      const box = recordBox(record)
      const overlap = box && window ? intersection(box, window) : box
      if (window && !overlap) continue
      overlapping.set(record.type, (overlapping.get(record.type) ?? 0) + 1)
      if (overlap) covered += boxArea(overlap)
    }
  } finally {
    lines.close()
    stream.destroy()
  }
  if (overlapping.size === 0) return []
  if (windowArea > 0 && covered / windowArea < OPAQUE_OVERLAP_RATIO) return []
  const breakdown = [...overlapping.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `${type}×${count}`)
    .join(', ')
  const share = windowArea > 0
    ? ` covering about ${Math.round(Math.min(1, covered / windowArea) * 100)}% of it`
    : ''
  return [
    `This window contains ${breakdown}${share}: entity types this engine can outline but not `
    + 'read inside. They render as blank blocks, so anything they cover is absent from this '
    + 'image. Report it as a limitation and route that region to AutoCAD.',
  ]
}

const OPAQUE_TYPE_HINT = /"type"\s*:\s*"(?:ole2frame|proxyentity|acad_proxy_entity|acad_proxy_object)"/u

/**
 * Streams the published entity index and returns the records for the requested handles.
 *
 * The index is read rather than the drawing because it is the artifact the evidence pack
 * cites: a measurement taken from a re-parse the reviewer cannot see would not be
 * reproducible from the pack alone.
 */
export async function lookupEntitiesByHandle(input: {
  projectRoot: string
  drawing: CadBridgeDrawing
  handles: readonly string[]
  signal?: AbortSignal
}): Promise<EntityLookupResult> {
  const { projectRoot, drawing, handles, signal } = input
  const inspection = await inspectEntitiesArtifact(projectRoot, drawing, signal)
  if (inspection.status !== 'valid' || !inspection.rawPath) {
    throw new Error(
      `The entity index for ${drawing.project_relative_path} is ${inspection.status}; run cad_extract first.`,
    )
  }
  const wanted = new Map<string, string>()
  for (const handle of handles) wanted.set(normalizeHandle(handle), handle)

  const raw = resolveProjectFile(projectRoot, inspection.rawPath)
  const found: CadEntityRecord[] = []
  let scannedLines = 0
  const stream = fs.createReadStream(raw.absolutePath, { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (signal?.aborted) throw signal.reason ?? new Error('CAD entity lookup was cancelled.')
      scannedLines += 1
      if (scannedLines > MAX_JSONL_LINES) {
        throw new Error('CAD entity artifact exceeds the supported line limit.')
      }
      if (!line || line.length > MAX_JSONL_LINE_CHARS) continue
      // Cheap reject before JSON.parse: most lines cannot contain a wanted handle at all.
      if (!line.includes('"handle"')) continue
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(record) || typeof record.handle !== 'string') continue
      const key = normalizeHandle(record.handle)
      if (!wanted.delete(key)) continue
      found.push({
        ...record,
        handle: record.handle,
        type: typeof record.type === 'string' ? record.type : '(unknown)',
        layer: typeof record.layer === 'string' ? record.layer : '(empty)',
      })
      if (wanted.size === 0) break
    }
  } finally {
    lines.close()
    stream.destroy()
  }
  return {
    found,
    missingHandles: [...wanted.values()],
    rawPath: inspection.rawPath,
    scannedLines,
  }
}
