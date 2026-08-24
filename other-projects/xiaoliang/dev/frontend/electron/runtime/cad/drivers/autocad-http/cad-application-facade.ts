import path from 'node:path'

import type {
  CadHttpBridgeCallOptions,
  CadHttpBridgeExecutor,
} from './bridge-client'
import {
  LONG_CAD_HTTP_TIMEOUT_MS,
  LONG_CAD_OPERATION_TIMEOUT_MS,
} from './bridge-client'

export interface CadBridgeDocument {
  index: number
  name: string
  project_relative_path: string | null
  active: boolean
  saved: boolean
  dbmod: number | null
}

export interface CadBridgeApplicationStatus {
  running: boolean
  supported: boolean
  visible?: boolean
  version?: string
  document_count: number
  documents: CadBridgeDocument[]
}

export type CadBridgeRestartQuitMode =
  | 'not_running'
  | 'graceful'
  | 'forced_pid'
  | 'forced_image'

export interface CadBridgeRestartResult extends CadBridgeApplicationStatus {
  restarted: boolean
  forced: boolean
  quitMode: CadBridgeRestartQuitMode
}

export interface CadBridgeDoctorResult {
  application: CadBridgeApplicationStatus
  installation: {
    fullInstalled: boolean | null
    ltInstalled: boolean | null
    comRegistered: boolean | null
  }
  plot: {
    ready: boolean
    dependencies: {
      pywin32: boolean
      pillow: boolean
      pdfium: boolean
    }
    configurations: {
      pdf: boolean | null
      png: boolean | null
    }
    warnings: string[]
  }
}

export interface CadBridgeEntityReadResult {
  document: CadBridgeDocument
  entities: Array<Record<string, unknown>>
  errors: Array<{ handle: string; code: string }>
}

export interface CadBridgeBBox {
  min: [number, number]
  max: [number, number]
}

export interface CadBridgeDrawing {
  name: string
  project_relative_path: string
  saved: boolean
  dbmod: number | null
}

export type CadBridgeDocumentSelector = { name: string } | { index: number }
export type CadBridgeFirstLevelQuadrant = 'q1' | 'q2' | 'q3' | 'q4'
export type CadBridgeQuadrant =
  | CadBridgeFirstLevelQuadrant
  | 'q1/q1' | 'q1/q2' | 'q1/q3' | 'q1/q4'
  | 'q2/q1' | 'q2/q2' | 'q2/q3' | 'q2/q4'
  | 'q3/q1' | 'q3/q2' | 'q3/q3' | 'q3/q4'
  | 'q4/q1' | 'q4/q2' | 'q4/q3' | 'q4/q4'

export interface CadBridgeExtractionRequest {
  document?: CadBridgeDocumentSelector
  window?: CadBridgeBBox
  layers?: readonly string[]
  types?: readonly string[]
  textPattern?: string
  includeGeometry?: boolean
  artifactRunId?: string
}

export interface CadBridgeExtractionResult {
  drawing: CadBridgeDrawing
  summary: {
    rawPath: string
    readablePath: string
    sourceEntityCount: number
    indexedEntityCount: number
    omittedGeometryCount: number
    failedEntityCount: number
    typeCounts: Record<string, number>
    layerCount: number
  }
  warnings: string[]
}

export interface CadBridgeFrame {
  frameId: string
  bbox: CadBridgeBBox
  source: 'polyline' | 'block' | 'layer' | 'extents'
  confidence: number
}

export interface CadBridgeFrameDetectionResult {
  drawing: CadBridgeDrawing
  frames: CadBridgeFrame[]
  /** Drawing extents, when AutoCAD reported them; the fallback window for a rejected frame. */
  extents: CadBridgeBBox | null
  warnings: string[]
}

export interface CadBridgePlotRequest {
  document?: CadBridgeDocumentSelector
  bbox?: CadBridgeBBox
  frameId?: string
  quadrant?: CadBridgeQuadrant
  artifactRunId?: string
}

export interface CadBridgeDetailRequest {
  document?: CadBridgeDocumentSelector
  handles?: readonly string[]
  window?: CadBridgeBBox
  paddingRatio?: number
  artifactRunId?: string
}

export interface CadBridgeVisualSetRequest extends Omit<CadBridgePlotRequest, 'quadrant'> {
  zoomQuadrants?: readonly CadBridgeFirstLevelQuadrant[]
}

export interface CadBridgeVisualSetResult {
  drawing: CadBridgeDrawing
  frameId: string
  bbox: CadBridgeBBox
  captures: CadBridgePlotResult[]
  warnings: string[]
}

export interface CadBridgeVisualZoomRequest
  extends Omit<CadBridgePlotRequest, 'bbox' | 'frameId' | 'quadrant'> {
  bbox: CadBridgeBBox
  frameId: string
  quadrants: readonly CadBridgeFirstLevelQuadrant[]
}

export interface CadBridgeVisualZoomResult {
  drawing: CadBridgeDrawing
  frameId: string
  bbox: CadBridgeBBox
  captures: CadBridgePlotResult[]
  warnings: string[]
}

export interface CadBridgeCaptureResult {
  drawing: CadBridgeDrawing
  bbox: CadBridgeBBox
  imagePath: string
  strategy: 'pdf' | 'png'
  width: number
  height: number
  pixelCount: number
  inkRatio: number
  cropBox: [number, number, number, number]
  warnings: string[]
}

export interface CadBridgePlotResult extends CadBridgeCaptureResult {
  frameId: string
  quadrant: CadBridgeQuadrant | null
}

export interface CadBridgeDetailResult extends CadBridgeCaptureResult {
  anchors: Array<{ handle: string; bbox: CadBridgeBBox }>
  missingHandles: string[]
}

const HANDLE_PATTERN = /^(?:0[xX])?[0-9A-Fa-f]{1,64}$/u
const ARTIFACT_RUN_ID_PATTERN = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const QUADRANT_PATTERN = /^q[1-4](?:\/q[1-4])?$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asDocument(value: unknown): CadBridgeDocument {
  if (!isRecord(value)) throw new Error('CAD bridge returned an invalid document.')
  const relativePath = value.project_relative_path
  if (
    !Number.isSafeInteger(value.index)
    || (value.index as number) < 0
    || typeof value.name !== 'string'
    || !value.name
    || value.name.length > 512
    || /[\\/]/u.test(value.name)
    || (relativePath !== null && (
      typeof relativePath !== 'string'
      || relativePath.length > 4096
      || path.posix.isAbsolute(relativePath)
      || path.win32.isAbsolute(relativePath)
      || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ))
    || typeof value.active !== 'boolean'
    || typeof value.saved !== 'boolean'
    || (value.dbmod !== null && !Number.isSafeInteger(value.dbmod))
  ) {
    throw new Error('CAD bridge returned an invalid document.')
  }
  return {
    index: value.index as number,
    name: value.name,
    project_relative_path: relativePath as string | null,
    active: value.active,
    saved: value.saved,
    dbmod: value.dbmod as number | null,
  }
}

function assertProjectRelativeDrawingPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//u, '')
  if (
    !normalized
    || normalized.length > 4096
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    || !normalized.toLowerCase().endsWith('.dwg')
  ) {
    throw new Error('CAD drawing path must be a project-relative DWG path.')
  }
  return normalized
}

function normalizeHandles(handles: readonly string[]): string[] {
  if (handles.length < 1 || handles.length > 100) {
    throw new Error('CAD entity read requires between 1 and 100 handles.')
  }
  const normalized = handles.map((handle) => {
    const value = handle.trim()
    if (!HANDLE_PATTERN.test(value)) throw new Error('CAD entity handle must be hexadecimal.')
    return value.replace(/^0x/iu, '').toUpperCase()
  })
  return [...new Set(normalized)]
}

function asStatus(value: Record<string, unknown>): CadBridgeApplicationStatus {
  if (
    typeof value.running !== 'boolean'
    || typeof value.supported !== 'boolean'
    || !Number.isSafeInteger(value.document_count)
    || !Array.isArray(value.documents)
  ) {
    throw new Error('CAD bridge returned an invalid application status.')
  }
  const documents = value.documents.map(asDocument)
  if (value.document_count !== documents.length) {
    throw new Error('CAD bridge returned an inconsistent application status.')
  }
  return {
    running: value.running,
    supported: value.supported,
    ...(typeof value.visible === 'boolean' ? { visible: value.visible } : {}),
    ...(typeof value.version === 'string' && value.version.length <= 128
      ? { version: value.version }
      : {}),
    document_count: documents.length,
    documents,
  }
}

function asRestartResult(value: Record<string, unknown>): CadBridgeRestartResult {
  const status = asStatus(value)
  const quitMode = value.quit_mode
  if (
    typeof value.restarted !== 'boolean'
    || typeof value.forced !== 'boolean'
    || (
      quitMode !== 'not_running'
      && quitMode !== 'graceful'
      && quitMode !== 'forced_pid'
      && quitMode !== 'forced_image'
    )
  ) {
    throw new Error('CAD bridge returned an invalid restart result.')
  }
  return {
    ...status,
    restarted: value.restarted,
    forced: value.forced,
    quitMode,
  }
}

function asDoctor(value: Record<string, unknown>): CadBridgeDoctorResult {
  if (!isRecord(value.application) || !isRecord(value.installation) || !isRecord(value.plot)) {
    throw new Error('CAD bridge returned invalid diagnostics.')
  }
  const installation = value.installation
  const dependencies = value.plot.dependencies
  const configurations = value.plot.configurations
  const warnings = value.plot.warnings
  if (
    typeof value.plot.ready !== 'boolean'
    || (installation.full_installed !== null && typeof installation.full_installed !== 'boolean')
    || (installation.lt_installed !== null && typeof installation.lt_installed !== 'boolean')
    || (installation.com_registered !== null && typeof installation.com_registered !== 'boolean')
    || !isRecord(dependencies)
    || typeof dependencies.pywin32 !== 'boolean'
    || typeof dependencies.pillow !== 'boolean'
    || typeof dependencies.pdfium !== 'boolean'
    || !isRecord(configurations)
    || (configurations.pdf !== null && typeof configurations.pdf !== 'boolean')
    || (configurations.png !== null && typeof configurations.png !== 'boolean')
    || !Array.isArray(warnings)
    || warnings.length > 100
    || warnings.some((item) => typeof item !== 'string' || item.length > 128)
  ) {
    throw new Error('CAD bridge returned invalid plot diagnostics.')
  }
  return {
    application: asStatus(value.application),
    installation: {
      fullInstalled: installation.full_installed as boolean | null,
      ltInstalled: installation.lt_installed as boolean | null,
      comRegistered: installation.com_registered as boolean | null,
    },
    plot: {
      ready: value.plot.ready,
      dependencies: {
        pywin32: dependencies.pywin32,
        pillow: dependencies.pillow,
        pdfium: dependencies.pdfium,
      },
      configurations: {
        pdf: configurations.pdf as boolean | null,
        png: configurations.png as boolean | null,
      },
      warnings: warnings as string[],
    },
  }
}

function normalizeDocumentSelector(
  selector: CadBridgeDocumentSelector | undefined,
): Record<string, string | number> {
  if (!selector) return {}
  if ('name' in selector) {
    const name = selector.name.trim()
    if (!name || name.length > 512 || /[\\/]/u.test(name)) {
      throw new Error('CAD document selector is invalid.')
    }
    return { name }
  }
  if (!Number.isSafeInteger(selector.index) || selector.index < 0) {
    throw new Error('CAD document selector is invalid.')
  }
  return { index: selector.index }
}

function normalizeProjectRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`CAD bridge returned an invalid ${label}.`)
  const normalized = value.replace(/\\/gu, '/')
  if (
    !normalized
    || normalized.length > 4_096
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`CAD bridge returned an invalid ${label}.`)
  }
  return normalized
}

function asDrawing(value: unknown): CadBridgeDrawing {
  if (!isRecord(value)) throw new Error('CAD bridge returned an invalid drawing.')
  const projectRelativePath = normalizeProjectRelativePath(
    value.project_relative_path,
    'drawing path',
  )
  if (
    typeof value.name !== 'string'
    || !value.name
    || value.name.length > 512
    || /[\\/]/u.test(value.name)
    || typeof value.saved !== 'boolean'
    || (value.dbmod !== null && !Number.isSafeInteger(value.dbmod))
  ) {
    throw new Error('CAD bridge returned an invalid drawing.')
  }
  return {
    name: value.name,
    project_relative_path: projectRelativePath,
    saved: value.saved,
    dbmod: value.dbmod as number | null,
  }
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`CAD bridge returned an invalid ${label}.`)
  }
  return value
}

function asBoundedInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`CAD bridge returned an invalid ${label}.`)
  }
  return value as number
}

function asBBox(value: unknown): CadBridgeBBox {
  if (!isRecord(value) || !Array.isArray(value.min) || !Array.isArray(value.max)) {
    throw new Error('CAD bridge returned an invalid bounding box.')
  }
  if (value.min.length !== 2 || value.max.length !== 2) {
    throw new Error('CAD bridge returned an invalid bounding box.')
  }
  const minX = asFiniteNumber(value.min[0], 'bounding box')
  const minY = asFiniteNumber(value.min[1], 'bounding box')
  const maxX = asFiniteNumber(value.max[0], 'bounding box')
  const maxY = asFiniteNumber(value.max[1], 'bounding box')
  if (maxX <= minX || maxY <= minY) {
    throw new Error('CAD bridge returned an invalid bounding box.')
  }
  return { min: [minX, minY], max: [maxX, maxY] }
}

function normalizeBBox(value: CadBridgeBBox | undefined): CadBridgeBBox | undefined {
  if (!value) return undefined
  return asBBox(value)
}

function normalizePatterns(value: readonly string[] | undefined, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (
    value.length > 100
    || value.some((item) => typeof item !== 'string' || !item || item.length > 512)
  ) {
    throw new Error(`${label} must contain at most 100 bounded non-empty patterns.`)
  }
  return [...value]
}

function normalizeArtifactRunId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!ARTIFACT_RUN_ID_PATTERN.test(value)) {
    throw new Error('CAD artifact run id is invalid.')
  }
  return value
}

function asArtifactPath(value: unknown, extension: '.jsonl' | '.md' | '.png'): string {
  const normalized = normalizeProjectRelativePath(value, 'artifact path')
  if (!normalized.startsWith('.xiaoliang/cad/') || !normalized.toLowerCase().endsWith(extension)) {
    throw new Error('CAD bridge returned an invalid artifact path.')
  }
  return normalized
}

function asWarnings(value: readonly string[]): string[] {
  if (value.length > 100 || value.some((item) => typeof item !== 'string' || item.length > 2_000)) {
    throw new Error('CAD bridge returned invalid warnings.')
  }
  return [...value]
}

function longOperationOptions(options: CadHttpBridgeCallOptions | undefined): CadHttpBridgeCallOptions {
  return {
    ...options,
    timeoutMs: options?.timeoutMs ?? LONG_CAD_HTTP_TIMEOUT_MS,
    deadlines: {
      queue_ms: 60_000,
      response_ms: LONG_CAD_OPERATION_TIMEOUT_MS,
      ...options?.deadlines,
    },
  }
}

function asCaptureMetrics(value: Record<string, unknown>): Omit<
  CadBridgeCaptureResult,
  'drawing' | 'bbox' | 'imagePath' | 'warnings'
> {
  if (value.strategy !== 'pdf' && value.strategy !== 'png') {
    throw new Error('CAD bridge returned an invalid capture strategy.')
  }
  const width = asBoundedInteger(value.width, 'capture width', 4_096)
  const height = asBoundedInteger(value.height, 'capture height', 4_096)
  const pixelCount = asBoundedInteger(value.pixel_count, 'capture pixel count', 4_096 * 4_096)
  const inkRatio = asFiniteNumber(value.ink_ratio, 'capture ink ratio')
  if (width < 1 || height < 1 || pixelCount !== width * height || inkRatio < 0 || inkRatio > 1) {
    throw new Error('CAD bridge returned invalid capture metrics.')
  }
  if (
    !Array.isArray(value.crop_box)
    || value.crop_box.length !== 4
    || value.crop_box.some((item) => !Number.isSafeInteger(item) || item < 0)
  ) {
    throw new Error('CAD bridge returned an invalid crop box.')
  }
  return {
    strategy: value.strategy,
    width,
    height,
    pixelCount,
    inkRatio,
    cropBox: value.crop_box as [number, number, number, number],
  }
}

export class CadApplicationFacade {
  constructor(private readonly executor: CadHttpBridgeExecutor) {}

  async status(signal?: AbortSignal): Promise<CadBridgeApplicationStatus> {
    const result = await this.executor.execute('app.status', {}, signal)
    return asStatus(result.data)
  }

  async doctor(signal?: AbortSignal): Promise<CadBridgeDoctorResult> {
    const result = await this.executor.execute('app.doctor', {}, signal)
    return asDoctor(result.data)
  }

  async start(signal?: AbortSignal): Promise<CadBridgeApplicationStatus> {
    const result = await this.executor.execute('app.start', {}, signal)
    return asStatus(result.data)
  }

  async restart(
    options: { force?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<CadBridgeRestartResult> {
    if (options.force !== undefined && typeof options.force !== 'boolean') {
      throw new Error('CAD restart force must be a boolean.')
    }
    const result = await this.executor.execute(
      'app.restart',
      options.force === undefined ? {} : { force: options.force },
      signal,
    )
    return asRestartResult(result.data)
  }

  async listDocuments(signal?: AbortSignal): Promise<CadBridgeDocument[]> {
    const result = await this.executor.execute('doc.list', {}, signal)
    if (!Array.isArray(result.data.documents)) {
      throw new Error('CAD bridge returned an invalid document list.')
    }
    return result.data.documents.map(asDocument)
  }

  async openDocument(
    drawingRelativePath: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const result = await this.executor.execute(
      'doc.open',
      { path: assertProjectRelativeDrawingPath(drawingRelativePath) },
      signal,
    )
    return result.data
  }

  async switchDocument(
    selector: { name: string } | { index: number },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (
      ('name' in selector && (!selector.name.trim() || selector.name.length > 512))
      || ('index' in selector && (!Number.isSafeInteger(selector.index) || selector.index < 0))
    ) {
      throw new Error('CAD document selector is invalid.')
    }
    const result = await this.executor.execute('doc.switch', selector, signal)
    return result.data
  }

  async readEntities(
    handles: readonly string[],
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadBridgeEntityReadResult> {
    const result = await this.executor.execute(
      'extract.read',
      { handles: normalizeHandles(handles) },
      signal,
      options,
    )
    if (
      !isRecord(result.data.document)
      || !Array.isArray(result.data.entities)
      || !Array.isArray(result.data.errors)
      || result.data.entities.length > 100
      || result.data.errors.length > 100
      || result.data.entities.some((item) => !isRecord(item))
      || result.data.errors.some((item) => (
        !isRecord(item)
        || typeof item.handle !== 'string'
        || !HANDLE_PATTERN.test(item.handle)
        || typeof item.code !== 'string'
        || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(item.code)
      ))
    ) {
      throw new Error('CAD bridge returned an invalid entity read result.')
    }
    return {
      document: asDocument(result.data.document),
      entities: result.data.entities as Array<Record<string, unknown>>,
      errors: result.data.errors as Array<{ handle: string; code: string }>,
    }
  }

  async readEntitiesInDocument(
    document: CadBridgeDocumentSelector,
    handles: readonly string[],
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadBridgeEntityReadResult> {
    const result = await this.executor.execute(
      'extract.read',
      {
        document: normalizeDocumentSelector(document),
        handles: normalizeHandles(handles),
      },
      signal,
      options,
    )
    if (
      !isRecord(result.data.document)
      || !Array.isArray(result.data.entities)
      || !Array.isArray(result.data.errors)
      || result.data.entities.length > 100
      || result.data.errors.length > 100
      || result.data.entities.some((item) => !isRecord(item))
      || result.data.errors.some((item) => (
        !isRecord(item)
        || typeof item.handle !== 'string'
        || !HANDLE_PATTERN.test(item.handle)
        || item.code !== 'ENTITY_READ_FAILED'
      ))
    ) {
      throw new Error('CAD bridge returned an invalid entity read result.')
    }
    return {
      document: asDocument(result.data.document),
      entities: result.data.entities as Array<Record<string, unknown>>,
      errors: result.data.errors as Array<{ handle: string; code: string }>,
    }
  }

  async runExtraction(
    request: CadBridgeExtractionRequest = {},
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadBridgeExtractionResult> {
    if (request.textPattern !== undefined && request.textPattern.length > 2_048) {
      throw new Error('CAD extraction text pattern is too long.')
    }
    const result = await this.executor.execute(
      'extract.run',
      {
        document: normalizeDocumentSelector(request.document),
        ...(request.window ? { window: normalizeBBox(request.window) } : {}),
        ...(request.layers ? { layers: normalizePatterns(request.layers, 'CAD layer filters') } : {}),
        ...(request.types ? { types: normalizePatterns(request.types, 'CAD type filters') } : {}),
        ...(request.textPattern !== undefined ? { text_pattern: request.textPattern } : {}),
        ...(request.includeGeometry !== undefined ? { include_geometry: request.includeGeometry } : {}),
        ...(request.artifactRunId !== undefined
          ? { artifact_run_id: normalizeArtifactRunId(request.artifactRunId) }
          : {}),
      },
      signal,
      longOperationOptions(options),
    )
    const summary = result.data.summary
    if (!isRecord(summary) || !isRecord(summary.type_counts)) {
      throw new Error('CAD bridge returned an invalid extraction summary.')
    }
    const typeCounts: Record<string, number> = {}
    for (const [key, value] of Object.entries(summary.type_counts)) {
      if (!key || key.length > 256) throw new Error('CAD bridge returned invalid type counts.')
      typeCounts[key] = asBoundedInteger(value, 'entity type count')
    }
    return {
      drawing: asDrawing(result.data.drawing),
      summary: {
        rawPath: asArtifactPath(summary.raw_path, '.jsonl'),
        readablePath: asArtifactPath(summary.readable_path, '.md'),
        sourceEntityCount: asBoundedInteger(summary.source_entity_count, 'source entity count'),
        indexedEntityCount: asBoundedInteger(summary.indexed_entity_count, 'indexed entity count'),
        omittedGeometryCount: asBoundedInteger(summary.omitted_geometry_count, 'omitted geometry count'),
        failedEntityCount: asBoundedInteger(summary.failed_entity_count, 'failed entity count'),
        typeCounts,
        layerCount: asBoundedInteger(summary.layer_count, 'layer count'),
      },
      warnings: asWarnings(result.warnings),
    }
  }

  async detectFrames(
    document?: CadBridgeDocumentSelector,
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadBridgeFrameDetectionResult> {
    const result = await this.executor.execute(
      'capture.detect_frames',
      { document: normalizeDocumentSelector(document) },
      signal,
      longOperationOptions(options),
    )
    if (!Array.isArray(result.data.frames) || result.data.frames.length > 10_000) {
      throw new Error('CAD bridge returned an invalid frame list.')
    }
    const frames = result.data.frames.map((item): CadBridgeFrame => {
      if (
        !isRecord(item)
        || typeof item.frame_id !== 'string'
        || !/^frame-[0-9]{2}$/u.test(item.frame_id)
        || !['polyline', 'block', 'layer', 'extents'].includes(String(item.source))
      ) {
        throw new Error('CAD bridge returned an invalid frame.')
      }
      const confidence = asFiniteNumber(item.confidence, 'frame confidence')
      if (confidence < 0 || confidence > 1) {
        throw new Error('CAD bridge returned an invalid frame confidence.')
      }
      return {
        frameId: item.frame_id,
        bbox: asBBox(item.bbox),
        source: item.source as CadBridgeFrame['source'],
        confidence,
      }
    })
    return {
      drawing: asDrawing(result.data.drawing),
      frames,
      extents: result.data.extents === undefined || result.data.extents === null
        ? null
        : asBBox(result.data.extents),
      warnings: asWarnings(result.warnings),
    }
  }

  async plotCapture(
    request: CadBridgePlotRequest = {},
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadBridgePlotResult> {
    if (request.frameId !== undefined && !/^frame-(?:[0-9]{2}|custom)$/u.test(request.frameId)) {
      throw new Error('CAD frame id is invalid.')
    }
    if (request.quadrant !== undefined && !QUADRANT_PATTERN.test(request.quadrant)) {
      throw new Error('CAD quadrant is invalid.')
    }
    const result = await this.executor.execute(
      'capture.plot',
      {
        document: normalizeDocumentSelector(request.document),
        ...(request.bbox ? { bbox: normalizeBBox(request.bbox) } : {}),
        ...(request.frameId ? { frame_id: request.frameId } : {}),
        ...(request.quadrant ? { quadrant: request.quadrant } : {}),
        ...(request.artifactRunId !== undefined
          ? { artifact_run_id: normalizeArtifactRunId(request.artifactRunId) }
          : {}),
      },
      signal,
      longOperationOptions(options),
    )
    if (
      typeof result.data.frame_id !== 'string'
      || !/^frame-(?:[0-9]{2}|custom)$/u.test(result.data.frame_id)
      || (result.data.quadrant !== null && (
        typeof result.data.quadrant !== 'string'
        || !QUADRANT_PATTERN.test(result.data.quadrant)
      ))
    ) {
      throw new Error('CAD bridge returned an invalid plot identity.')
    }
    return {
      drawing: asDrawing(result.data.drawing),
      frameId: result.data.frame_id,
      quadrant: result.data.quadrant as CadBridgeQuadrant | null,
      bbox: asBBox(result.data.bbox),
      imagePath: asArtifactPath(result.data.image_path, '.png'),
      ...asCaptureMetrics(result.data),
      warnings: asWarnings(result.warnings),
    }
  }

  async captureVisualSet(
    request: CadBridgeVisualSetRequest = {},
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadBridgeVisualSetResult> {
    const zoomQuadrants = [...new Set(request.zoomQuadrants ?? [])]
    if (
      zoomQuadrants.length > 4
      || zoomQuadrants.some((quadrant) => !/^q[1-4]$/u.test(quadrant))
    ) {
      throw new Error('CAD visual set zoom quadrants are invalid.')
    }
    const base = await this.plotCapture(request, signal, options)
    const captures = [base]
    const firstLevel: CadBridgeFirstLevelQuadrant[] = ['q1', 'q2', 'q3', 'q4']
    for (const quadrant of firstLevel) {
      captures.push(await this.plotCapture(
        {
          ...request,
          bbox: base.bbox,
          frameId: base.frameId,
          quadrant,
        },
        signal,
        options,
      ))
    }
    if (zoomQuadrants.length) {
      const zooms = await this.captureVisualZooms(
        {
          document: request.document,
          bbox: base.bbox,
          frameId: base.frameId,
          quadrants: zoomQuadrants,
          artifactRunId: request.artifactRunId,
        },
        signal,
        options,
      )
      captures.push(...zooms.captures)
    }
    for (const capture of captures) {
      if (
        capture.frameId !== base.frameId
        || capture.drawing.project_relative_path !== base.drawing.project_relative_path
      ) {
        throw new Error('CAD visual set changed drawing or frame while capturing.')
      }
    }
    return {
      drawing: base.drawing,
      frameId: base.frameId,
      bbox: base.bbox,
      captures,
      warnings: [...new Set(captures.flatMap((capture) => capture.warnings))].slice(0, 100),
    }
  }

  async captureVisualZooms(
    request: CadBridgeVisualZoomRequest,
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadBridgeVisualZoomResult> {
    const parents = [...new Set(request.quadrants)]
    if (
      parents.length < 1
      || parents.length > 4
      || parents.some((quadrant) => !/^q[1-4]$/u.test(quadrant))
    ) {
      throw new Error('CAD visual zoom quadrants are invalid.')
    }
    const captures: CadBridgePlotResult[] = []
    const children: CadBridgeFirstLevelQuadrant[] = ['q1', 'q2', 'q3', 'q4']
    for (const parent of parents) {
      for (const child of children) {
        captures.push(await this.plotCapture(
          {
            document: request.document,
            bbox: request.bbox,
            frameId: request.frameId,
            quadrant: `${parent}/${child}`,
            artifactRunId: request.artifactRunId,
          },
          signal,
          options,
        ))
      }
    }
    const [first] = captures
    if (!first) throw new Error('CAD visual zoom set is empty.')
    for (const capture of captures) {
      if (
        capture.frameId !== request.frameId
        || capture.drawing.project_relative_path !== first.drawing.project_relative_path
      ) {
        throw new Error('CAD visual zoom set changed drawing or frame while capturing.')
      }
    }
    return {
      drawing: first.drawing,
      frameId: first.frameId,
      bbox: request.bbox,
      captures,
      warnings: [...new Set(captures.flatMap((capture) => capture.warnings))].slice(0, 100),
    }
  }

  async captureDetail(
    request: CadBridgeDetailRequest,
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadBridgeDetailResult> {
    if (!request.handles?.length && !request.window) {
      throw new Error('CAD detail capture requires handles or a window.')
    }
    if (
      request.paddingRatio !== undefined
      && (!Number.isFinite(request.paddingRatio) || request.paddingRatio < 0 || request.paddingRatio > 0.5)
    ) {
      throw new Error('CAD detail padding ratio is invalid.')
    }
    const handles = request.handles ? normalizeHandles(request.handles) : undefined
    if (handles && handles.length > 8) {
      throw new Error('CAD detail capture accepts at most 8 handles.')
    }
    const result = await this.executor.execute(
      'capture.detail',
      {
        document: normalizeDocumentSelector(request.document),
        ...(handles ? { handles } : {}),
        ...(request.window ? { window: normalizeBBox(request.window) } : {}),
        ...(request.paddingRatio !== undefined ? { padding_ratio: request.paddingRatio } : {}),
        ...(request.artifactRunId !== undefined
          ? { artifact_run_id: normalizeArtifactRunId(request.artifactRunId) }
          : {}),
      },
      signal,
      longOperationOptions(options),
    )
    if (
      !Array.isArray(result.data.anchors)
      || result.data.anchors.length > 8
      || !Array.isArray(result.data.missing_handles)
      || result.data.missing_handles.length > 8
    ) {
      throw new Error('CAD bridge returned invalid detail anchors.')
    }
    const anchors = result.data.anchors.map((item) => {
      if (!isRecord(item) || typeof item.handle !== 'string' || !HANDLE_PATTERN.test(item.handle)) {
        throw new Error('CAD bridge returned an invalid detail anchor.')
      }
      return { handle: item.handle.toUpperCase(), bbox: asBBox(item.bbox) }
    })
    const missingHandles = result.data.missing_handles.map((item) => {
      if (typeof item !== 'string' || !HANDLE_PATTERN.test(item)) {
        throw new Error('CAD bridge returned an invalid missing handle.')
      }
      return item.toUpperCase()
    })
    return {
      drawing: asDrawing(result.data.drawing),
      bbox: asBBox(result.data.window),
      anchors,
      missingHandles,
      imagePath: asArtifactPath(result.data.image_path, '.png'),
      ...asCaptureMetrics(result.data),
      warnings: asWarnings(result.warnings),
    }
  }
}
