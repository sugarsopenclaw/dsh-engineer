export const MLIGHT_CAD_RUNTIME_CHANNELS = {
  ready: 'mlight-cad-runtime:ready',
  request: 'mlight-cad-runtime:request',
  response: 'mlight-cad-runtime:response',
} as const

export interface MLightCadWindow {
  min: [number, number]
  max: [number, number]
}

export interface MLightCadExtractionFilters {
  layers?: string[]
  types?: string[]
  window?: MLightCadWindow
  textPattern?: string
  includeGeometry: boolean
  /** Defaults to model space. Database mode also reads layouts and block definitions. */
  scope?: 'model_space' | 'database'
  /** Defaults to false to preserve the product index's visible-content semantics. */
  includeInvisible?: boolean
  /** Defaults to false to preserve the product index's historical DEFPOINTS exclusion. */
  includeDefpoints?: boolean
}

/**
 * Opening a drawing is the expensive step, so a runtime window keeps the parsed
 * database alive and only re-opens when the host targets a different source.
 */
export interface MLightCadOpenSpec {
  fileName: string
  sourceUrl: string
  /**
   * Loads the default font fallback chain before parsing. Extraction reads text from
   * the database and does not need it; anything that rasterizes does, and the chain
   * must be resident before parse so glyph layout is not silently dropped.
   */
  loadFonts: boolean
  /**
   * Opens the document for modification. Only a private, non-pooled session may set it,
   * so a mutated database is never one a reader can be handed.
   */
  writable?: boolean
}

export interface MLightCadExtractOperation {
  kind: 'extract'
  filters: MLightCadExtractionFilters
}

export interface MLightCadRenderOperation {
  kind: 'render'
  longSide: number
  window?: MLightCadWindow
  /** When set, only these layers stay visible for the render. */
  isolateLayers?: string[]
}

export interface MLightCadEntityPreviewGroup {
  id: string
  handles: string[]
}

export interface MLightCadEntityPreviewOperation {
  kind: 'entity_preview'
  groups: MLightCadEntityPreviewGroup[]
  longSide: number
}

export interface MLightCadLayersOperation {
  kind: 'layers'
}

export interface MLightCadDocumentInfoOperation {
  kind: 'document_info'
}

export interface MLightCadExportDxfOperation {
  kind: 'export_dxf'
}

export type MLightCadPoint = [number, number]

/**
 * The shapes the drafter can author.
 *
 * Deliberately small: these cover annotation and simple plan geometry, and every one of
 * them survives `dxfOut` into a file AutoCAD reopens. Anything richer belongs in the
 * source drawing, not in an agent's markup layer.
 */
export type MLightCadDraftShape =
  | { type: 'line'; from: MLightCadPoint; to: MLightCadPoint }
  | { type: 'polyline'; points: MLightCadPoint[]; closed?: boolean }
  | { type: 'circle'; center: MLightCadPoint; radius: number }
  | { type: 'arc'; center: MLightCadPoint; radius: number; startAngle: number; endAngle: number }
  | { type: 'text'; position: MLightCadPoint; contents: string; height: number; rotation?: number }

export interface MLightCadDraftEntity {
  layer: string
  shape: MLightCadDraftShape
}

export interface MLightCadDraftLayer {
  name: string
  /** AutoCAD Color Index; omitted leaves the layer at the drawing's default. */
  colorIndex?: number
}

export interface MLightCadMutateOperation {
  kind: 'mutate'
  layers: MLightCadDraftLayer[]
  entities: MLightCadDraftEntity[]
}

export type MLightCadRuntimeOperation =
  | MLightCadExtractOperation
  | MLightCadRenderOperation
  | MLightCadEntityPreviewOperation
  | MLightCadLayersOperation
  | MLightCadDocumentInfoOperation
  | MLightCadExportDxfOperation
  | MLightCadMutateOperation

export interface MLightCadRuntimeRequest {
  id: string
  /** Present when the runtime must load (or reload) a drawing before the operation. */
  open?: MLightCadOpenSpec
  operation: MLightCadRuntimeOperation
}

export interface MLightCadExtractionRuntimeResult {
  kind: 'extract'
  rawJsonl: string
  readableMarkdown: string
  summary: Record<string, unknown>
  warnings: string[]
}

export interface MLightCadRenderRuntimeResult {
  kind: 'render'
  pngBase64: string
  width: number
  height: number
  window: MLightCadWindow | null
  warnings: string[]
}

export interface MLightCadEntityPreviewImage {
  id: string
  pngBase64: string
  matchedCount: number
  skippedCount: number
}

export interface MLightCadEntityPreviewRuntimeResult {
  kind: 'entity_preview'
  images: MLightCadEntityPreviewImage[]
  missingGroupIds: string[]
  warnings: string[]
}

export interface MLightCadLayerInfo {
  name: string
  visible: boolean
  frozen: boolean
  locked: boolean
  color: string | null
  entityCount: number
}

export interface MLightCadLayersRuntimeResult {
  kind: 'layers'
  layers: MLightCadLayerInfo[]
  warnings: string[]
}

export interface MLightCadDocumentInfoRuntimeResult {
  kind: 'document_info'
  fileName: string
  extents: MLightCadWindow | null
  /**
   * The area the drawing actually occupies, when strays make `extents` far larger.
   * Null when the two agree, so a caller can treat non-null as "this drawing needs
   * framing" rather than comparing boxes itself.
   */
  contentExtents: MLightCadWindow | null
  entityCount: number
  layerCount: number
  fontsNotFound: string[]
  warnings: string[]
}

export interface MLightCadExportDxfRuntimeResult {
  kind: 'export_dxf'
  dxfBase64: string
  byteLength: number
  warnings: string[]
}

export interface MLightCadMutateRuntimeResult {
  kind: 'mutate'
  /** Handles of the entities that were added, in the order they were requested. */
  createdHandles: string[]
  createdLayers: string[]
  reusedLayers: string[]
  /** Extents of the added entities alone, for framing a self-check render. */
  addedExtents: MLightCadWindow | null
  warnings: string[]
}

export type MLightCadRuntimeResult =
  | MLightCadExtractionRuntimeResult
  | MLightCadRenderRuntimeResult
  | MLightCadEntityPreviewRuntimeResult
  | MLightCadLayersRuntimeResult
  | MLightCadDocumentInfoRuntimeResult
  | MLightCadExportDxfRuntimeResult
  | MLightCadMutateRuntimeResult

export interface MLightCadRuntimeResponse {
  id: string
  ok: boolean
  result?: MLightCadRuntimeResult
  error?: string
}

export interface MLightCadRuntimeBridge {
  register(handler: (request: MLightCadRuntimeRequest) => Promise<MLightCadRuntimeResult>): () => void
}
