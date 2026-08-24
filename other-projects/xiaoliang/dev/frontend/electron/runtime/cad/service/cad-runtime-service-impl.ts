import type { ScreenshotManager } from '../../../shell/screenshot-manager'
import { createHash } from 'node:crypto'
import type {
  CadAnnotationReadResult,
  CadCaptureHint,
  CadCaptureImageVariant,
  CadCaptureAttempt,
  CadCaptureMethod,
  CadCaptureResult,
  CadScreenBounds,
  CadBlockSummary,
  CadConnectionStatus,
  CadCompositeBatchReadResult,
  CadCompositeRegionExtractResult,
  CadCompositeScreenshotResult,
  CadCurrentViewState,
  CadDocumentListItem,
  CadDocumentSnapshot,
  CadDrawingScanLayerSummary,
  CadDrawingScanResult,
  CadEntityCollectionSnapshot,
  CadEntityRef,
  CadEntitySnapshot,
  CadGeometryAreaResult,
  CadGeometryBoundingBoxResult,
  CadGeometryDistanceResult,
  CadGeometryLengthResult,
  CadLayerSummary,
  CadLayoutSummary,
  CadPoint,
  CadSelectionSnapshot,
  CadSpatialQueryResult,
  CadTextMatchSnapshot,
  CadTextPlusMatchSnapshot,
  CadTextPlusSearchResult,
  CadTextSearchResult,
  CadTextReadResult,
  CadVariableSnapshot,
  CadViewState,
  CadWindow,
  CadScreenshotMetrics,
  CadPlotFitMode,
  CadPlotProfile,
  CadPlotVariant,
} from '../contracts/cad-dto'
import type { CadRuntimeService } from '../contracts/cad-runtime-service'
import type { CadRpcProgress } from '../contracts/cad-protocol'
import { createNotImplementedCadMethodError } from '../errors/cad-error-codes'
import { CadSessionStore } from '../session/cad-session-store'
import { CadCaptureService } from './cad-capture'
import { AutoCadComWorkerHost } from '../drivers/autocad-com/worker-host'

type WorkerPayload = Record<string, unknown>

// 墨迹/边缘像素占比阈值：低于此值视为"空白绘图区/无图纸内容"。
// 取保守值，避免误杀仅含少量尺寸线/文字的稀疏区域。
const CAD_CAPTURE_MIN_INK_RATIO = 0.0015

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return undefined
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toPoint(value: unknown): CadPoint | undefined {
  if (Array.isArray(value)) {
    const x = toNumber(value[0])
    const y = toNumber(value[1])
    const z = toNumber(value[2])
    if (x === undefined || y === undefined) return undefined
    return z === undefined ? { x, y } : { x, y, z }
  }
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const x = toNumber(raw.x)
  const y = toNumber(raw.y)
  const z = toNumber(raw.z)
  if (x === undefined || y === undefined) return undefined
  return z === undefined ? { x, y } : { x, y, z }
}

function toWindow(value: unknown): CadWindow | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const min = toPoint(raw.min)
  const max = toPoint(raw.max)
  if (!min || !max) return undefined
  return { min, max }
}

function summarizeEntityRef(entity: CadEntityRef) {
  return [entity.objectName, entity.layer ? `@${entity.layer}` : '', entity.handle]
    .filter(Boolean)
    .join(' ')
}

function toObjectName(value: unknown) {
  const key = (toStringValue(value) ?? '').toLowerCase()
  const mapping: Record<string, string> = {
    line: 'AcDbLine',
    circle: 'AcDbCircle',
    arc: 'AcDbArc',
    ellipse: 'AcDbEllipse',
    spline: 'AcDbSpline',
    polyline: 'AcDbPolyline',
    lwpolyline: 'AcDbPolyline',
    '2d_polyline': 'AcDb2dPolyline',
    '3d_polyline': 'AcDb3dPolyline',
    text: 'AcDbText',
    mtext: 'AcDbMText',
    dimension: 'AcDbDimension',
    block_reference: 'AcDbBlockReference',
    hatch: 'AcDbHatch',
    table: 'AcDbTable',
    leader: 'AcDbLeader',
    mleader: 'AcDbMLeader',
  }
  return mapping[key]
}

function toEntitySnapshot(item: Record<string, unknown>, objectNameHint?: string): CadEntitySnapshot | null {
  const rawHandle = toStringValue(item.handle)
  if (!rawHandle) return null
  const handle = rawHandle.toLowerCase().startsWith('0x') ? rawHandle.slice(2) : rawHandle

  const objectName =
    toStringValue(item.object_name) ??
    toStringValue(item.objectName) ??
    toObjectName(item.type) ??
    objectNameHint ??
    'AcDbEntity'
  const layer = toStringValue(item.layer)
  return {
    handle,
    objectName,
    layer,
    summary: [objectName, layer ? `@${layer}` : '', handle].filter(Boolean).join(' '),
    data: { ...item },
  }
}

function flattenEntities(payload: WorkerPayload) {
  const directEntities = Array.isArray(payload.entities)
    ? payload.entities.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const snapshot = toEntitySnapshot(item as Record<string, unknown>)
        return snapshot ? [snapshot] : []
      })
    : []
  if (directEntities.length > 0) {
    return directEntities
  }

  const groups: Array<[string, string]> = [
    ['AcDbText', 'text_entities'],
    ['AcDbBlockReference', 'blocks'],
    ['AcDbPolyline', 'polylines'],
    ['AcDbDimension', 'dimensions'],
    ['AcDbHatch', 'hatches'],
    ['AcDbTable', 'tables'],
    ['AcDbLine', 'lines'],
    ['AcDbCircle', 'circles'],
    ['AcDbArc', 'arcs'],
  ]

  return groups.flatMap(([objectName, key]) => {
    const items = Array.isArray(payload[key]) ? payload[key] : []
    return items.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const snapshot = toEntitySnapshot(item as Record<string, unknown>, objectName)
      return snapshot ? [snapshot] : []
    })
  })
}

function toSelectionSnapshot(payload: WorkerPayload): CadSelectionSnapshot {
  const entities = flattenEntities(payload)
  return {
    docName: toStringValue(payload.doc_name),
    count: entities.length,
    handles: entities.map((entity) => entity.handle),
    entities: entities.map(({ handle, objectName, layer, summary }) => ({
      handle,
      objectName,
      layer,
      summary,
    })),
    summary:
      payload.summary && typeof payload.summary === 'object'
        ? (payload.summary as Record<string, unknown>)
        : undefined,
  }
}

function toEntityCollectionSnapshot(payload: WorkerPayload): CadEntityCollectionSnapshot {
  const entities = flattenEntities(payload)
  const rawSummary =
    payload.summary && typeof payload.summary === 'object'
      ? (payload.summary as Record<string, unknown>)
      : null
  const summary: Record<string, unknown> = rawSummary ? { ...rawSummary } : {}
  if (summary.total === undefined) {
    summary.total = entities.length
  }

  const extractedTexts = entities.flatMap((entity) => {
    const raw = entity.data
    const content = toStringValue(raw.content_clean) ?? toStringValue(raw.content)
    return content ? [content] : []
  })

  return {
    docName: toStringValue(payload.doc_name),
    entities,
    summary,
    texts: Array.isArray(payload.texts)
      ? payload.texts.filter((item): item is string => typeof item === 'string')
      : extractedTexts,
    window: toWindow(payload.window),
  }
}

function toSpatialQueryResult(payload: WorkerPayload): CadSpatialQueryResult {
  const entities = flattenEntities(payload)
  return {
    count: toNumber(payload.count) ?? entities.length,
    entities,
  }
}

function toAnnotationReadResult(payload: WorkerPayload): CadAnnotationReadResult {
  const items = flattenEntities(payload)
  return {
    docName: toStringValue(payload.doc_name),
    items,
    count: toNumber(payload.count) ?? items.length,
  }
}

function toTextSearchResult(
  payload: WorkerPayload,
  input: { pattern: string; regex: boolean },
): CadTextSearchResult {
  const matches = Array.isArray(payload.matches)
    ? payload.matches.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const raw = item as Record<string, unknown>
        const content = toStringValue(raw.content_clean) ?? toStringValue(raw.content)
        if (!content) return []

        const rawEntity = raw.entity
        const entity =
          rawEntity && typeof rawEntity === 'object'
            ? toEntitySnapshot(rawEntity as Record<string, unknown>)
            : undefined

        const match: CadTextMatchSnapshot = {
          handle: toStringValue(raw.handle),
          layer: toStringValue(raw.layer),
          content,
          entity: entity ?? undefined,
        }
        return [match]
      })
    : []

  return {
    docName: toStringValue(payload.doc_name),
    pattern: input.pattern,
    regex: input.regex,
    matches,
    count: toNumber(payload.count) ?? matches.length,
  }
}

function toGeometryDistanceResult(payload: WorkerPayload): CadGeometryDistanceResult {
  return {
    distance: toNumber(payload.distance) ?? 0,
  }
}

function toGeometryAreaResult(handle: string, payload: WorkerPayload): CadGeometryAreaResult {
  return {
    handle,
    area: toNumber(payload.area) ?? 0,
  }
}

function toGeometryLengthResult(handle: string, payload: WorkerPayload): CadGeometryLengthResult {
  return {
    handle,
    length: toNumber(payload.length) ?? 0,
  }
}

function toGeometryBoundingBoxResult(
  handles: string[],
  payload: WorkerPayload,
): CadGeometryBoundingBoxResult {
  return {
    handles,
    min: toPoint(payload.min) ?? { x: 0, y: 0 },
    max: toPoint(payload.max) ?? { x: 0, y: 0 },
  }
}

function toCompositeScreenshotResult(value: unknown): CadCompositeScreenshotResult | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const screenshot: CadCompositeScreenshotResult = {
    imageBase64: toStringValue(raw.image_base64) ?? toStringValue(raw.imageBase64),
    mimeType: toStringValue(raw.mime_type) ?? toStringValue(raw.mimeType),
    width: toNumber(raw.width),
    height: toNumber(raw.height),
  }
  return screenshot.imageBase64 || screenshot.mimeType || screenshot.width || screenshot.height
    ? screenshot
    : undefined
}

function toScreenshotMetrics(value: unknown, imageBase64?: string): CadScreenshotMetrics | undefined {
  const raw = value && typeof value === 'object' ? (value as WorkerPayload) : {}
  const metrics: CadScreenshotMetrics = {
    width: toNumber(raw.width),
    height: toNumber(raw.height),
    sourceWidth: toNumber(raw.source_width) ?? toNumber(raw.sourceWidth),
    sourceHeight: toNumber(raw.source_height) ?? toNumber(raw.sourceHeight),
    rasterWidth: toNumber(raw.raster_width) ?? toNumber(raw.rasterWidth),
    rasterHeight: toNumber(raw.raster_height) ?? toNumber(raw.rasterHeight),
    cropWidth: toNumber(raw.crop_width) ?? toNumber(raw.cropWidth),
    cropHeight: toNumber(raw.crop_height) ?? toNumber(raw.cropHeight),
    outputContentWidth: toNumber(raw.output_content_width) ?? toNumber(raw.outputContentWidth),
    outputContentHeight: toNumber(raw.output_content_height) ?? toNumber(raw.outputContentHeight),
    paddingLeft: toNumber(raw.padding_left) ?? toNumber(raw.paddingLeft),
    paddingTop: toNumber(raw.padding_top) ?? toNumber(raw.paddingTop),
    paddingRight: toNumber(raw.padding_right) ?? toNumber(raw.paddingRight),
    paddingBottom: toNumber(raw.padding_bottom) ?? toNumber(raw.paddingBottom),
    fitScale: toNumber(raw.fit_scale) ?? toNumber(raw.fitScale),
    contentAreaRatio: toNumber(raw.content_area_ratio) ?? toNumber(raw.contentAreaRatio),
    cropAreaRatio: toNumber(raw.crop_area_ratio) ?? toNumber(raw.cropAreaRatio),
    meanBrightness: toNumber(raw.mean_brightness) ?? toNumber(raw.meanBrightness),
    brightnessVariance: toNumber(raw.brightness_variance) ?? toNumber(raw.brightnessVariance),
    blackRatio: toNumber(raw.black_ratio) ?? toNumber(raw.blackRatio),
    whiteRatio: toNumber(raw.white_ratio) ?? toNumber(raw.whiteRatio),
    nearWhiteRatio: toNumber(raw.near_white_ratio) ?? toNumber(raw.nearWhiteRatio),
    nearBlackRatio: toNumber(raw.near_black_ratio) ?? toNumber(raw.nearBlackRatio),
    inkRatio: toNumber(raw.ink_ratio) ?? toNumber(raw.inkRatio),
    byteLength: toNumber(raw.byte_length) ?? toNumber(raw.byteLength),
    pdfDpi: toNumber(raw.pdf_dpi) ?? toNumber(raw.pdfDpi),
    pdfBytes: toNumber(raw.pdf_bytes) ?? toNumber(raw.pdfBytes),
    plotAttemptCount: toNumber(raw.plot_attempt_count) ?? toNumber(raw.plotAttemptCount),
    plotValidAttemptCount: toNumber(raw.plot_valid_attempt_count) ?? toNumber(raw.plotValidAttemptCount),
    plotStrategy: toStringValue(raw.plot_strategy) ?? toStringValue(raw.plotStrategy),
    fitMode: toStringValue(raw.fit_mode) ?? toStringValue(raw.fitMode),
    traceDir: toStringValue(raw.trace_dir) ?? toStringValue(raw.traceDir),
    tracePdfPath: toStringValue(raw.trace_pdf_path) ?? toStringValue(raw.tracePdfPath),
    pdfPath: toStringValue(raw.pdf_path) ?? toStringValue(raw.pdfPath),
    plotPdfExtensionSuppressed: toBoolean(raw.plot_pdf_extension_suppressed) ?? toBoolean(raw.plotPdfExtensionSuppressed),
  }
  if (metrics.byteLength === undefined && imageBase64) {
    metrics.byteLength = Buffer.byteLength(imageBase64, 'base64')
  }
  return Object.values(metrics).some((item) => item !== undefined) ? metrics : undefined
}

function toScreenBounds(value: unknown): CadScreenBounds | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as WorkerPayload
  const x = toNumber(raw.x) ?? toNumber(raw.left)
  const y = toNumber(raw.y) ?? toNumber(raw.top)
  const width = toNumber(raw.width)
    ?? (toNumber(raw.right) !== undefined && x !== undefined ? toNumber(raw.right)! - x : undefined)
  const height = toNumber(raw.height)
    ?? (toNumber(raw.bottom) !== undefined && y !== undefined ? toNumber(raw.bottom)! - y : undefined)
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined
  }
  if (width <= 0 || height <= 0) {
    return undefined
  }
  return { x, y, width, height }
}

function getCadCaptureQualityWarning(capture: Pick<CadCaptureResult, 'success' | 'error' | 'warning' | 'thumbnailDataUrl' | 'screenshotMetrics'>) {
  if (!capture.success) {
    return `截图失败：${capture.error || capture.warning || '未知错误'}`
  }
  if (!capture.thumbnailDataUrl) {
    return '截图缺少图像数据。'
  }
  const metrics = capture.screenshotMetrics
  if (metrics?.byteLength !== undefined && metrics.byteLength < 2_500) {
    return `截图数据过小：${metrics.byteLength} bytes`
  }
  if (
    metrics?.nearBlackRatio !== undefined &&
    metrics.nearBlackRatio > 0.985 &&
    (metrics.brightnessVariance ?? 0) < 8
  ) {
    return '截图接近全黑。'
  }
  if (
    metrics?.nearWhiteRatio !== undefined &&
    metrics.nearWhiteRatio > 0.995 &&
    (metrics.brightnessVariance ?? 0) < 6
  ) {
    return '截图接近空白。'
  }
  if (
    metrics?.brightnessVariance !== undefined &&
    metrics.brightnessVariance < 1.2 &&
    ((metrics.nearWhiteRatio ?? 0) > 0.92 || (metrics.nearBlackRatio ?? 0) > 0.92)
  ) {
    return '截图亮度方差过低。'
  }
  if (metrics?.inkRatio !== undefined && metrics.inkRatio < CAD_CAPTURE_MIN_INK_RATIO) {
    return '截图绘图区无图纸内容（线条/文字密度过低），疑似空白视口。'
  }
  if (metrics?.contentAreaRatio !== undefined && metrics.contentAreaRatio <= 0) {
    return '出图 PDF 没有检测到有效图纸内容。'
  }
  if (
    metrics?.outputContentWidth !== undefined &&
    metrics?.outputContentHeight !== undefined &&
    (metrics.outputContentWidth < 360 || metrics.outputContentHeight < 260)
  ) {
    return `出图有效内容像素过低：${metrics.outputContentWidth}x${metrics.outputContentHeight}`
  }
  return null
}

function toTextPlusSearchResult(
  payload: WorkerPayload,
  input: { pattern: string; regex: boolean; caseSensitive: boolean; normalized: boolean },
): CadTextPlusSearchResult {
  const matches: CadTextPlusMatchSnapshot[] = Array.isArray(payload.matches)
    ? payload.matches.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const raw = item as Record<string, unknown>
        const content = toStringValue(raw.content_clean) ?? toStringValue(raw.content)
        if (!content) return []

        const rawEntity = raw.entity
        const entity =
          rawEntity && typeof rawEntity === 'object'
            ? toEntitySnapshot(rawEntity as Record<string, unknown>)
            : undefined

        return [{
          handle: toStringValue(raw.handle),
          layer: toStringValue(raw.layer),
          objectName: toStringValue(raw.object_name) ?? toStringValue(raw.objectName),
          source: toStringValue(raw.source),
          subPath: toStringValue(raw.sub_path) ?? toStringValue(raw.subPath),
          label: toStringValue(raw.label),
          content,
          bbox: toWindow(raw.bbox),
          point: toPoint(raw.point),
          score: toNumber(raw.score),
          entity: entity ?? undefined,
        }]
      })
    : []

  const sourceCounts: Record<string, number> = {}
  if (payload.source_counts && typeof payload.source_counts === 'object') {
    for (const [key, value] of Object.entries(payload.source_counts as Record<string, unknown>)) {
      const count = toNumber(value)
      if (count !== undefined) {
        sourceCounts[key] = count
      }
    }
  }

  return {
    docName: toStringValue(payload.doc_name),
    pattern: input.pattern,
    regex: input.regex,
    caseSensitive: input.caseSensitive,
    normalized: input.normalized,
    scanned: toNumber(payload.scanned),
    sourceCounts,
    matches,
    count: toNumber(payload.count) ?? matches.length,
  }
}

function toCaptureAttempt(
  method: NonNullable<CadCaptureResult['captureMethod']>,
  capture: CadCaptureResult | null,
  qualityWarning?: string | null,
): CadCaptureAttempt {
  return {
    method,
    success: Boolean(capture?.success),
    valid: Boolean(capture?.success && !qualityWarning),
    sourceName: capture?.sourceName,
    warning: qualityWarning || capture?.warning,
    error: capture?.error,
    imageHash: capture?.imageHash,
    screenshotMetrics: capture?.screenshotMetrics,
    capturedAt: capture?.capturedAt || new Date().toISOString(),
  }
}

function hashBase64Payload(imageBase64: string) {
  return createHash('sha256').update(imageBase64.trim()).digest('hex')
}

function extractDataUrlBase64(dataUrl?: string) {
  if (!dataUrl) return ''
  const commaIndex = dataUrl.indexOf(',')
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1).trim() : dataUrl.trim()
}

function getScreenshotMimeType(payload: WorkerPayload) {
  const explicit = toStringValue(payload.mime_type) ?? toStringValue(payload.mimeType)
  if (explicit) return explicit
  const format = (toStringValue(payload.format) ?? 'png').toLowerCase()
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

function joinWarnings(items: Array<string | undefined | null>) {
  const warnings = items.map((item) => item?.trim()).filter((item): item is string => Boolean(item))
  return warnings.length > 0 ? warnings.join('；') : undefined
}

function toViewportCaptureResult(
  payload: WorkerPayload,
  hint: CadCaptureHint,
  options?: { thumbnailWidth?: number; thumbnailHeight?: number; captureMethod?: CadCaptureMethod; sourceName?: string; sourceId?: string },
): CadCaptureResult | null {
  const imageBase64 = toStringValue(payload.image_base64) ?? toStringValue(payload.imageBase64)
  if (!imageBase64) return null

  const mimeType = getScreenshotMimeType(payload)
  const width = toNumber(payload.width) ?? options?.thumbnailWidth
  const height = toNumber(payload.height) ?? options?.thumbnailHeight
  const metrics = toScreenshotMetrics(payload.metrics, imageBase64)
  const captureMethod = options?.captureMethod ?? 'win32-viewport'
  const defaultSourceName = captureMethod === 'autocad-plot' ? 'AutoCAD 出图区域' : 'AutoCAD 绘图区'
  return {
    success: true,
    sourceId: options?.sourceId ?? (captureMethod === 'autocad-plot' ? 'autocad-plot' : 'autocad-viewport'),
    sourceName: options?.sourceName ?? (hint.docName ? `${hint.docName} - ${defaultSourceName}` : defaultSourceName),
    captureMethod,
    thumbnailDataUrl: `data:${mimeType};base64,${imageBase64.trim()}`,
    thumbnailWidth: width,
    thumbnailHeight: height,
    docName: toStringValue(payload.doc_name) ?? hint.docName,
    warning: toStringValue(payload.warning),
    imageHash: toStringValue(payload.image_hash) ?? toStringValue(payload.imageHash) ?? hashBase64Payload(imageBase64),
    imageVariants: toCaptureImageVariants(payload.variants),
    screenshotMetrics: metrics,
    capturedAt: new Date().toISOString(),
  }
}

function toCaptureImageVariant(value: unknown): CadCaptureImageVariant | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as WorkerPayload
  const imageBase64 = toStringValue(payload.image_base64) ?? toStringValue(payload.imageBase64)
  if (!imageBase64) return null
  const mimeType = getScreenshotMimeType(payload)
  return {
    thumbnailDataUrl: `data:${mimeType};base64,${imageBase64.trim()}`,
    thumbnailWidth: toNumber(payload.width),
    thumbnailHeight: toNumber(payload.height),
    mimeType,
    imageHash: toStringValue(payload.image_hash) ?? toStringValue(payload.imageHash) ?? hashBase64Payload(imageBase64),
    screenshotMetrics: toScreenshotMetrics(payload.metrics, imageBase64),
  }
}

function toCaptureImageVariants(value: unknown): Record<string, CadCaptureImageVariant> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const variants: Record<string, CadCaptureImageVariant> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const variant = toCaptureImageVariant(raw)
    if (variant) variants[key] = variant
  }
  return Object.keys(variants).length > 0 ? variants : undefined
}

function toCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = toNumber(raw)
    if (num !== undefined) out[key] = num
  }
  return out
}

function toDrawingScanLayerSummary(value: unknown): CadDrawingScanLayerSummary | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = toStringValue(raw.name)
  if (!name) return null
  return {
    name,
    isOn: typeof raw.on === 'boolean' ? raw.on : undefined,
    isFrozen: typeof raw.frozen === 'boolean' ? raw.frozen : undefined,
    entityCount: toNumber(raw.entity_count),
  }
}

function toDrawingScanResult(payload: WorkerPayload): CadDrawingScanResult {
  const doc = payload.doc && typeof payload.doc === 'object' ? (payload.doc as WorkerPayload) : {}
  const stats =
    payload.entity_stats && typeof payload.entity_stats === 'object'
      ? (payload.entity_stats as WorkerPayload)
      : {}
  return {
    docName: toStringValue(doc.name) ?? toStringValue(payload.doc_name),
    docPath: toStringValue(doc.path),
    isSaved: typeof doc.saved === 'boolean' ? doc.saved : undefined,
    extents: toWindow(payload.extents),
    layers: Array.isArray(payload.layers)
      ? payload.layers.flatMap((row) => {
          const layer = toDrawingScanLayerSummary(row)
          return layer ? [layer] : []
        })
      : [],
    entityStats: {
      byType: toCountMap(stats.by_type),
      byLayer: toCountMap(stats.by_layer),
      total: toNumber(stats.total) ?? 0,
    },
  }
}

function toCompositeRegionExtractResult(
  payload: WorkerPayload,
  window: CadWindow,
): CadCompositeRegionExtractResult {
  const collection = toEntityCollectionSnapshot(payload)
  const texts = Array.isArray(payload.texts)
    ? payload.texts.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const snapshot = toEntitySnapshot(item as WorkerPayload)
        return snapshot ? [snapshot] : []
      })
    : collection.entities.filter((entity) => entity.objectName.includes('Text'))
  const dimensions = Array.isArray(payload.dimensions)
    ? payload.dimensions.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const snapshot = toEntitySnapshot(item as WorkerPayload)
        return snapshot ? [snapshot] : []
      })
    : collection.entities.filter((entity) => entity.objectName.includes('Dimension'))

  return {
    window,
    entities: collection.entities,
    count: toNumber(payload.count) ?? collection.entities.length,
    texts,
    dimensions,
    screenshot: toCompositeScreenshotResult(payload.screenshot),
  }
}

function toCompositeBatchReadResult(payload: WorkerPayload): CadCompositeBatchReadResult {
  const items = Array.isArray(payload.items)
    ? payload.items.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const raw = item as WorkerPayload
        const handle = toStringValue(raw.handle)
        if (!handle) return []
        const entityPayload = raw.entity && typeof raw.entity === 'object' ? (raw.entity as WorkerPayload) : null
        const nearbyPayload =
          raw.nearby && typeof raw.nearby === 'object' ? (raw.nearby as WorkerPayload) : undefined
        return [
          {
            handle,
            entity: entityPayload ? toEntitySnapshot(entityPayload) : null,
            nearby: nearbyPayload ? toEntityCollectionSnapshot(nearbyPayload) : undefined,
          },
        ]
      })
    : []

  const errors = Array.isArray(payload.errors)
    ? payload.errors.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const raw = item as WorkerPayload
        const handle = toStringValue(raw.handle)
        const error = toStringValue(raw.error)
        if (!handle || !error) return []
        return [{ handle, error }]
      })
    : []

  return { items, errors }
}

function toCaptureHintFromDoc(
  doc: CadDocumentSnapshot | null | undefined,
  docNameFallback?: string,
): CadCaptureHint {
  const docName = doc?.name || docNameFallback
  const titleCandidates = [docName ? `${docName} - AutoCAD` : '', docName ?? '', 'AutoCAD']
    .map((item) => item.trim())
    .filter(Boolean)

  return {
    source: 'autocad-window',
    preferredWindowTitle: titleCandidates[0] ?? 'AutoCAD',
    windowTitleCandidates: titleCandidates,
    docName,
  }
}

function toDocumentSnapshot(payload: WorkerPayload): CadDocumentSnapshot {
  return {
    name: toStringValue(payload.name) ?? '未知图纸',
    fullName: toStringValue(payload.full_name) ?? toStringValue(payload.path),
    path: toStringValue(payload.path),
    activeLayoutName: toStringValue(payload.active_layout_name),
    space:
      (toStringValue(payload.space) as CadDocumentSnapshot['space'] | undefined) ?? 'unknown',
    version: toStringValue(payload.version),
    isSaved:
      typeof payload.is_saved === 'boolean'
        ? payload.is_saved
        : typeof payload.saved === 'boolean'
          ? payload.saved
          : undefined,
  }
}

function toDocumentListItem(value: unknown): CadDocumentListItem | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as WorkerPayload
  const name = toStringValue(raw.name)
  if (!name) return null
  return {
    name,
    path: toStringValue(raw.path),
    active: Boolean(raw.active),
  }
}

function toCurrentViewState(payload: WorkerPayload): CadCurrentViewState {
  const center = toPoint(payload.view_center) ?? toPoint(payload.center)
  const rawScreen = payload.screen_size ?? payload.screenSize
  let screenSize: CadCurrentViewState['screenSize']
  if (Array.isArray(rawScreen)) {
    const width = toNumber(rawScreen[0])
    const height = toNumber(rawScreen[1])
    if (width !== undefined && height !== undefined) {
      screenSize = { width, height }
    }
  } else if (rawScreen && typeof rawScreen === 'object') {
    const width = toNumber((rawScreen as WorkerPayload).width)
    const height = toNumber((rawScreen as WorkerPayload).height)
    if (width !== undefined && height !== undefined) {
      screenSize = { width, height }
    }
  }
  const viewSize = toNumber(payload.view_size) ?? toNumber(payload.viewSize)
  let window = toWindow(payload.window)
  if (!window && center && viewSize !== undefined && screenSize?.width && screenSize.height) {
    const height = viewSize
    const width = viewSize * (screenSize.width / Math.max(1, screenSize.height))
    window = {
      min: { x: center.x - width / 2, y: center.y - height / 2, z: center.z },
      max: { x: center.x + width / 2, y: center.y + height / 2, z: center.z },
    }
  }
  return {
    center,
    viewSize,
    screenSize,
    window,
    docName: toStringValue(payload.doc_name) ?? toStringValue(payload.docName),
  }
}

export class CadRuntimeServiceImpl implements CadRuntimeService {
  private readonly workerHost = new AutoCadComWorkerHost()
  private readonly sessionStore = new CadSessionStore()
  private readonly captureService: CadCaptureService

  constructor(screenshotManager: ScreenshotManager) {
    this.captureService = new CadCaptureService(screenshotManager)
  }

  readonly session = {
    connect: async (): Promise<CadConnectionStatus> => {
      const result = await this.workerHost.call('cad.session.connect')
      const status: CadConnectionStatus = {
        connected: Boolean(result.ok),
        docName: toStringValue(result.doc_name),
        version: toStringValue(result.version),
      }

      if (status.connected) {
        const activeDocument = await this.safeGetActiveDocument(status)
        this.sessionStore.merge({
          activeDocument,
          space: activeDocument?.space,
          captureHint: toCaptureHintFromDoc(activeDocument, status.docName),
        })
      }

      return status
    },

    status: async (): Promise<CadConnectionStatus> => {
      const result = await this.workerHost.call('cad.session.status')
      const status: CadConnectionStatus = {
        connected: Boolean(result.connected),
        docName: toStringValue(result.doc_name),
      }

      if (status.connected) {
        const activeDocument = await this.safeGetActiveDocument(status)
        const docName = activeDocument?.name || status.docName
        this.sessionStore.merge({
          activeDocument,
          space: activeDocument?.space,
          captureHint: toCaptureHintFromDoc(activeDocument, docName),
        })
        return {
          ...status,
          docName,
        }
      }

      return status
    },

    getDiffSnapshot: () => {
      return this.sessionStore.getSnapshot()
    },

    reset: () => {
      this.sessionStore.clear()
    },
  }

  readonly document = {
    getActive: async (): Promise<CadDocumentSnapshot> => {
      const result = await this.workerHost.call('cad.document.getActive')
      const document = toDocumentSnapshot(result)

      this.sessionStore.merge({
        activeDocument: document,
        space: document.space,
        captureHint: toCaptureHintFromDoc(document),
      })

      return document
    },

    list: async (): Promise<CadDocumentListItem[]> => {
      const result = await this.workerHost.call('cad.document.list')
      const rawItems = Array.isArray(result.documents) ? result.documents : Array.isArray(result.items) ? result.items : []
      return rawItems.flatMap((item) => {
        const document = toDocumentListItem(item)
        return document ? [document] : []
      })
    },

    open: async (path: string): Promise<CadDocumentSnapshot> => {
      const result = await this.workerHost.call('cad.document.open', { path })
      const active = toDocumentSnapshot(result)
      this.sessionStore.merge({
        activeDocument: active,
        space: active.space,
        captureHint: toCaptureHintFromDoc(active),
      })
      return active
    },

    switch: async (name: string): Promise<CadDocumentSnapshot> => {
      await this.workerHost.call('cad.document.switch', { name })
      return this.document.getActive()
    },

    plotLayoutToPdf: async (layout: string | undefined, outputPath: string): Promise<{ ok: boolean; path: string }> => {
      const result = await this.workerHost.call('cad.document.plotLayoutToPdf', {
        layout,
        output_path: outputPath,
      })
      return {
        ok: Boolean(result.ok),
        path: toStringValue(result.path) ?? outputPath,
      }
    },
  }

  readonly selection = {
    readCurrent: async (): Promise<CadSelectionSnapshot> => {
      const result = await this.workerHost.call('cad.selection.readCurrent')
      const selection = toSelectionSnapshot(result)
      this.sessionStore.merge({
        selectionHandles: selection.handles,
        recentEntityRefs: selection.entities.slice(0, 20),
      })
      return selection
    },

    selectWindow: async (window: CadWindow): Promise<CadSelectionSnapshot> => {
      const result = await this.workerHost.call('cad.selection.selectWindow', { window })
      const selection = toSelectionSnapshot(result)
      this.sessionStore.merge({
        selectionHandles: selection.handles,
        recentEntityRefs: selection.entities.slice(0, 20),
      })
      return selection
    },

    selectByHandle: async (handle: string): Promise<CadSelectionSnapshot> => {
      const result = await this.workerHost.call('cad.selection.selectByHandle', { handle })
      const objectName = toStringValue(result.object_name) ?? 'AcDbEntity'
      const entityRef: CadEntityRef = {
        handle,
        objectName,
        layer: toStringValue(result.layer),
        summary: summarizeEntityRef({
          handle,
          objectName,
          layer: toStringValue(result.layer),
        }),
      }

      const selection: CadSelectionSnapshot = {
        docName: toStringValue(result.doc_name),
        count: 1,
        handles: [handle],
        entities: [entityRef],
      }

      this.sessionStore.merge({
        selectionHandles: selection.handles,
        recentEntityRefs: [entityRef],
      })
      return selection
    },

    clear: async (): Promise<CadSelectionSnapshot> => {
      const result = await this.workerHost.call('cad.selection.clear')
      const selection = toSelectionSnapshot(result)
      this.sessionStore.merge({
        selectionHandles: [],
      })
      return selection
    },

    nearby: async (
      point: CadPoint,
      radius: number,
      options?: { layers?: string[]; types?: string[] },
    ): Promise<CadSpatialQueryResult> => {
      const result = await this.workerHost.call('cad.selection.nearby', {
        point,
        radius,
        layers: options?.layers,
        types: options?.types,
      })
      const queryResult = toSpatialQueryResult(result)
      this.sessionStore.merge({
        recentEntityRefs: queryResult.entities.slice(0, 20),
      })
      return queryResult
    },

    nearest: async (
      point: CadPoint,
      options?: { types?: string[]; count?: number },
    ): Promise<CadSpatialQueryResult> => {
      const result = await this.workerHost.call('cad.selection.nearest', {
        point,
        types: options?.types,
        count: options?.count,
      })
      const queryResult = toSpatialQueryResult(result)
      this.sessionStore.merge({
        recentEntityRefs: queryResult.entities.slice(0, 20),
      })
      return queryResult
    },
  }

  readonly view = {
    getCurrent: async (): Promise<CadCurrentViewState> => {
      const result = await this.workerHost.call('cad.view.getCurrent')
      const viewState = toCurrentViewState(result)
      this.sessionStore.merge({
        viewSummary: viewState.center
          ? `当前视图中心 (${viewState.center.x}, ${viewState.center.y})，高度 ${viewState.viewSize ?? 'unknown'}`
          : '当前视图状态已读取',
      })
      return viewState
    },

    zoomWindow: async (window: CadWindow) => {
      await this.workerHost.call('cad.view.zoomWindow', { window })
      const viewState: CadViewState = {
        window,
        source: 'zoom_window',
        summary: `窗口缩放到 [${window.min.x}, ${window.min.y}] - [${window.max.x}, ${window.max.y}]`,
      }
      this.sessionStore.merge({
        viewSummary: viewState.summary,
      })
    },

    zoomExtents: async () => {
      await this.workerHost.call('cad.view.zoomExtents')
      const viewState: CadViewState = {
        source: 'zoom_extents',
        summary: '视图缩放到图形范围',
      }
      this.sessionStore.merge({
        viewSummary: viewState.summary,
      })
    },

    zoomCenter: async (center: CadPoint, magnify = 1) => {
      await this.workerHost.call('cad.view.zoomCenter', { center, magnify })
      const viewState: CadViewState = {
        center,
        magnify,
        source: 'zoom_center',
        summary: `视图中心移动到 (${center.x}, ${center.y})，倍率 ${magnify}`,
      }
      this.sessionStore.merge({
        viewSummary: viewState.summary,
      })
    },

    pan: async (offset: CadPoint) => {
      await this.workerHost.call('cad.view.pan', { offset })
      const viewState: CadViewState = {
        center: offset,
        source: 'pan',
        summary: `视图平移偏移 (${offset.x}, ${offset.y})`,
      }
      this.sessionStore.merge({
        viewSummary: viewState.summary,
      })
    },

    ensureModelSpace: async (): Promise<{ ok: boolean; activeLayout?: string; warnings: string[] }> => {
      const result = await this.workerHost.call('cad.view.ensureModelSpace')
      const warnings = Array.isArray(result?.warnings)
        ? result.warnings.map((item) => String(item)).filter(Boolean)
        : []
      return {
        ok: result?.ok !== false,
        activeLayout: toStringValue(result?.active_layout) ?? toStringValue(result?.activeLayout),
        warnings,
      }
    },

    regen: async () => {
      await this.workerHost.call('cad.view.regen')
      const viewState: CadViewState = {
        source: 'regen',
        summary: 'CAD 视图已重生成',
      }
      this.sessionStore.merge({
        viewSummary: viewState.summary,
      })
    },
  }

  readonly entities = {
    extractSelection: async (): Promise<CadEntityCollectionSnapshot> => {
      const result = await this.workerHost.call('cad.entities.extractSelection')
      const collection = toEntityCollectionSnapshot(result)
      this.sessionStore.merge({
        selectionHandles: collection.entities.map((item) => item.handle),
        recentEntityRefs: collection.entities.slice(0, 20),
      })
      return collection
    },

    extractWindow: async (window: CadWindow): Promise<CadEntityCollectionSnapshot> => {
      const result = await this.workerHost.call('cad.entities.extractWindow', { window })
      const collection = toEntityCollectionSnapshot(result)
      this.sessionStore.merge({
        selectionHandles: collection.entities.map((item) => item.handle),
        recentEntityRefs: collection.entities.slice(0, 20),
      })
      return collection
    },

    getByHandle: async (handle: string): Promise<CadEntitySnapshot> => {
      const result = await this.workerHost.call('cad.entities.getByHandle', { handle })
      const snapshot = toEntitySnapshot(result)
      if (!snapshot) {
        throw new Error(`未能按 handle 读取实体: ${handle}`)
      }
      this.sessionStore.merge({
        recentEntityRefs: [snapshot],
      })
      return snapshot
    },

    readText: async (): Promise<CadTextReadResult> => {
      const result = await this.workerHost.call('cad.entities.readText')
      return {
        docName: toStringValue(result.doc_name),
        texts: Array.isArray(result.texts)
          ? result.texts.filter((item): item is string => typeof item === 'string')
          : [],
        textCount: typeof result.text_count === 'number' ? result.text_count : 0,
        totalObjects:
          typeof result.total_objects === 'number' ? result.total_objects : undefined,
      }
    },

    readByFilter: async (
      filter: Record<string, unknown>,
      options?: {
        onProgress?: (progress: CadRpcProgress) => void
        timeoutMs?: number
        progressInterval?: number
        signal?: AbortSignal
        terminateOnAbort?: boolean
      },
    ): Promise<CadEntityCollectionSnapshot> => {
      const result = await this.workerHost.call(
        'cad.entities.readByFilter',
        {
          filter,
          progress_interval: options?.progressInterval,
        },
        {
          onProgress: options?.onProgress,
          timeoutMs: options?.timeoutMs,
          signal: options?.signal,
          terminateOnAbort: options?.terminateOnAbort,
        },
      )
      const collection = toEntityCollectionSnapshot(result)
      this.sessionStore.merge({
        recentEntityRefs: collection.entities.slice(0, 20),
      })
      return collection
    },

    readReadableIndex: async (
      options?: {
        onProgress?: (progress: CadRpcProgress) => void
        timeoutMs?: number
        progressInterval?: number
        signal?: AbortSignal
        terminateOnAbort?: boolean
      },
    ): Promise<CadEntityCollectionSnapshot> => {
      const result = await this.workerHost.call(
        'cad.entities.readReadableIndex',
        {
          progress_interval: options?.progressInterval,
        },
        {
          onProgress: options?.onProgress,
          timeoutMs: options?.timeoutMs,
          signal: options?.signal,
          terminateOnAbort: options?.terminateOnAbort,
        },
      )
      const collection = toEntityCollectionSnapshot(result)
      this.sessionStore.merge({
        recentEntityRefs: collection.entities.slice(0, 20),
      })
      return collection
    },

    readByPolygon: async (points: CadPoint[]): Promise<CadEntityCollectionSnapshot> => {
      const result = await this.workerHost.call('cad.entities.readByPolygon', { points })
      const collection = toEntityCollectionSnapshot(result)
      this.sessionStore.merge({
        recentEntityRefs: collection.entities.slice(0, 20),
      })
      return collection
    },
  }

  readonly annotations = {
    readAllText: async (options?: {
      layers?: string[]
      clean?: boolean
    }): Promise<CadAnnotationReadResult> => {
      const result = await this.workerHost.call('cad.annotations.readAllText', {
        layers: options?.layers,
        clean: options?.clean,
      })
      const textResult = toAnnotationReadResult(result)
      this.sessionStore.merge({
        recentEntityRefs: textResult.items.slice(0, 20),
      })
      return textResult
    },

    readAllDimensions: async (options?: { layers?: string[] }): Promise<CadAnnotationReadResult> => {
      const result = await this.workerHost.call('cad.annotations.readAllDimensions', {
        layers: options?.layers,
      })
      const dimResult = toAnnotationReadResult(result)
      this.sessionStore.merge({
        recentEntityRefs: dimResult.items.slice(0, 20),
      })
      return dimResult
    },

    readAllTables: async (options?: { layers?: string[] }): Promise<CadAnnotationReadResult> => {
      const result = await this.workerHost.call('cad.annotations.readAllTables', {
        layers: options?.layers,
      })
      const tableResult = toAnnotationReadResult(result)
      this.sessionStore.merge({
        recentEntityRefs: tableResult.items.slice(0, 20),
      })
      return tableResult
    },

    findText: async (
      pattern: string,
      options?: {
        regex?: boolean
        limit?: number
        maxEntitiesScanned?: number
      },
    ): Promise<CadTextSearchResult> => {
      const result = await this.workerHost.call('cad.annotations.findText', {
        pattern,
        regex: options?.regex,
        limit: options?.limit,
        max_entities_scanned: options?.maxEntitiesScanned,
      })
      return toTextSearchResult(result, {
        pattern,
        regex: Boolean(options?.regex),
      })
    },

    findTextPlus: async (
      pattern: string,
      options?: {
        regex?: boolean
        caseSensitive?: boolean
        normalized?: boolean
        limit?: number
        maxEntitiesScanned?: number
        sources?: string[]
        keywords?: string[]
        scanAllMatches?: boolean
      },
    ): Promise<CadTextPlusSearchResult> => {
      const result = await this.workerHost.call('cad.annotations.findTextPlus', {
        pattern,
        regex: options?.regex,
        case_sensitive: options?.caseSensitive,
        normalized: options?.normalized,
        limit: options?.limit,
        max_entities_scanned: options?.maxEntitiesScanned,
        sources: options?.sources,
        keywords: options?.keywords,
        scan_all_matches: options?.scanAllMatches,
      })
      const normalized = options?.normalized
      return toTextPlusSearchResult(result, {
        pattern,
        regex: Boolean(options?.regex),
        caseSensitive: Boolean(options?.caseSensitive),
        normalized: normalized === undefined ? true : Boolean(normalized),
      })
    },
  }

  readonly geometry = {
    distancePointPoint: async (
      p1: CadPoint,
      p2: CadPoint,
    ): Promise<CadGeometryDistanceResult> => {
      const result = await this.workerHost.call('cad.geometry.distancePointPoint', { p1, p2 })
      return toGeometryDistanceResult(result)
    },

    areaByHandle: async (handle: string): Promise<CadGeometryAreaResult> => {
      const result = await this.workerHost.call('cad.geometry.areaByHandle', { handle })
      return toGeometryAreaResult(handle, result)
    },

    lengthByHandle: async (handle: string): Promise<CadGeometryLengthResult> => {
      const result = await this.workerHost.call('cad.geometry.lengthByHandle', { handle })
      return toGeometryLengthResult(handle, result)
    },

    boundingBoxByHandles: async (handles: string[]): Promise<CadGeometryBoundingBoxResult> => {
      const result = await this.workerHost.call('cad.geometry.boundingBoxByHandles', { handles })
      return toGeometryBoundingBoxResult(handles, result)
    },
  }

  readonly composite = {
    scanDrawing: async (options?: { maxEntities?: number }): Promise<CadDrawingScanResult> => {
      const result = await this.workerHost.call('cad.composite.scanDrawing', {
        max_entities: options?.maxEntities,
      })
      return toDrawingScanResult(result)
    },

    regionExtract: async (
      window: CadWindow,
      options?: {
        layers?: string[]
        types?: string[]
        width?: number
        height?: number
      },
    ): Promise<CadCompositeRegionExtractResult> => {
      const result = await this.workerHost.call('cad.composite.regionExtract', {
        window,
        layers: options?.layers,
        types: options?.types,
        width: options?.width,
        height: options?.height,
      })
      const regionResult = toCompositeRegionExtractResult(result, window)
      this.sessionStore.merge({
        recentEntityRefs: regionResult.entities.slice(0, 20),
      })
      return regionResult
    },

    batchRead: async (
      handles: string[],
      options?: { includeNearby?: boolean },
    ): Promise<CadCompositeBatchReadResult> => {
      const result = await this.workerHost.call('cad.composite.batchRead', {
        handles,
        include_nearby: options?.includeNearby,
      })
      const batchResult = toCompositeBatchReadResult(result)
      this.sessionStore.merge({
        recentEntityRefs: batchResult.items
          .flatMap((item) => (item.entity ? [item.entity] : []))
          .slice(0, 20),
      })
      return batchResult
    },
  }

  readonly capture = {
    getHint: async (): Promise<CadCaptureHint> => {
      const diff = this.sessionStore.getSnapshot()

      let hint: CadCaptureHint
      try {
        const result = await this.workerHost.call('cad.capture.hint')
        hint = {
          source: 'autocad-window',
          preferredWindowTitle:
            toStringValue(result.preferred_window_title) ?? 'AutoCAD',
          windowTitleCandidates: Array.isArray(result.window_title_candidates)
            ? result.window_title_candidates.filter(
                (item): item is string => typeof item === 'string' && item.trim().length > 0,
              )
            : ['AutoCAD'],
          docName: toStringValue(result.doc_name),
          windowBounds: toScreenBounds(result.window_bounds) ?? toScreenBounds(result.windowBounds),
          clientBounds: toScreenBounds(result.client_bounds) ?? toScreenBounds(result.clientBounds),
        }
      } catch {
        const status = await this.session.status()
        hint = diff?.captureHint ?? toCaptureHintFromDoc(diff?.activeDocument, status.docName)
      }

      this.sessionStore.merge({ captureHint: hint })
      return hint
    },

    captureRegion: async (
      window: CadWindow,
      options?: { thumbnailWidth?: number; thumbnailHeight?: number },
    ): Promise<CadCaptureResult> => {
      const hint = await this.capture.getHint()
      try {
        const payload = await this.workerHost.call('cad.view.screenshotRegion', {
          window,
          width: options?.thumbnailWidth,
          height: options?.thumbnailHeight,
        })
        const capture = toViewportCaptureResult(payload, hint, options)
        if (!capture) {
          return {
            success: false,
            docName: hint.docName,
            capturedAt: new Date().toISOString(),
            error: 'CAD 区域截图返回缺少图像数据。',
          }
        }
        return {
          ...capture,
          sourceId: 'autocad-region',
          sourceName: hint.docName ? `${hint.docName} - CAD 坐标区域` : 'CAD 坐标区域',
          captureMethod: 'win32-viewport',
          warning: joinWarnings([capture.warning, getCadCaptureQualityWarning(capture)]),
        }
      } catch (error) {
        return {
          success: false,
          docName: hint.docName,
          capturedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    plotRegion: async (
      window: CadWindow,
      options?: {
        thumbnailWidth?: number
        thumbnailHeight?: number
        dpi?: number
        variant?: CadPlotVariant
        profile?: CadPlotProfile
        fitMode?: CadPlotFitMode
        keepDiagnostics?: boolean
      },
    ): Promise<CadCaptureResult> => {
      const hint = await this.capture.getHint()
      try {
        const payload = await this.workerHost.call('cad.view.plotRegion', {
          window,
          width: options?.thumbnailWidth,
          height: options?.thumbnailHeight,
          dpi: options?.dpi,
          variant: options?.variant,
          profile: options?.profile,
          fit_mode: options?.fitMode,
          keep_diagnostics: options?.keepDiagnostics,
        })
        const capture = toViewportCaptureResult(payload, hint, {
          ...options,
          captureMethod: 'autocad-plot',
        })
        if (!capture) {
          return {
            success: false,
            docName: hint.docName,
            capturedAt: new Date().toISOString(),
            error: 'CAD 出图返回缺少图像数据。',
          }
        }
        return {
          ...capture,
          warning: joinWarnings([capture.warning, getCadCaptureQualityWarning(capture)]),
        }
      } catch (error) {
        return {
          success: false,
          docName: hint.docName,
          capturedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    captureCadWindow: async (options?: { thumbnailWidth?: number; thumbnailHeight?: number }) => {
      let ensureVisibleWarning = ''
      try {
        const visibility = await this.workerHost.call('cad.view.ensureVisible')
        const warnings = Array.isArray(visibility?.warnings)
          ? visibility.warnings.map((item) => String(item)).filter(Boolean)
          : []
        ensureVisibleWarning = warnings.join('；')
      } catch (error) {
        ensureVisibleWarning = `AutoCAD 窗口恢复/置前失败：${error instanceof Error ? error.message : String(error)}`
      }

      const hint = await this.capture.getHint()
      const normalizeElectronCapture = (
        capture: CadCaptureResult,
        method: 'electron-window' | 'electron-screen-crop',
        extraWarnings: Array<string | undefined | null> = [],
      ): CadCaptureResult => ({
        ...capture,
        captureMethod: method,
        imageHash: capture.imageHash ?? (capture.thumbnailDataUrl
          ? hashBase64Payload(extractDataUrlBase64(capture.thumbnailDataUrl))
          : undefined),
        screenshotMetrics: capture.screenshotMetrics ?? (capture.thumbnailDataUrl
          ? { byteLength: Buffer.byteLength(extractDataUrlBase64(capture.thumbnailDataUrl), 'base64') }
          : undefined),
        warning: joinWarnings([...extraWarnings, capture.warning]),
      })

      const captureAttempts: CadCaptureAttempt[] = []
      const acceptCapture = (capture: CadCaptureResult) => ({
        ...capture,
        warning: joinWarnings([ensureVisibleWarning, capture.warning]),
        captureAttempts: [...captureAttempts],
      })

      try {
        const electronCapture = await this.captureService.captureWindowByHint(hint, options)
        const normalized = normalizeElectronCapture(electronCapture, 'electron-window')
        const qualityWarning = getCadCaptureQualityWarning(normalized)
        if (normalized.success && !qualityWarning) {
          captureAttempts.push(toCaptureAttempt('electron-window', normalized, null))
          this.sessionStore.merge({
            captureHint: hint,
          })
          return acceptCapture(normalized)
        }
        captureAttempts.push(toCaptureAttempt('electron-window', normalized, qualityWarning))
      } catch (error) {
        captureAttempts.push({
          method: 'electron-window',
          success: false,
          valid: false,
          error: error instanceof Error ? error.message : String(error),
          capturedAt: new Date().toISOString(),
        })
      }

      if (hint.clientBounds || hint.windowBounds) {
        try {
          const screenCapture = await this.captureService.captureScreenRegionByHint(hint, options)
          const normalized = normalizeElectronCapture(screenCapture, 'electron-screen-crop')
          const qualityWarning = getCadCaptureQualityWarning(normalized)
          if (normalized.success && !qualityWarning) {
            captureAttempts.push(toCaptureAttempt('electron-screen-crop', normalized, null))
            this.sessionStore.merge({
              captureHint: hint,
            })
            return acceptCapture(normalized)
          }
          captureAttempts.push(toCaptureAttempt('electron-screen-crop', normalized, qualityWarning))
        } catch (error) {
          captureAttempts.push({
            method: 'electron-screen-crop',
            success: false,
            valid: false,
            error: error instanceof Error ? error.message : String(error),
            capturedAt: new Date().toISOString(),
          })
        }
      } else {
        captureAttempts.push({
          method: 'electron-screen-crop',
          success: false,
          valid: false,
          error: 'AutoCAD capture hint 缺少窗口 bounds，无法执行屏幕裁剪。',
          capturedAt: new Date().toISOString(),
        })
      }

      try {
        const viewportCapture = await this.workerHost.call('cad.view.screenshot', {
          width: options?.thumbnailWidth,
          height: options?.thumbnailHeight,
        })
        const capture = toViewportCaptureResult(viewportCapture, hint, options)
        if (capture) {
          const qualityWarning = getCadCaptureQualityWarning(capture)
          if (capture.success && !qualityWarning) {
            captureAttempts.push(toCaptureAttempt('win32-viewport', capture, null))
            this.sessionStore.merge({
              captureHint: hint,
            })
            return acceptCapture(capture)
          }
          captureAttempts.push(toCaptureAttempt('win32-viewport', capture, qualityWarning))
        } else {
          captureAttempts.push({
            method: 'win32-viewport',
            success: false,
            valid: false,
            error: 'CAD 绘图区截图返回缺少图像数据。',
            capturedAt: new Date().toISOString(),
          })
        }
      } catch (error) {
        captureAttempts.push({
          method: 'win32-viewport',
          success: false,
          valid: false,
          error: error instanceof Error ? error.message : String(error),
          capturedAt: new Date().toISOString(),
        })
      }

      this.sessionStore.merge({
        captureHint: hint,
      })
      const failures = captureAttempts
        .map((attempt) => `${attempt.method}: ${attempt.warning || attempt.error || 'invalid'}`)
        .filter(Boolean)
      return {
        success: false,
        docName: hint.docName,
        capturedAt: new Date().toISOString(),
        error: joinWarnings([ensureVisibleWarning, ...failures]) || 'CAD 窗口截图失败。',
        captureAttempts,
      }
    },
  }

  readonly collections = {
    listLayers: async (): Promise<CadLayerSummary[]> => {
      const result = await this.workerHost.call('cad.collections.listLayers')
      return Array.isArray(result.layers)
        ? result.layers.flatMap((item) => {
            if (!item || typeof item !== 'object') return []
            const raw = item as Record<string, unknown>
            const name = toStringValue(raw.name)
            if (!name) return []
            return [
              {
                name,
                color: toNumber(raw.color),
                isOn:
                  typeof raw.is_on === 'boolean'
                    ? raw.is_on
                    : typeof raw.on === 'boolean'
                      ? raw.on
                      : undefined,
                isFrozen:
                  typeof raw.is_frozen === 'boolean'
                    ? raw.is_frozen
                    : typeof raw.frozen === 'boolean'
                      ? raw.frozen
                      : undefined,
                isLocked:
                  typeof raw.is_locked === 'boolean'
                    ? raw.is_locked
                    : typeof raw.locked === 'boolean'
                      ? raw.locked
                      : undefined,
              },
            ]
          })
        : []
    },
    listLayouts: async (): Promise<CadLayoutSummary[]> => {
      const result = await this.workerHost.call('cad.collections.listLayouts')
      return Array.isArray(result.layouts)
        ? result.layouts.flatMap((item) => {
            if (!item || typeof item !== 'object') return []
            const raw = item as Record<string, unknown>
            const name = toStringValue(raw.name)
            if (!name) return []
            return [
              {
                name,
                modelType:
                  typeof raw.model_type === 'boolean'
                    ? raw.model_type
                    : name.toLowerCase() === 'model',
                tabOrder: toNumber(raw.tab_order) ?? toNumber(raw.tabOrder),
              },
            ]
          })
        : []
    },
    listBlocks: async (): Promise<CadBlockSummary[]> => {
      const result = await this.workerHost.call('cad.collections.listBlocks')
      return Array.isArray(result.blocks)
        ? result.blocks.flatMap((item) => {
            if (!item || typeof item !== 'object') return []
            const raw = item as Record<string, unknown>
            const name = toStringValue(raw.name)
            if (!name) return []
            return [
              {
                name,
                isLayout: typeof raw.is_layout === 'boolean' ? raw.is_layout : undefined,
                isXRef: typeof raw.is_xref === 'boolean' ? raw.is_xref : undefined,
                itemCount: toNumber(raw.item_count) ?? toNumber(raw.entity_count),
              },
            ]
          })
        : []
    },
  }

  readonly variables = {
    get: async (name: string): Promise<CadVariableSnapshot> => {
      const result = await this.workerHost.call('cad.variables.get', { name })
      return {
        name: toStringValue(result.name) ?? name,
        value: result.value,
      }
    },
    set: async (_name: string, _value: unknown) => {
      throw createNotImplementedCadMethodError('variables.set')
    },
  }

  readonly commands = {
    send: async (_command: string) => {
      throw createNotImplementedCadMethodError('commands.send')
    },
  }

  readonly editing = {
    updateEntity: async (_handle: string, _patch: Record<string, unknown>) => {
      throw createNotImplementedCadMethodError('editing.updateEntity')
    },
  }

  readonly events = {
    subscribe: async (_eventName: string) => {
      throw createNotImplementedCadMethodError('events.subscribe')
    },
  }

  private async safeGetActiveDocument(
    status: CadConnectionStatus,
  ): Promise<CadDocumentSnapshot | null> {
    try {
      return await this.document.getActive()
    } catch {
      return status.docName
        ? {
            name: status.docName,
            space: 'unknown',
            version: status.version,
          }
        : null
    }
  }
}

export function createCadRuntimeService(screenshotManager: ScreenshotManager): CadRuntimeService {
  return new CadRuntimeServiceImpl(screenshotManager)
}
