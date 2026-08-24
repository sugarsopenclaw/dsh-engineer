import { AcCmColor } from '@mlightcad/common'
import { AcGeBox2d, AcGePoint2d } from '@mlightcad/geometry-engine'
import {
  AcDbArc,
  AcDbCircle,
  AcDbLayerTableRecord,
  AcDbLine,
  AcDbMText,
  AcDbPolyline,
  type AcDbDatabase,
  type AcDbEntity,
} from '@mlightcad/data-model'

import type {
  MLightCadDocumentInfoRuntimeResult,
  MLightCadDraftEntity,
  MLightCadEntityPreviewImage,
  MLightCadEntityPreviewOperation,
  MLightCadEntityPreviewRuntimeResult,
  MLightCadExportDxfRuntimeResult,
  MLightCadLayerInfo,
  MLightCadLayersRuntimeResult,
  MLightCadMutateOperation,
  MLightCadMutateRuntimeResult,
  MLightCadRenderOperation,
  MLightCadRenderRuntimeResult,
  MLightCadWindow,
} from '../shared/mlight-cad-runtime'
import {
  AcApEntityPreviewConvertor,
  AcApPngConvertor,
  type MLightBox2d,
  type MLightDocumentManager,
  type MLightLayerRecord,
  type MLightWritableDatabase,
} from './mlight-simple-viewer'

const DXF_PRECISION = 6
const LAYER_LIMIT = 20_000

function modelSpaceEntities(database: AcDbDatabase): AcDbEntity[] {
  return database.tables.blockTable.modelSpace.newIterator().toArray()
}

function layerRecords(database: AcDbDatabase): MLightLayerRecord[] {
  return database.tables.layerTable.newIterator().toArray() as unknown as MLightLayerRecord[]
}

function colorText(color: unknown): string | null {
  if (typeof color !== 'object' || color === null) return null
  for (const key of ['cssColor', 'colorName']) {
    const value = Reflect.get(color, key)
    if (typeof value === 'string' && value) return value.slice(0, 64)
  }
  const colorIndex = Reflect.get(color, 'colorIndex')
  return typeof colorIndex === 'number' ? `ACI ${colorIndex}` : null
}

/** Fraction of entities the content box must cover. */
const CONTENT_COVERAGE = 0.98
/** Only prefer the content box when it saves most of the frame. */
const CONTENT_AREA_RATIO = 0.5

export interface EntityBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function entityBoxes(database: AcDbDatabase): EntityBox[] {
  const boxes: EntityBox[] = []
  for (const entity of modelSpaceEntities(database)) {
    try {
      const box = entity.geometricExtents
      if (box.isEmpty()) continue
      const candidate = { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y }
      if (!Object.values(candidate).every((value) => Number.isFinite(value))) continue
      boxes.push(candidate)
    } catch {
      continue
    }
  }
  return boxes
}

function unionOf(boxes: readonly EntityBox[]): MLightCadWindow | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const box of boxes) {
    minX = Math.min(minX, box.minX)
    minY = Math.min(minY, box.minY)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || minX >= maxX || minY >= maxY) return null
  return { min: [minX, minY], max: [maxX, maxY] }
}

/**
 * The narrowest interval covering `coverage` of the values.
 *
 * A percentile pair would do when strays sit on both sides, but real drawings usually
 * carry them on one side only — a stray click left near the origin, an old detail parked
 * off to the right — and a sliding window collapses onto the content either way.
 */
function densestInterval(values: number[], coverage: number): [number, number] {
  const sorted = [...values].sort((a, b) => a - b)
  const keep = Math.max(2, Math.ceil(sorted.length * coverage))
  if (keep >= sorted.length) return [sorted[0] as number, sorted[sorted.length - 1] as number]
  let bestLow = sorted[0] as number
  let bestHigh = sorted[keep - 1] as number
  let bestSpan = bestHigh - bestLow
  for (let start = 1; start + keep <= sorted.length; start += 1) {
    const low = sorted[start] as number
    const high = sorted[start + keep - 1] as number
    if (high - low < bestSpan) {
      bestSpan = high - low
      bestLow = low
      bestHigh = high
    }
  }
  return [bestLow, bestHigh]
}

/**
 * Model-space extents unioned from entity bounding boxes.
 *
 * The header EXTMIN/EXTMAX pair is frequently stale in drawings that were edited
 * without a regen, so framing an export off it silently clips content.
 */
export function computeExtents(database: AcDbDatabase): MLightCadWindow | null {
  return unionOf(entityBoxes(database))
}

export interface DrawingMeasurement {
  /** Every entity, including strays parked far from the drawing. */
  extents: MLightCadWindow | null
  /** The area the drawing actually occupies, or null when that is the whole extents. */
  contentExtents: MLightCadWindow | null
  /** Entities left outside `contentExtents`. */
  omittedEntityCount: number
}

/**
 * Measures both the full extents and the area worth framing.
 *
 * Real drawings routinely carry a handful of entities stranded kilometres from the sheet,
 * and because extents is a union, those few entities decide the frame for all of them: a
 * whole-drawing render then shows the real content as an illegible sliver in a black
 * field. Framing on the dense area instead is the difference between a usable overview
 * and a useless one, so long as the caller is told what was left out.
 */
export function measureDrawing(database: AcDbDatabase): DrawingMeasurement {
  return measureBoxes(entityBoxes(database))
}

export function measureBoxes(boxes: readonly EntityBox[]): DrawingMeasurement {
  const extents = unionOf(boxes)
  if (!extents || boxes.length < 8) return { extents, contentExtents: null, omittedEntityCount: 0 }

  const [lowX, highX] = densestInterval(boxes.map((box) => (box.minX + box.maxX) / 2), CONTENT_COVERAGE)
  const [lowY, highY] = densestInterval(boxes.map((box) => (box.minY + box.maxY) / 2), CONTENT_COVERAGE)
  const inside = boxes.filter((box) => {
    const centerX = (box.minX + box.maxX) / 2
    const centerY = (box.minY + box.maxY) / 2
    return centerX >= lowX && centerX <= highX && centerY >= lowY && centerY <= highY
  })
  // Union the kept entities rather than the interval itself, so a border or title block
  // that reaches past the dense area is framed whole instead of being cut in half.
  const contentExtents = unionOf(inside)
  if (!contentExtents) return { extents, contentExtents: null, omittedEntityCount: 0 }

  const area = (window: MLightCadWindow): number => (
    (window.max[0] - window.min[0]) * (window.max[1] - window.min[1])
  )
  const worthTrimming = area(contentExtents) < area(extents) * CONTENT_AREA_RATIO
  return {
    extents,
    contentExtents: worthTrimming ? contentExtents : null,
    omittedEntityCount: worthTrimming ? boxes.length - inside.length : 0,
  }
}

function toBox2d(window: MLightCadWindow): MLightBox2d {
  return new AcGeBox2d(
    { x: window.min[0], y: window.min[1] },
    { x: window.max[0], y: window.max[1] },
  ) as unknown as MLightBox2d
}

function dataUrlToBase64(dataUrl: string): string {
  const separator = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:image/png;base64,') || separator < 0) {
    throw new Error('MLightCAD produced an unexpected image payload.')
  }
  return dataUrl.slice(separator + 1)
}

export function runLayers(database: AcDbDatabase): MLightCadLayersRuntimeResult {
  const counts = new Map<string, number>()
  for (const entity of modelSpaceEntities(database)) {
    const layer = String(entity.layer ?? '')
    counts.set(layer, (counts.get(layer) ?? 0) + 1)
  }
  const warnings: string[] = []
  const records = layerRecords(database)
  if (records.length > LAYER_LIMIT) {
    warnings.push(`Drawing declares ${records.length} layers; only the first ${LAYER_LIMIT} are reported.`)
  }
  const layers: MLightCadLayerInfo[] = records.slice(0, LAYER_LIMIT).map((record) => ({
    name: String(record.name ?? ''),
    visible: !record.isOff && !record.isFrozen,
    frozen: Boolean(record.isFrozen),
    locked: Boolean(record.isLocked),
    color: colorText(record.color),
    entityCount: counts.get(String(record.name ?? '')) ?? 0,
  }))
  return { kind: 'layers', layers, warnings }
}

export function runDocumentInfo(
  manager: MLightDocumentManager,
  fileName: string,
  fontsNotFound: string[],
  measurement: DrawingMeasurement,
): MLightCadDocumentInfoRuntimeResult {
  const database = manager.curDocument.database
  const { extents, contentExtents, omittedEntityCount } = measurement
  const warnings: string[] = []
  if (!extents) warnings.push('Drawing has no measurable model-space extents.')
  if (contentExtents) {
    warnings.push(
      `The drawing occupies a small part of its extents: ${omittedEntityCount} `
      + 'entities sit outside the content area and are excluded from unframed renders.',
    )
  }
  return {
    kind: 'document_info',
    fileName,
    extents,
    contentExtents,
    entityCount: modelSpaceEntities(database).length,
    layerCount: layerRecords(database).length,
    fontsNotFound: [...fontsNotFound],
    warnings,
  }
}

export function runExportDxf(database: AcDbDatabase): MLightCadExportDxfRuntimeResult {
  const content = database.dxfOut(undefined, DXF_PRECISION)
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return {
    kind: 'export_dxf',
    dxfBase64: btoa(binary),
    byteLength: bytes.length,
    warnings: [],
  }
}

/**
 * Rasterizes the drawing through the stock PNG convertor.
 *
 * `convert` hands its finished canvas to `createFileAndDownloadIt`, which normally
 * clicks an anchor. Shadowing that method on the instance keeps every camera and
 * render-target detail from upstream while returning the pixels to the host instead.
 *
 * The call must be awaited: `convert` first waits for the scene to reach idle, so a
 * fire-and-forget call reads the canvas back before any pixels exist. Small drawings
 * hide this by settling within a microtask.
 */
export async function runRender(
  manager: MLightDocumentManager,
  operation: MLightCadRenderOperation,
  measurement: DrawingMeasurement,
): Promise<MLightCadRenderRuntimeResult> {
  const database = manager.curDocument.database
  const warnings: string[] = []
  const fallback = measurement.contentExtents ?? measurement.extents
  const window = operation.window ?? fallback
  if (!window) throw new Error('MLightCAD cannot render a drawing without measurable extents.')
  if (!operation.window && measurement.contentExtents) {
    warnings.push(
      `Framed the drawing's content area; ${measurement.omittedEntityCount} entities lie `
      + 'outside it and are not in this image.',
    )
  }

  const restoreLayers = operation.isolateLayers
    ? await isolateLayers(manager, database, operation.isolateLayers, warnings)
    : undefined

  let canvas: HTMLCanvasElement | undefined
  try {
    const convertor = new AcApPngConvertor()
    Reflect.set(convertor, 'createFileAndDownloadIt', (rendered: HTMLCanvasElement) => {
      canvas = rendered
    })
    await convertor.convert(toBox2d(window), operation.longSide)
  } finally {
    await restoreLayers?.()
  }
  if (!canvas) throw new Error('MLightCAD render produced no image.')
  const dataUrl = canvas.toDataURL('image/png')
  warnings.push(...await describeSolidFills(dataUrl))
  return {
    kind: 'render',
    pngBase64: dataUrlToBase64(dataUrl),
    width: canvas.width,
    height: canvas.height,
    window,
    warnings,
  }
}

/** Long side of the coarse grid the render is averaged down to before analysis. */
const FILL_GRID_LONG_SIDE = 64
/** Averaged cells at least this bright count as part of a solid light fill. */
const FILL_LUMINANCE = 248
/** Report a fill once its rectangle covers this share of the image. */
const FILL_AREA_RATIO = 0.05
/** Above this share the whole render is one flat surface, which is a different failure. */
const FLAT_IMAGE_RATIO = 0.9

/**
 * Reports large solid light rectangles in a finished render.
 *
 * Entity types the parser does not support — OLE frames around embedded spreadsheets are
 * the common case in construction sets — still occupy their extents, so they come out as
 * a filled rectangle with nothing inside it. The image is well-formed and full-size, so
 * neither the renderer nor the file size can tell it apart from a drawing that was read
 * correctly; only the pixels can. Averaging into a coarse grid first is what separates a
 * fill from real content: thin geometry and text average down towards the background,
 * while a solid block keeps its value.
 *
 * The analysis reads back the PNG rather than the source canvas because a WebGL drawing
 * buffer may already be gone by the time it is sampled.
 */
async function describeSolidFills(dataUrl: string): Promise<string[]> {
  const grid = await sampleLuminanceGrid(dataUrl)
  if (!grid) return []
  return describeSolidFillGrid(grid.cells, grid.width, grid.height)
}

/** Pure half of {@link describeSolidFills}, over the averaged luminance grid. */
export function describeSolidFillGrid(
  cells: readonly number[],
  width: number,
  height: number,
): string[] {
  if (cells.length !== width * height || cells.length === 0) return []
  const flat = cells.map((luminance) => luminance >= FILL_LUMINANCE)
  const flatRatio = flat.filter(Boolean).length / flat.length
  if (flatRatio >= FLAT_IMAGE_RATIO) {
    return [
      'The render is one uniform light surface with no discernible geometry. Treat it as '
      + 'failed rather than as an empty area of the drawing.',
    ]
  }
  const largest = largestTrueRectangle(flat, width, height)
  if (largest / flat.length < FILL_AREA_RATIO) return []
  return [
    `A solid light block covers about ${Math.round((largest / flat.length) * 100)}% of this `
    + 'image with no geometry inside it, which is how an entity type this engine cannot parse '
    + '(most often an OLE frame around an embedded spreadsheet) renders. The content behind it '
    + 'is not in this image and cannot be recovered from this engine; report it as a limitation '
    + 'and leave that region to AutoCAD.',
  ]
}

async function sampleLuminanceGrid(
  dataUrl: string,
): Promise<{ cells: number[]; width: number; height: number } | null> {
  const image = new Image()
  image.src = dataUrl
  try {
    await image.decode()
  } catch {
    return null
  }
  if (!image.naturalWidth || !image.naturalHeight) return null
  const scale = FILL_GRID_LONG_SIDE / Math.max(image.naturalWidth, image.naturalHeight)
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const surface = document.createElement('canvas')
  surface.width = width
  surface.height = height
  const context = surface.getContext('2d')
  if (!context) return null
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  const cells: number[] = []
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = (data[offset + 3] as number) / 255
    cells.push(alpha * (
      0.2126 * (data[offset] as number)
      + 0.7152 * (data[offset + 1] as number)
      + 0.0722 * (data[offset + 2] as number)
    ))
  }
  return { cells, width, height }
}

/** Area of the largest axis-aligned all-true rectangle, by histogram over row prefixes. */
function largestTrueRectangle(cells: boolean[], width: number, height: number): number {
  const heights = new Array<number>(width).fill(0)
  let best = 0
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      heights[column] = cells[row * width + column] ? (heights[column] as number) + 1 : 0
    }
    best = Math.max(best, largestHistogramRectangle(heights))
  }
  return best
}

function largestHistogramRectangle(heights: readonly number[]): number {
  const stack: number[] = []
  let best = 0
  for (let index = 0; index <= heights.length; index += 1) {
    const current = index === heights.length ? 0 : heights[index] as number
    while (stack.length > 0 && (heights[stack[stack.length - 1] as number] as number) >= current) {
      const top = stack.pop() as number
      const left = stack.length === 0 ? -1 : stack[stack.length - 1] as number
      best = Math.max(best, (heights[top] as number) * (index - left - 1))
    }
    stack.push(index)
  }
  return best
}

/**
 * Hides every layer except the requested ones for the duration of one render.
 *
 * Mutating `isOff` on the record is not enough: the scene graph only reacts through
 * `updateLayer`, and entities that were skipped while their layer was off have no
 * geometry until `convertMissingEntitiesOnLayer` rebuilds it.
 */
async function isolateLayers(
  manager: MLightDocumentManager,
  database: AcDbDatabase,
  visibleLayers: string[],
  warnings: string[],
): Promise<() => Promise<void>> {
  const view = manager.curView
  const wanted = new Set(visibleLayers.map((layer) => layer.toLowerCase()))
  const previous = new Map<MLightLayerRecord, boolean>()
  let matched = 0
  const revealed: string[] = []
  for (const record of layerRecords(database)) {
    const name = String(record.name ?? '')
    const isWanted = wanted.has(name.toLowerCase())
    if (isWanted) matched += 1
    const nextIsOff = !isWanted
    if (record.isOff === nextIsOff) continue
    previous.set(record, record.isOff)
    record.isOff = nextIsOff
    view.updateLayer(record, { isOff: nextIsOff })
    if (!nextIsOff) revealed.push(name)
  }
  for (const name of revealed) await view.convertMissingEntitiesOnLayer(name)
  if (matched === 0) warnings.push('None of the requested layers exist in this drawing.')
  else if (matched < wanted.size) {
    warnings.push(`Only ${matched} of ${wanted.size} requested layers exist in this drawing.`)
  }
  return async () => {
    const restored: string[] = []
    for (const [record, isOff] of previous) {
      record.isOff = isOff
      view.updateLayer(record, { isOff })
      if (!isOff) restored.push(String(record.name ?? ''))
    }
    for (const name of restored) await view.convertMissingEntitiesOnLayer(name)
  }
}

function buildEntity(shape: MLightCadDraftEntity['shape']): AcDbEntity {
  switch (shape.type) {
    case 'line':
      return new AcDbLine(
        { x: shape.from[0], y: shape.from[1], z: 0 },
        { x: shape.to[0], y: shape.to[1], z: 0 },
      )
    case 'circle':
      return new AcDbCircle({ x: shape.center[0], y: shape.center[1], z: 0 }, shape.radius)
    case 'arc':
      return new AcDbArc(
        { x: shape.center[0], y: shape.center[1], z: 0 },
        shape.radius,
        shape.startAngle,
        shape.endAngle,
      )
    case 'polyline': {
      const polyline = new AcDbPolyline()
      shape.points.forEach((point, index) => {
        polyline.addVertexAt(index, new AcGePoint2d(point[0], point[1]))
      })
      polyline.closed = shape.closed ?? false
      return polyline
    }
    case 'text': {
      const text = new AcDbMText()
      text.contents = shape.contents
      text.height = shape.height
      text.location = { x: shape.position[0], y: shape.position[1], z: 0 }
      if (shape.rotation) text.rotation = shape.rotation
      return text
    }
  }
}

/**
 * Adds layers and entities to the open document.
 *
 * Only ever reached through a private session, so the mutated database is discarded when
 * the call returns and no reader can observe it. The layer prefix is not re-checked here:
 * the host refuses a non-`XL-` layer before the request is ever sent, and duplicating the
 * rule in the renderer would let the two copies drift.
 *
 * Appends run inside an event batch so the viewer builds scene geometry once for the
 * whole set rather than per entity, which matters because a self-check render reads the
 * scene rather than the database.
 */
export function runMutate(
  database: AcDbDatabase,
  operation: MLightCadMutateOperation,
): MLightCadMutateRuntimeResult {
  const writable = database as unknown as MLightWritableDatabase
  const layerTable = writable.tables.layerTable
  const createdLayers: string[] = []
  const reusedLayers: string[] = []
  for (const layer of operation.layers) {
    if (layerTable.has(layer.name)) {
      reusedLayers.push(layer.name)
      continue
    }
    const color = new AcCmColor()
    if (layer.colorIndex !== undefined) color.colorIndex = layer.colorIndex
    layerTable.add(new AcDbLayerTableRecord({ name: layer.name, color }))
    createdLayers.push(layer.name)
  }

  const created: AcDbEntity[] = []
  const warnings: string[] = []
  writable.beginEventBatch()
  try {
    for (const entity of operation.entities) {
      const built = buildEntity(entity.shape)
      built.layer = entity.layer
      writable.tables.blockTable.modelSpace.appendEntity(built)
      created.push(built)
    }
  } finally {
    writable.endEventBatch()
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const entity of created) {
    try {
      const box = entity.geometricExtents
      if (box.isEmpty()) continue
      minX = Math.min(minX, box.min.x)
      minY = Math.min(minY, box.min.y)
      maxX = Math.max(maxX, box.max.x)
      maxY = Math.max(maxY, box.max.y)
    } catch {
      continue
    }
  }
  const measurable = Number.isFinite(minX) && Number.isFinite(minY) && maxX > minX && maxY > minY
  if (created.length > 0 && !measurable) {
    warnings.push('Added entities report no measurable extents; a framed self-check render is unavailable.')
  }
  return {
    kind: 'mutate',
    createdHandles: created.map((entity) => String(entity.objectId)),
    createdLayers,
    reusedLayers,
    addedExtents: measurable ? { min: [minX, minY], max: [maxX, maxY] } : null,
    warnings,
  }
}

export function runEntityPreview(
  database: AcDbDatabase,
  operation: MLightCadEntityPreviewOperation,
): MLightCadEntityPreviewRuntimeResult {
  const known = new Set<string>()
  for (const entity of modelSpaceEntities(database)) known.add(String(entity.objectId))
  const convertor = new AcApEntityPreviewConvertor()
  const images: MLightCadEntityPreviewImage[] = []
  const missingGroupIds: string[] = []
  const warnings: string[] = []
  for (const group of operation.groups) {
    const handles = group.handles.filter((handle) => known.has(handle))
    if (handles.length === 0) {
      missingGroupIds.push(group.id)
      continue
    }
    const capture = convertor.capture(handles, operation.longSide)
    if (!capture.ok) {
      missingGroupIds.push(group.id)
      if (warnings.length < 100) warnings.push(`Preview "${group.id}" failed: ${capture.reason}.`)
      continue
    }
    images.push({
      id: group.id,
      pngBase64: dataUrlToBase64(capture.dataUrl),
      matchedCount: capture.exportedCount,
      skippedCount: capture.skippedCount + (group.handles.length - handles.length),
    })
  }
  return { kind: 'entity_preview', images, missingGroupIds, warnings }
}
