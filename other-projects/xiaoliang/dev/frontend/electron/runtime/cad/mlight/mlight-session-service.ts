import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

import type {
  MLightCadDocumentInfoRuntimeResult,
  MLightCadEntityPreviewGroup,
  MLightCadEntityPreviewRuntimeResult,
  MLightCadExportDxfRuntimeResult,
  MLightCadExtractionFilters,
  MLightCadLayersRuntimeResult,
  MLightCadRenderRuntimeResult,
  MLightCadRuntimeOperation,
  MLightCadRuntimeResult,
  MLightCadWindow,
} from '../../../../src/shared/mlight-cad-runtime'
import {
  MLightCadAssetServer,
  validateDrawingFile,
  type CadExtension,
} from './mlight-asset-server'
import { MLightCadRuntimeWindow } from './mlight-runtime-window'
import { normalizeMlightDxfEncoding } from './mlight-dxf-encoding'

const ARTIFACT_RUN_ID_PATTERN = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const DEFAULT_MAX_SESSIONS = 3
const MAX_MAX_SESSIONS = 16
const DEFAULT_SESSION_IDLE_MS = 5 * 60 * 1_000
/**
 * How long a caller queues for a window before the pool gives up on it.
 *
 * Concurrent CAD children arrive in bursts, and a burst that is one window over the budget
 * is normal rather than an error: the previous drawing is usually seconds from finishing.
 * Failing immediately turned that into a retry loop in the model. The wait stays bounded
 * so a genuinely stuck renderer still surfaces instead of hanging the child forever.
 */
const DEFAULT_SESSION_WAIT_MS = 120_000
const MIN_RENDER_LONG_SIDE = 64
const MAX_RENDER_LONG_SIDE = 8_192
const MAX_ISOLATE_LAYERS = 500
const MAX_PREVIEW_GROUPS = 200
const MAX_PREVIEW_HANDLES = 5_000

export interface MLightCadExtractionRequest {
  projectRoot: string
  sourceRelativePath: string
  artifactRunId: string
  filters?: Partial<Omit<MLightCadExtractionFilters, 'includeGeometry'>> & { includeGeometry?: boolean }
  signal?: AbortSignal
}

export interface MLightCadExtractionResult {
  requestId: string
  summary: Record<string, unknown>
  warnings: string[]
  rawPath: string
  readablePath: string
}

export interface MLightCadExtractor {
  extract(request: MLightCadExtractionRequest): Promise<MLightCadExtractionResult>
  dispose(): Promise<void>
}

export interface MLightCadDrawingRef {
  projectRoot: string
  sourceRelativePath: string
  signal?: AbortSignal
}

export interface MLightCadRenderRequest extends MLightCadDrawingRef {
  longSide?: number
  window?: MLightCadWindow
  isolateLayers?: string[]
}

/**
 * The engine surface the subagent runtime hands to its tool factories: the analyst only
 * needs `extract`, the drafter also reads document shape and layers and rasterizes
 * regions off the same pooled sessions.
 */
export interface MLightCadEngine extends MLightCadExtractor {
  documentInfo(ref: MLightCadDrawingRef): Promise<MLightCadDocumentInfoRuntimeResult>
  layers(ref: MLightCadDrawingRef): Promise<MLightCadLayersRuntimeResult>
  render(request: MLightCadRenderRequest): Promise<MLightCadRenderRuntimeResult>
  exportDxf(ref: MLightCadDrawingRef): Promise<MLightCadExportDxfRuntimeResult>
  withPrivateSession<T>(
    request: MLightCadPrivateSessionRequest,
    run: (session: MLightCadPrivateSession) => Promise<T>,
  ): Promise<T>
}

export interface MLightCadEntityPreviewRequest extends MLightCadDrawingRef {
  groups: MLightCadEntityPreviewGroup[]
  longSide?: number
}

/**
 * A document loaded into a window of its own, for callers that intend to change it.
 *
 * The handle is only valid inside `withPrivateSession`; the window is closed on the way
 * out, so nothing the caller retains can keep a mutated document alive.
 */
export interface MLightCadPrivateSession {
  /** Null when the session started from a blank template rather than a project drawing. */
  readonly drawing: ResolvedDrawing | null
  readonly document: MLightCadDocumentInfoRuntimeResult
  send(operation: MLightCadRuntimeOperation, signal?: AbortSignal): Promise<MLightCadRuntimeResult>
}

/** The blank drawings shipped in cad-data; metric is the default for construction work. */
export type MLightCadTemplate = 'acadiso' | 'acad'

export interface MLightCadPrivateSessionRequest {
  projectRoot: string
  /** Omit to start from `template` instead of an existing drawing. */
  sourceRelativePath?: string
  template?: MLightCadTemplate
  loadFonts?: boolean
  signal?: AbortSignal
}

export interface MLightCadSessionServiceOptions {
  devServerUrl?: string
  preloadPath: string
  rendererHtmlPath: string
  cadDataRoot: string
  timeoutMs?: number
  maxSessions?: number
  sessionIdleMs?: number
  sessionWaitMs?: number
  /** Seam for tests, which have no Electron window to open. */
  createRuntimeWindow?: () => MLightCadRuntimeWindow
}

export interface ResolvedDrawing {
  projectRoot: string
  sourcePath: string
  fileName: string
  extension: CadExtension
  size: number
  mtimeMs: number
}

interface PooledSession {
  key: string
  runtime: MLightCadRuntimeWindow
  lastUsedAt: number
  inFlight: number
  idleTimer?: NodeJS.Timeout
}

function clampMaxSessions(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_SESSIONS
  return Math.min(MAX_MAX_SESSIONS, Math.max(1, Math.floor(value)))
}

/**
 * Reads the window budget from the environment.
 *
 * Each window is a renderer with a parsed drawing in it, so the ceiling is memory on the
 * user's machine rather than anything the code can know. It is exposed as a knob so a
 * larger machine can run more CAD children in parallel without a rebuild; unparseable or
 * absurd values fall back to the default rather than uncapping the pool.
 */
export function resolveMaxSessions(environment: NodeJS.ProcessEnv): number {
  const raw = environment.XIAOLIANG_MLIGHT_MAX_SESSIONS?.trim()
  if (!raw) return DEFAULT_MAX_SESSIONS
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? DEFAULT_MAX_SESSIONS : clampMaxSessions(parsed)
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('MLightCAD operation was cancelled.')
}

/**
 * Distinguishes "the renderer window went away" from "the drawing could not be read". Only the
 * first is worth reopening, and it is recognised by the runtime window's own lifetime messages.
 */
export function isRuntimeWindowLifetimeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return [
    'MLightCAD runtime window is closed.',
    'MLightCAD runtime window closed.',
    'MLightCAD runtime is unavailable.',
    'MLightCAD runtime did not become ready.',
  ].includes(error.message)
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (
    !normalized
    || normalized.length > 4_096
    || normalized.includes('\0')
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) throw new Error('MLightCAD source path must be project-relative.')
  return normalized
}

/**
 * Corners arrive from the model, and corners in the wrong order are the common mistake: a window
 * given bottom-right first is unambiguous, so it is sorted rather than refused. A window with no
 * area at all cannot be repaired, and the numbers go into the message so the next attempt is a
 * corrected window instead of the same one again.
 */
export function normalizeWindow(
  value: MLightCadWindow | undefined,
  label: string,
): MLightCadWindow | undefined {
  if (!value) return undefined
  if (
    !Array.isArray(value.min)
    || !Array.isArray(value.max)
    || value.min.length !== 2
    || value.max.length !== 2
    || [...value.min, ...value.max].some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) throw new Error(`${label} must be {min:[x,y],max:[x,y]} with four finite drawing coordinates.`)
  const minX = Math.min(value.min[0], value.max[0])
  const minY = Math.min(value.min[1], value.max[1])
  const maxX = Math.max(value.min[0], value.max[0])
  const maxY = Math.max(value.min[1], value.max[1])
  if (minX === maxX || minY === maxY) {
    throw new Error(
      `${label} has no area: x ${minX}..${maxX}, y ${minY}..${maxY}. `
      + 'Widen it around the target, in drawing units, before rendering again.',
    )
  }
  return { min: [minX, minY], max: [maxX, maxY] }
}

function normalizeFilters(
  value: MLightCadExtractionRequest['filters'],
): MLightCadExtractionFilters {
  const stringList = (items: string[] | undefined, label: string): string[] | undefined => {
    if (items === undefined) return undefined
    if (
      !Array.isArray(items)
      || items.length > 100
      || items.some((item) => typeof item !== 'string' || !item || item.length > 512)
    ) throw new Error(`${label} must contain at most 100 bounded strings.`)
    return [...items]
  }
  if (value?.textPattern !== undefined && value.textPattern.length > 2_048) {
    throw new Error('MLightCAD text pattern is too long.')
  }
  const layers = stringList(value?.layers, 'MLightCAD layers')
  const types = stringList(value?.types, 'MLightCAD types')
  const window = normalizeWindow(value?.window, 'MLightCAD extraction window')
  const scope = value?.scope ?? 'model_space'
  if (scope !== 'model_space' && scope !== 'database') {
    throw new Error('MLightCAD extraction scope must be model_space or database.')
  }
  return {
    ...(layers ? { layers } : {}),
    ...(types ? { types } : {}),
    ...(window ? { window } : {}),
    ...(value?.textPattern !== undefined ? { textPattern: value.textPattern } : {}),
    includeGeometry: value?.includeGeometry ?? true,
    scope,
    includeInvisible: value?.includeInvisible ?? false,
    includeDefpoints: value?.includeDefpoints ?? false,
  }
}

function normalizeLongSide(value: number | undefined, fallback: number): number {
  const longSide = Math.round(value ?? fallback)
  if (!Number.isFinite(longSide) || longSide < MIN_RENDER_LONG_SIDE || longSide > MAX_RENDER_LONG_SIDE) {
    throw new Error(`MLightCAD render size must be between ${MIN_RENDER_LONG_SIDE} and ${MAX_RENDER_LONG_SIDE} pixels.`)
  }
  return longSide
}

/**
 * Resolves a project-relative drawing reference to a validated absolute path.
 *
 * Shared by the agent session pool and the preview grant path so both enforce the
 * same containment rules; a drawing that escapes its project root through a symlink
 * must never become reachable over the loopback origin.
 */
export async function resolveCadDrawing(ref: {
  projectRoot: string
  sourceRelativePath: string
}): Promise<ResolvedDrawing> {
  const projectRoot = await fs.promises.realpath(path.resolve(ref.projectRoot))
  if (!(await fs.promises.stat(projectRoot)).isDirectory()) {
    throw new Error('MLightCAD project root must be a directory.')
  }
  const sourceRelativePath = normalizeRelativePath(ref.sourceRelativePath)
  const sourceCandidate = path.resolve(projectRoot, ...sourceRelativePath.split('/'))
  const sourcePath = await fs.promises.realpath(sourceCandidate)
  if (!isInside(projectRoot, sourcePath) || sourcePath === projectRoot) {
    throw new Error('MLightCAD drawing escaped the trusted project root.')
  }
  const extension = path.extname(sourcePath).toLowerCase()
  if (extension !== '.dwg' && extension !== '.dxf') {
    throw new Error('MLightCAD accepts only DWG and DXF sources.')
  }
  const size = await validateDrawingFile(sourcePath, extension)
  const stat = await fs.promises.stat(sourcePath)
  return {
    projectRoot,
    sourcePath,
    fileName: path.basename(sourcePath),
    extension,
    size,
    mtimeMs: stat.mtimeMs,
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}-${randomUUID()}`)
  try {
    await fs.promises.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.promises.rename(temporaryPath, filePath)
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

/**
 * Owns the pool of MLightCAD runtime windows.
 *
 * Sessions are implicit: callers name a drawing and the service reuses a window that
 * already has that exact revision parsed. Distinct drawings occupy distinct windows and
 * therefore run in parallel, which is the property the AutoCAD COM driver cannot offer.
 */
export class MLightCadSessionService implements MLightCadEngine {
  private readonly assets: MLightCadAssetServer
  private readonly sessions = new Map<string, PooledSession>()
  private readonly privateWindows = new Set<MLightCadRuntimeWindow>()
  private readonly slotWaiters = new Set<() => void>()
  private readonly maxSessions: number
  private readonly sessionIdleMs: number
  private readonly sessionWaitMs: number
  private closed = false

  constructor(private readonly options: MLightCadSessionServiceOptions) {
    this.assets = new MLightCadAssetServer(options.cadDataRoot)
    this.maxSessions = clampMaxSessions(options.maxSessions ?? DEFAULT_MAX_SESSIONS)
    this.sessionIdleMs = Math.max(10_000, options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS)
    this.sessionWaitMs = Math.max(0, options.sessionWaitMs ?? DEFAULT_SESSION_WAIT_MS)
  }

  /** The window budget in force, so callers can size their own concurrency against it. */
  get windowBudget(): number {
    return this.maxSessions
  }

  async extract(request: MLightCadExtractionRequest): Promise<MLightCadExtractionResult> {
    if (!ARTIFACT_RUN_ID_PATTERN.test(request.artifactRunId)) {
      throw new Error('MLightCAD artifact run id is invalid.')
    }
    const drawing = await this.resolveDrawing(request)
    const relativeStageDirectory = `.xiaoliang/cad/.staging/${request.artifactRunId}/entities`
    const stageDirectory = await this.ensureStageDirectory(drawing.projectRoot, relativeStageDirectory)
    let completed = false
    try {
      const result = await this.performWithWindowRetry(
        drawing,
        { kind: 'extract', filters: normalizeFilters(request.filters) },
        false,
        request.signal,
      )
      if (result.kind !== 'extract') throw new Error('MLightCAD returned an unexpected extraction result.')
      if (request.signal?.aborted) throw abortError(request.signal)
      await Promise.all([
        atomicWrite(path.join(stageDirectory, 'entities.raw.jsonl'), result.rawJsonl),
        atomicWrite(path.join(stageDirectory, 'entities.readable.md'), result.readableMarkdown),
      ])
      completed = true
      const sessionMemoryKb = await this.sampleSessionMemoryKb(drawing)
      return {
        requestId: `mlight-${randomUUID()}`,
        summary: {
          ...result.summary,
          drawing_bytes: drawing.size,
          ...(sessionMemoryKb === null ? {} : { session_memory_kb: sessionMemoryKb }),
        },
        warnings: result.warnings.slice(0, 100),
        rawPath: `${relativeStageDirectory}/entities.raw.jsonl`,
        readablePath: `${relativeStageDirectory}/entities.readable.md`,
      }
    } finally {
      if (!completed) {
        await fs.promises.rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  async documentInfo(ref: MLightCadDrawingRef): Promise<MLightCadDocumentInfoRuntimeResult> {
    const drawing = await this.resolveDrawing(ref)
    const result = await this.performWithWindowRetry(drawing, { kind: 'document_info' }, true, ref.signal)
    if (result.kind !== 'document_info') throw new Error('MLightCAD returned an unexpected document result.')
    return result
  }

  async layers(ref: MLightCadDrawingRef): Promise<MLightCadLayersRuntimeResult> {
    const drawing = await this.resolveDrawing(ref)
    const result = await this.performWithWindowRetry(drawing, { kind: 'layers' }, false, ref.signal)
    if (result.kind !== 'layers') throw new Error('MLightCAD returned an unexpected layer result.')
    return result
  }

  async render(request: MLightCadRenderRequest): Promise<MLightCadRenderRuntimeResult> {
    const drawing = await this.resolveDrawing(request)
    const isolateLayers = request.isolateLayers
    if (isolateLayers && (
      !Array.isArray(isolateLayers)
      || isolateLayers.length > MAX_ISOLATE_LAYERS
      || isolateLayers.some((layer) => typeof layer !== 'string' || !layer || layer.length > 512)
    )) throw new Error(`MLightCAD accepts at most ${MAX_ISOLATE_LAYERS} bounded layer names.`)
    const window = normalizeWindow(request.window, 'MLightCAD render window')
    const result = await this.performWithWindowRetry(
      drawing,
      {
        kind: 'render',
        longSide: normalizeLongSide(request.longSide, 2_048),
        ...(window ? { window } : {}),
        ...(isolateLayers ? { isolateLayers: [...isolateLayers] } : {}),
      },
      true,
      request.signal,
    )
    if (result.kind !== 'render') throw new Error('MLightCAD returned an unexpected render result.')
    return result
  }

  async entityPreview(
    request: MLightCadEntityPreviewRequest,
  ): Promise<MLightCadEntityPreviewRuntimeResult> {
    const drawing = await this.resolveDrawing(request)
    const groups = request.groups
    if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_PREVIEW_GROUPS) {
      throw new Error(`MLightCAD accepts 1 to ${MAX_PREVIEW_GROUPS} preview groups.`)
    }
    let handleCount = 0
    for (const group of groups) {
      if (typeof group?.id !== 'string' || !group.id || group.id.length > 256) {
        throw new Error('MLightCAD preview group id is invalid.')
      }
      if (!Array.isArray(group.handles) || group.handles.length === 0) {
        throw new Error(`MLightCAD preview group "${group.id}" has no entity handles.`)
      }
      handleCount += group.handles.length
      if (handleCount > MAX_PREVIEW_HANDLES) {
        throw new Error(`MLightCAD preview accepts at most ${MAX_PREVIEW_HANDLES} handles per request.`)
      }
      if (group.handles.some((handle) => typeof handle !== 'string' || !handle || handle.length > 128)) {
        throw new Error(`MLightCAD preview group "${group.id}" has an invalid handle.`)
      }
    }
    const result = await this.performWithWindowRetry(
      drawing,
      {
        kind: 'entity_preview',
        groups: groups.map((group) => ({ id: group.id, handles: [...group.handles] })),
        longSide: normalizeLongSide(request.longSide, 1_024),
      },
      true,
      request.signal,
    )
    if (result.kind !== 'entity_preview') throw new Error('MLightCAD returned an unexpected preview result.')
    return result
  }

  async exportDxf(ref: MLightCadDrawingRef): Promise<MLightCadExportDxfRuntimeResult> {
    const drawing = await this.resolveDrawing(ref)
    const result = await this.performWithWindowRetry(drawing, { kind: 'export_dxf' }, false, ref.signal)
    if (result.kind !== 'export_dxf') throw new Error('MLightCAD returned an unexpected export result.')
    return normalizeMlightDxfEncoding(result)
  }

  /**
   * Loads a drawing into a window that never enters the pool, for the duration of `run`.
   *
   * Pooled sessions are shared by drawing path, so a change applied to one would be
   * visible to every later reader of that drawing — including a `cad-analyst` extraction
   * running at the same time, which would then publish the drafter's own markup as part
   * of the user's drawing. Anything that modifies a document therefore gets a window of
   * its own, used once and closed, and the user's file on disk is never reopened for
   * write at all: the result leaves as exported bytes.
   */
  async withPrivateSession<T>(
    request: MLightCadPrivateSessionRequest,
    run: (session: MLightCadPrivateSession) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error('MLightCAD session service is closed.')
    const drawing = request.sourceRelativePath === undefined
      ? null
      : await this.resolveDrawing({
        projectRoot: request.projectRoot,
        sourceRelativePath: request.sourceRelativePath,
      })
    await this.assets.start()
    await this.evictUntilBelowLimit(request.signal)
    const runtime = this.createRuntimeWindow()
    this.privateWindows.add(runtime)
    try {
      const opened = await this.openPrivate(
        runtime,
        drawing,
        request.template ?? 'acadiso',
        request.loadFonts ?? true,
        request.signal,
      )
      return await run({
        drawing,
        document: opened,
        send: (operation, signal) => runtime.send({ operation }, signal ?? request.signal),
      })
    } finally {
      this.privateWindows.delete(runtime)
      runtime.close()
      this.releaseSlot()
    }
  }

  /**
   * Loads either a project drawing or, when none is named, a blank cad-data template.
   *
   * The templates are the stock AutoCAD ones, so a drawing authored from scratch starts
   * with the standard linetypes, text styles and dimension styles a drafter expects
   * rather than a hand-rolled skeleton.
   */
  private async openPrivate(
    runtime: MLightCadRuntimeWindow,
    drawing: ResolvedDrawing | null,
    template: MLightCadTemplate,
    loadFonts: boolean,
    signal?: AbortSignal,
  ): Promise<MLightCadDocumentInfoRuntimeResult> {
    const grant = drawing
      ? this.assets.grantSource({
        extension: drawing.extension,
        fileName: drawing.fileName,
        size: drawing.size,
        sourcePath: drawing.sourcePath,
      })
      : null
    const fileName = drawing ? drawing.fileName : `${template}.dxf`
    const sourceUrl = grant ? grant.url : `${this.assets.cadDataBaseUrl}templates/${template}.dxf`
    try {
      const result = await runtime.send(
        { open: { fileName, sourceUrl, loadFonts, writable: true }, operation: { kind: 'document_info' } },
        signal,
      )
      if (result.kind !== 'document_info') {
        throw new Error('MLightCAD returned an unexpected document result.')
      }
      return result
    } finally {
      if (grant) this.assets.revokeSource(grant.capability)
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const session of [...this.sessions.values()]) {
      if (session.idleTimer) clearTimeout(session.idleTimer)
      session.runtime.close()
    }
    this.sessions.clear()
    for (const runtime of [...this.privateWindows]) runtime.close()
    this.privateWindows.clear()
    // Queued callers must not keep waiting on a pool that will never hand out a window.
    this.releaseSlot()
    await this.assets.close()
  }

  private createRuntimeWindow(): MLightCadRuntimeWindow {
    if (this.options.createRuntimeWindow) return this.options.createRuntimeWindow()
    return new MLightCadRuntimeWindow({
      ...(this.options.devServerUrl ? { devServerUrl: this.options.devServerUrl } : {}),
      preloadPath: this.options.preloadPath,
      rendererHtmlPath: this.options.rendererHtmlPath,
      cadDataBaseUrl: this.assets.cadDataBaseUrl,
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
    })
  }

  /**
   * Runs a pooled read, rebuilding the renderer once if the window itself went away.
   *
   * A parked window can be gone by the time the next operation reaches it — the renderer
   * process may have been reaped, or a previous timeout destroyed it — and the caller sees a
   * lifetime error that has nothing to do with its request. Re-opening the drawing once turns
   * that into a slower answer instead of a failed child. Parse and content failures are not
   * retried: the same drawing fails the same way, and re-parsing a large DWG is minutes.
   */
  private async performWithWindowRetry(
    drawing: ResolvedDrawing,
    operation: MLightCadRuntimeOperation,
    needsFonts: boolean,
    signal?: AbortSignal,
  ): Promise<MLightCadRuntimeResult> {
    try {
      return await this.perform(drawing, operation, needsFonts, signal)
    } catch (error) {
      if (
        this.closed
        || signal?.aborted
        || !isRuntimeWindowLifetimeError(error)
      ) throw error
      return this.perform(drawing, operation, needsFonts, signal)
    }
  }

  private async perform(
    drawing: ResolvedDrawing,
    operation: MLightCadRuntimeOperation,
    needsFonts: boolean,
    signal?: AbortSignal,
  ): Promise<MLightCadRuntimeResult> {
    if (this.closed) throw new Error('MLightCAD session service is closed.')
    await this.assets.start()
    const key = this.sessionKey(drawing, needsFonts)
    const existing = this.sessions.get(key)
    if (existing?.runtime.isAlive) {
      return this.dispatch(existing, { operation }, signal)
    }
    if (existing) this.evict(key)
    await this.evictUntilBelowLimit(signal)
    const session: PooledSession = {
      key,
      runtime: this.createRuntimeWindow(),
      lastUsedAt: Date.now(),
      inFlight: 0,
    }
    this.sessions.set(key, session)
    const grant = this.assets.grantSource({
      extension: drawing.extension,
      fileName: drawing.fileName,
      size: drawing.size,
      sourcePath: drawing.sourcePath,
    })
    try {
      return await this.dispatch(
        session,
        {
          open: { fileName: drawing.fileName, sourceUrl: grant.url, loadFonts: needsFonts },
          operation,
        },
        signal,
      )
    } finally {
      this.assets.revokeSource(grant.capability)
    }
  }

  private async dispatch(
    session: PooledSession,
    request: Parameters<MLightCadRuntimeWindow['send']>[0],
    signal?: AbortSignal,
  ): Promise<MLightCadRuntimeResult> {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
      session.idleTimer = undefined
    }
    session.inFlight += 1
    try {
      const result = await session.runtime.send(request, signal)
      session.lastUsedAt = Date.now()
      return result
    } catch (error) {
      // A failed operation may have left the renderer mid-parse; drop the window so the
      // next caller re-opens from a clean state instead of inheriting the damage.
      this.evict(session.key)
      throw error
    } finally {
      session.inFlight -= 1
      if (session.inFlight === 0 && this.sessions.get(session.key) === session) {
        this.scheduleIdleEviction(session)
        // The window stays parked, but it is now evictable, which is what a queued caller
        // is waiting for.
        this.releaseSlot()
      }
    }
  }

  /**
   * Memory held by the window that just parsed this drawing, recorded in the artifact
   * summary so the window budget can be sized from real drawings instead of a guess.
   */
  private async sampleSessionMemoryKb(drawing: ResolvedDrawing): Promise<number | null> {
    const session = this.sessions.get(this.sessionKey(drawing, false))
    if (!session?.runtime.isAlive) return null
    return (await session.runtime.sampleMemoryKb?.()) ?? null
  }

  private scheduleIdleEviction(session: PooledSession): void {
    session.idleTimer = setTimeout(() => this.evict(session.key), this.sessionIdleMs)
    session.idleTimer.unref?.()
  }

  /**
   * Frees a slot for one more window, queueing while every window is busy.
   *
   * Private windows count here too: they are as expensive as pooled ones, and leaving them
   * outside the budget would let concurrent drafting runs open unbounded renderers.
   */
  private async evictUntilBelowLimit(signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.sessionWaitMs
    for (;;) {
      if (this.closed) throw new Error('MLightCAD session service is closed.')
      if (signal?.aborted) throw abortError(signal)
      if (this.tryFreeSlot()) return
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(
          `MLightCAD session pool is saturated: all ${this.maxSessions} windows stayed busy for `
          + `${Math.round(this.sessionWaitMs / 1_000)}s. Retry once a drawing finishes.`,
        )
      }
      await this.waitForSlot(remaining, signal)
    }
  }

  /** Evicts idle windows until one slot is free; false while every window is in flight. */
  private tryFreeSlot(): boolean {
    while (this.sessions.size + this.privateWindows.size >= this.maxSessions) {
      const victim = [...this.sessions.values()]
        .filter((session) => session.inFlight === 0)
        .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0]
      if (!victim) return false
      this.evict(victim.key)
    }
    return true
  }

  private async waitForSlot(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.slotWaiters.delete(wake)
        if (signal) signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const wake = (): void => settle()
      const onAbort = (): void => settle(signal ? abortError(signal) : undefined)
      const timer = setTimeout(wake, timeoutMs)
      timer.unref?.()
      this.slotWaiters.add(wake)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Wakes queued callers after any change that can make a slot available. */
  private releaseSlot(): void {
    for (const wake of [...this.slotWaiters]) wake()
  }

  private evict(key: string): void {
    const session = this.sessions.get(key)
    if (!session) return
    this.sessions.delete(key)
    if (session.idleTimer) clearTimeout(session.idleTimer)
    session.runtime.close()
    this.releaseSlot()
  }

  private sessionKey(drawing: ResolvedDrawing, needsFonts: boolean): string {
    return [
      drawing.projectRoot.toLowerCase(),
      drawing.sourcePath.toLowerCase(),
      drawing.size,
      drawing.mtimeMs,
      needsFonts ? 'fonts' : 'nofonts',
    ].join('|')
  }

  private async resolveDrawing(ref: {
    projectRoot: string
    sourceRelativePath: string
  }): Promise<ResolvedDrawing> {
    return resolveCadDrawing(ref)
  }

  private async ensureStageDirectory(projectRoot: string, relativePath: string): Promise<string> {
    const candidate = path.resolve(projectRoot, ...relativePath.split('/'))
    if (!isInside(projectRoot, candidate)) throw new Error('MLightCAD staging path escaped the project.')
    let existing = candidate
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing)
      if (parent === existing) throw new Error('MLightCAD staging path is invalid.')
      existing = parent
    }
    const realExisting = await fs.promises.realpath(existing)
    if (!isInside(projectRoot, realExisting)) throw new Error('MLightCAD staging path escaped through a link.')
    await fs.promises.mkdir(candidate, { recursive: true })
    const resolved = await fs.promises.realpath(candidate)
    if (!isInside(projectRoot, resolved)) throw new Error('MLightCAD staging path escaped through a link.')
    return resolved
  }
}

export interface DesktopMLightCadSessionOptions {
  appPath?: string
  cadDataRoot?: string
  devServerUrl?: string
  environment?: NodeJS.ProcessEnv
  packaged?: boolean
  preloadPath?: string
  rendererHtmlPath?: string
  resourcesPath?: string
  timeoutMs?: number
}

export function resolveCadDataRoot(options: {
  appPath: string
  packaged: boolean
  resourcesPath?: string
}): string {
  if (options.packaged && options.resourcesPath) {
    return path.join(path.resolve(options.resourcesPath), 'cad-data')
  }
  return path.join(options.appPath, 'build', '.cad-data')
}

export function createDesktopMLightCadSessionService(
  options: DesktopMLightCadSessionOptions = {},
): MLightCadSessionService {
  const environment = options.environment ?? process.env
  const appPath = path.resolve(options.appPath ?? app.getAppPath())
  const packaged = options.packaged ?? app.isPackaged
  const devServerUrl = options.devServerUrl
    ?? (environment.NODE_ENV === 'development'
      ? environment.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
      : undefined)
  return new MLightCadSessionService({
    ...(devServerUrl ? { devServerUrl } : {}),
    preloadPath: path.resolve(
      options.preloadPath ?? path.join(__dirname, 'runtime', 'cad', 'mlight', 'preload.js'),
    ),
    rendererHtmlPath: path.resolve(
      options.rendererHtmlPath ?? path.join(appPath, 'dist', 'mlight-runtime.html'),
    ),
    cadDataRoot: path.resolve(options.cadDataRoot ?? resolveCadDataRoot({
      appPath,
      packaged,
      resourcesPath: options.resourcesPath ?? process.resourcesPath,
    })),
    timeoutMs: options.timeoutMs,
    maxSessions: resolveMaxSessions(environment),
  })
}
