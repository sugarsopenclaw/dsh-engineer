import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

import type {
  CadBridgeBBox,
  CadBridgeDrawing,
} from '../../../../cad/drivers/autocad-http/cad-application-facade'
import {
  inspectEntitiesArtifact,
  resolveProjectFile,
  type CadEntitiesArtifactInspection,
} from './artifact-store'
import { intersects, isWorldSpaceRecord, recordBox } from './entity-geometry'

const MAX_JSONL_LINES = 2_000_000
const MAX_JSONL_LINE_CHARS = 2_000_000
const WRITE_BUFFER_CHARS = 256 * 1024
const DETAIL_DATASET_TIMEOUT_MS = 10_000
const DBMOD_NON_CONTENT_MASK = 8 | 16

export interface CadDetailAnchor {
  handle: string
  bbox: CadBridgeBBox
}

export type DetailDatasetStatus = 'written' | 'metadata_only' | 'skipped'

export interface DetailDatasetOutcome {
  evidenceId: string
  status: DetailDatasetStatus
  entityCount: number
  entities?: string
  evidence?: string
  durationMs: number
  indexStatus?: string
  warning?: string
}

export interface DetailDatasetCounts {
  scanned: number
  matched: number
  bbox_missing: number
  parse_failed: number
  /**
   * Indexed entities skipped because their box is not in world space, i.e. block
   * definition contents and layout entities. They are real content, but their
   * coordinates answer a different space than the plotted window.
   */
  outside_world_space: number
}

interface SidecarPaths {
  evidenceId: string
  imageRelative: string
  entitiesRelative: string
  evidenceRelative: string
  entitiesAbsolute: string
  evidenceAbsolute: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function drawingHasUnsavedContent(drawing: CadBridgeDrawing): boolean {
  if (drawing.dbmod !== null) {
    return (drawing.dbmod & ~DBMOD_NON_CONTENT_MASK) !== 0
  }
  return !drawing.saved
}

function errorKind(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 80)
  return 'Error'
}

function cancelled(signal: AbortSignal): never {
  const reason = signal.reason
  throw reason instanceof Error ? reason : new Error('CAD detail dataset capture was cancelled.')
}

function resolveSidecarPaths(projectRoot: string, imagePath: string): SidecarPaths {
  const image = resolveProjectFile(projectRoot, imagePath, { extensions: new Set(['.png']) })
  if (!image.relativePath.startsWith('.xiaoliang/cad/previews/')) {
    throw new Error('CAD detail dataset image is outside the preview artifact root.')
  }
  const parsed = path.posix.parse(image.relativePath)
  if (!parsed.name.startsWith('detail-')) {
    throw new Error('CAD detail dataset image does not use a detail artifact name.')
  }
  const entitiesRelative = path.posix.join(parsed.dir, `${parsed.name}.entities.jsonl`)
  const evidenceRelative = path.posix.join(parsed.dir, `${parsed.name}.evidence.json`)
  return {
    evidenceId: parsed.name,
    imageRelative: image.relativePath,
    entitiesRelative,
    evidenceRelative,
    entitiesAbsolute: path.join(path.dirname(image.absolutePath), `${parsed.name}.entities.jsonl`),
    evidenceAbsolute: path.join(path.dirname(image.absolutePath), `${parsed.name}.evidence.json`),
  }
}

async function replaceFile(temporary: string, target: string): Promise<void> {
  const backup = `${target}.${process.pid}.${randomUUID()}.backup`
  let backedUp = false
  let committed = false
  try {
    try {
      const existing = await fs.promises.lstat(target)
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error('CAD detail dataset target must be a regular file.')
      }
      await fs.promises.rename(target, backup)
      backedUp = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.promises.rename(temporary, target)
    committed = true
  } catch (error) {
    if (backedUp) backedUp = await fs.promises.rename(backup, target).then(() => false, () => true)
    throw error
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
    // Keep the backup when the restore above failed; deleting it would lose the last good copy.
    if (committed || !backedUp) await fs.promises.rm(backup, { force: true }).catch(() => undefined)
  }
}

async function atomicWriteJson(absolutePath: string, value: unknown): Promise<void> {
  const temporary = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await replaceFile(temporary, absolutePath)
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function invalidateEvidenceCommitMarker(absolutePath: string): Promise<void> {
  try {
    const existing = await fs.promises.lstat(absolutePath)
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('CAD detail dataset evidence target must be a regular file.')
    }
    await fs.promises.unlink(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function publishSidecarPair(input: {
  temporaryEntities: string
  temporaryEvidence: string
  entitiesTarget: string
  evidenceTarget: string
}): Promise<void> {
  const entitiesBackup = `${input.entitiesTarget}.${process.pid}.${randomUUID()}.backup`
  const evidenceBackup = `${input.evidenceTarget}.${process.pid}.${randomUUID()}.backup`
  let oldEntities = false
  let oldEvidence = false
  let newEntities = false
  let newEvidence = false
  let committed = false

  const moveExisting = async (target: string, backup: string): Promise<boolean> => {
    try {
      const existing = await fs.promises.lstat(target)
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error('CAD detail dataset target must be a regular file.')
      }
      await fs.promises.rename(target, backup)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  try {
    // Evidence is the pair's commit marker. Hide the old marker before replacing entities,
    // and publish the new marker last so an offline scan never accepts a half-updated pair.
    oldEvidence = await moveExisting(input.evidenceTarget, evidenceBackup)
    oldEntities = await moveExisting(input.entitiesTarget, entitiesBackup)
    await fs.promises.rename(input.temporaryEntities, input.entitiesTarget)
    newEntities = true
    await fs.promises.rename(input.temporaryEvidence, input.evidenceTarget)
    newEvidence = true
    committed = true
  } catch (error) {
    if (newEvidence) await fs.promises.rm(input.evidenceTarget, { force: true }).catch(() => undefined)
    if (newEntities) await fs.promises.rm(input.entitiesTarget, { force: true }).catch(() => undefined)
    if (oldEntities) await fs.promises.rename(entitiesBackup, input.entitiesTarget).catch(() => undefined)
    if (oldEvidence) await fs.promises.rename(evidenceBackup, input.evidenceTarget).catch(() => undefined)
    throw error
  } finally {
    await fs.promises.rm(input.temporaryEntities, { force: true }).catch(() => undefined)
    await fs.promises.rm(input.temporaryEvidence, { force: true }).catch(() => undefined)
    if (committed) {
      await fs.promises.rm(entitiesBackup, { force: true }).catch(() => undefined)
      await fs.promises.rm(evidenceBackup, { force: true }).catch(() => undefined)
    }
  }
}

async function scanIndexToTemporary(input: {
  rawAbsolutePath: string
  temporaryPath: string
  window: CadBridgeBBox
  signal: AbortSignal
}): Promise<DetailDatasetCounts> {
  const counts: DetailDatasetCounts = {
    scanned: 0,
    matched: 0,
    bbox_missing: 0,
    parse_failed: 0,
    outside_world_space: 0,
  }
  const output = await fs.promises.open(input.temporaryPath, 'wx', 0o600)
  // Attach the async iterator before the readable can enter flowing mode. Opening the
  // destination first avoids losing a small source file while awaiting filesystem I/O.
  const source = fs.createReadStream(input.rawAbsolutePath, {
    encoding: 'utf8',
    signal: input.signal,
  })
  const lines = readline.createInterface({ input: source, crlfDelay: Infinity })
  let pending = ''
  const flush = async (): Promise<void> => {
    if (!pending) return
    await output.writeFile(pending, { encoding: 'utf8' })
    pending = ''
  }
  try {
    for await (const line of lines) {
      if (input.signal.aborted) cancelled(input.signal)
      counts.scanned += 1
      if (counts.scanned > MAX_JSONL_LINES) {
        throw new Error('CAD detail dataset entity index exceeds the supported line limit.')
      }
      if (!line || line.length > MAX_JSONL_LINE_CHARS) {
        counts.parse_failed += 1
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        counts.parse_failed += 1
        continue
      }
      if (!isRecord(parsed)) {
        counts.parse_failed += 1
        continue
      }
      if (!isWorldSpaceRecord(parsed)) {
        counts.outside_world_space += 1
        continue
      }
      const bbox = recordBox(parsed)
      if (!bbox) {
        counts.bbox_missing += 1
        continue
      }
      if (!intersects(bbox, input.window)) continue
      counts.matched += 1
      pending += `${line}\n`
      if (pending.length >= WRITE_BUFFER_CHARS) await flush()
    }
    await flush()
    await output.sync()
  } finally {
    lines.close()
    source.destroy()
    await output.close()
  }
  return counts
}

function evidencePayload(input: {
  paths: SidecarPaths
  drawing: CadBridgeDrawing
  window: CadBridgeBBox
  anchors: readonly CadDetailAnchor[]
  handles?: readonly string[]
  paddingRatio?: number
  channel: 'com_plot' | 'mlight_render'
  inspection: CadEntitiesArtifactInspection
  counts: DetailDatasetCounts
  durationMs: number
  hasEntities: boolean
  clientRunId?: string
  childRunId?: string
  toolCallId?: string
}): Record<string, unknown> {
  return {
    schema_version: 1,
    evidence_id: input.paths.evidenceId,
    client_run_id: input.clientRunId ?? null,
    child_run_id: input.childRunId ?? null,
    tool_call_id: input.toolCallId ?? null,
    image_path: input.paths.imageRelative,
    entities_file: input.hasEntities ? path.posix.basename(input.paths.entitiesRelative) : null,
    drawing: {
      name: input.drawing.name,
      project_relative_path: input.drawing.project_relative_path,
      saved: input.drawing.saved,
      dbmod: input.drawing.dbmod,
    },
    dwg_sha256: input.inspection.source?.sha256 ?? null,
    plotted_window: {
      min: [...input.window.min],
      max: [...input.window.max],
    },
    selection_semantics: 'top_level_crossing',
    channel: input.channel,
    request: {
      handles: [...(input.handles ?? [])],
      padding_ratio: input.paddingRatio ?? 0.15,
      anchors: input.anchors.map((anchor) => ({
        handle: anchor.handle,
        bbox: { min: [...anchor.bbox.min], max: [...anchor.bbox.max] },
      })),
    },
    index: {
      status: input.inspection.status,
      producer: input.inspection.producer?.name ?? null,
      generated_at: input.inspection.generatedAt ?? null,
    },
    counts: input.counts,
    duration_ms: input.durationMs,
  }
}

async function captureDetailDatasetInner(input: {
  projectRoot: string
  drawing: CadBridgeDrawing
  imagePath: string
  window: CadBridgeBBox
  anchors: readonly CadDetailAnchor[]
  handles?: readonly string[]
  paddingRatio?: number
  channel: 'com_plot' | 'mlight_render'
  clientRunId?: string
  childRunId?: string
  toolCallId?: string
  signal: AbortSignal
  startedAt: number
}): Promise<DetailDatasetOutcome> {
  const paths = resolveSidecarPaths(input.projectRoot, input.imagePath)
  // The PNG has already been replaced by cad_detail. An older evidence file must stop
  // being discoverable before any fallible indexing work, otherwise a failed refresh
  // could pair the new image with stale entities from a previous call.
  await invalidateEvidenceCommitMarker(paths.evidenceAbsolute)
  const inspection = await inspectEntitiesArtifact(input.projectRoot, input.drawing, input.signal)
  const unsavedContent = drawingHasUnsavedContent(input.drawing)
  const emptyCounts: DetailDatasetCounts = {
    scanned: 0,
    matched: 0,
    bbox_missing: 0,
    parse_failed: 0,
    outside_world_space: 0,
  }

  if (unsavedContent || inspection.status !== 'valid' || !inspection.rawPath || !inspection.source) {
    const durationMs = elapsedMs(input.startedAt)
    await atomicWriteJson(paths.evidenceAbsolute, evidencePayload({
      paths,
      drawing: input.drawing,
      window: input.window,
      anchors: input.anchors,
      handles: input.handles,
      paddingRatio: input.paddingRatio,
      channel: input.channel,
      inspection,
      counts: emptyCounts,
      durationMs,
      hasEntities: false,
      clientRunId: input.clientRunId,
      childRunId: input.childRunId,
      toolCallId: input.toolCallId,
    }))
    return {
      evidenceId: paths.evidenceId,
      status: 'metadata_only',
      entityCount: 0,
      evidence: paths.evidenceRelative,
      durationMs,
      indexStatus: inspection.status,
      warning: unsavedContent
        ? 'CAD detail image was captured from the live unsaved drawing; the offline dataset kept metadata only and did not join disk entities.'
        : `CAD detail dataset has a ${inspection.status} entity index; only evidence metadata was written.`,
    }
  }

  const raw = resolveProjectFile(input.projectRoot, inspection.rawPath, { extensions: new Set(['.jsonl']) })
  const temporaryEntities = `${paths.entitiesAbsolute}.${process.pid}.${randomUUID()}.tmp`
  const temporaryEvidence = `${paths.evidenceAbsolute}.${process.pid}.${randomUUID()}.tmp`
  let counts: DetailDatasetCounts
  let durationMs: number
  try {
    counts = await scanIndexToTemporary({
      rawAbsolutePath: raw.absolutePath,
      temporaryPath: temporaryEntities,
      window: input.window,
      signal: input.signal,
    })
    durationMs = elapsedMs(input.startedAt)
    await fs.promises.writeFile(temporaryEvidence, `${JSON.stringify(evidencePayload({
      paths,
      drawing: input.drawing,
      window: input.window,
      anchors: input.anchors,
      handles: input.handles,
      paddingRatio: input.paddingRatio,
      channel: input.channel,
      inspection,
      counts,
      durationMs,
      hasEntities: true,
      clientRunId: input.clientRunId,
      childRunId: input.childRunId,
      toolCallId: input.toolCallId,
    }), null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await publishSidecarPair({
      temporaryEntities,
      temporaryEvidence,
      entitiesTarget: paths.entitiesAbsolute,
      evidenceTarget: paths.evidenceAbsolute,
    })
  } finally {
    await fs.promises.rm(temporaryEntities, { force: true }).catch(() => undefined)
    await fs.promises.rm(temporaryEvidence, { force: true }).catch(() => undefined)
  }
  return {
    evidenceId: paths.evidenceId,
    status: 'written',
    entityCount: counts.matched,
    entities: paths.entitiesRelative,
    evidence: paths.evidenceRelative,
    durationMs,
    indexStatus: inspection.status,
  }
}

/**
 * Persists a local training sidecar for a successful CAD detail image. The tool result
 * only carries the sidecar's status and relative path; the files themselves stay on disk
 * for the offline flywheel exporter. Any failure degrades to a warning-bearing outcome
 * and must never invalidate the image.
 */
export async function captureDetailDataset(input: {
  projectRoot: string
  drawing: CadBridgeDrawing
  imagePath: string
  window: CadBridgeBBox
  anchors: readonly CadDetailAnchor[]
  handles?: readonly string[]
  paddingRatio?: number
  channel: 'com_plot' | 'mlight_render'
  clientRunId?: string
  childRunId?: string
  toolCallId?: string
  signal?: AbortSignal
}): Promise<DetailDatasetOutcome> {
  const startedAt = Date.now()
  const fallbackEvidenceId = path.posix.parse(input.imagePath.replace(/\\/gu, '/')).name || 'detail-unknown'
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort(input.signal?.reason)
  if (input.signal?.aborted) forwardAbort()
  else input.signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error('CAD detail dataset capture timed out.')),
    DETAIL_DATASET_TIMEOUT_MS,
  )
  timeout.unref()
  try {
    return await captureDetailDatasetInner({
      ...input,
      signal: controller.signal,
      startedAt,
    })
  } catch (error) {
    return {
      evidenceId: fallbackEvidenceId,
      status: 'skipped',
      entityCount: 0,
      durationMs: elapsedMs(startedAt),
      warning: `CAD detail dataset sidecar was skipped (${errorKind(error)}).`,
    }
  } finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', forwardAbort)
  }
}
