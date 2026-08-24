export interface CadPoint {
  x: number
  y: number
  z?: number
}

export interface CadWindow {
  min: CadPoint
  max: CadPoint
}

export interface CadConnectionStatus {
  connected: boolean
  docName?: string
  version?: string
}

export interface CadDocumentSnapshot {
  name: string
  fullName?: string
  path?: string
  activeLayoutName?: string
  space: 'model' | 'paper' | 'unknown'
  version?: string
  isSaved?: boolean
}

export interface CadDocumentListItem {
  name: string
  path?: string
  active: boolean
}

export interface CadViewState {
  center?: CadPoint
  window?: CadWindow
  magnify?: number
  source: 'document' | 'zoom_window' | 'zoom_center' | 'zoom_extents' | 'pan' | 'regen' | 'current'
  summary: string
}

export interface CadCurrentViewState {
  center?: CadPoint
  viewSize?: number
  screenSize?: { width: number; height: number }
  window?: CadWindow
  docName?: string
}

export interface CadEntityRef {
  handle: string
  objectName: string
  layer?: string
  summary?: string
}

export interface CadEntitySnapshot extends CadEntityRef {
  data: Record<string, unknown>
}

export interface CadEntityCollectionSnapshot {
  docName?: string
  entities: CadEntitySnapshot[]
  summary: Record<string, unknown>
  texts: string[]
  window?: CadWindow
}

export interface CadSelectionSnapshot {
  docName?: string
  count: number
  handles: string[]
  entities: CadEntityRef[]
  summary?: Record<string, unknown>
}

export interface CadTextReadResult {
  docName?: string
  texts: string[]
  textCount: number
  totalObjects?: number
}

export interface CadAnnotationReadResult {
  docName?: string
  items: CadEntitySnapshot[]
  count: number
}

export interface CadTextMatchSnapshot {
  handle?: string
  layer?: string
  content: string
  entity?: CadEntitySnapshot
}

export interface CadTextSearchResult {
  docName?: string
  pattern: string
  regex: boolean
  matches: CadTextMatchSnapshot[]
  count: number
}

export interface CadTextPlusMatchSnapshot extends CadTextMatchSnapshot {
  objectName?: string
  source?: string
  subPath?: string
  label?: string
  bbox?: CadWindow
  point?: CadPoint
  score?: number
}

export interface CadTextPlusSearchResult {
  docName?: string
  pattern: string
  regex: boolean
  caseSensitive: boolean
  normalized: boolean
  scanned?: number
  sourceCounts: Record<string, number>
  matches: CadTextPlusMatchSnapshot[]
  count: number
}

export interface CadLayerSummary {
  name: string
  color?: number
  isOn?: boolean
  isFrozen?: boolean
  isLocked?: boolean
}

export interface CadLayoutSummary {
  name: string
  modelType?: boolean
  tabOrder?: number
}

export interface CadBlockSummary {
  name: string
  isLayout?: boolean
  isXRef?: boolean
  itemCount?: number
}

export interface CadVariableSnapshot {
  name: string
  value: unknown
}

export interface CadScreenBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CadCaptureHint {
  source: 'autocad-window'
  preferredWindowTitle: string
  windowTitleCandidates: string[]
  docName?: string
  windowBounds?: CadScreenBounds
  clientBounds?: CadScreenBounds
}

export type CadCaptureMethod =
  | 'autocad-plot'
  | 'win32-viewport'
  | 'electron-window'
  | 'electron-screen-crop'

export type CadPlotVariant = 'color' | 'mono' | 'both'
export type CadPlotProfile = 'overview' | 'region' | 'fine' | 'table' | 'detail'
export type CadPlotFitMode = 'max' | 'contain'

export interface CadCaptureImageVariant {
  thumbnailDataUrl?: string
  thumbnailWidth?: number
  thumbnailHeight?: number
  mimeType?: string
  imageHash?: string
  screenshotMetrics?: CadScreenshotMetrics
}

export interface CadCaptureAttempt {
  method: CadCaptureMethod
  success: boolean
  valid?: boolean
  sourceName?: string
  warning?: string
  error?: string
  imageHash?: string
  screenshotMetrics?: CadScreenshotMetrics
  capturedAt: string
}

export interface CadCaptureResult {
  success: boolean
  sourceId?: string
  sourceName?: string
  captureMethod?: CadCaptureMethod
  thumbnailDataUrl?: string
  thumbnailWidth?: number
  thumbnailHeight?: number
  docName?: string
  error?: string
  warning?: string
  imageHash?: string
  imageVariants?: Record<string, CadCaptureImageVariant>
  screenshotMetrics?: CadScreenshotMetrics
  captureAttempts?: CadCaptureAttempt[]
  capturedAt: string
}

export interface CadScreenshotMetrics {
  width?: number
  height?: number
  sourceWidth?: number
  sourceHeight?: number
  rasterWidth?: number
  rasterHeight?: number
  cropWidth?: number
  cropHeight?: number
  outputContentWidth?: number
  outputContentHeight?: number
  paddingLeft?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  fitScale?: number
  contentAreaRatio?: number
  cropAreaRatio?: number
  meanBrightness?: number
  brightnessVariance?: number
  blackRatio?: number
  whiteRatio?: number
  nearWhiteRatio?: number
  nearBlackRatio?: number
  // 墨迹/边缘像素占比：估计图纸线条/文字密度，用于识别"空白绘图区"
  inkRatio?: number
  byteLength?: number
  pdfDpi?: number
  pdfBytes?: number
  plotAttemptCount?: number
  plotValidAttemptCount?: number
  plotStrategy?: string
  fitMode?: string
  traceDir?: string | null
  tracePdfPath?: string | null
  pdfPath?: string | null
  plotPdfExtensionSuppressed?: boolean
}

export interface CadGeometryDistanceResult {
  distance: number
}

export interface CadGeometryAreaResult {
  handle: string
  area: number
}

export interface CadGeometryLengthResult {
  handle: string
  length: number
}

export interface CadGeometryBoundingBoxResult {
  handles: string[]
  min: CadPoint
  max: CadPoint
}

export interface CadCompositeScreenshotResult {
  imageBase64?: string
  mimeType?: string
  width?: number
  height?: number
}

export interface CadDrawingScanLayerSummary {
  name: string
  isOn?: boolean
  isFrozen?: boolean
  entityCount?: number
}

export interface CadDrawingScanResult {
  docName?: string
  docPath?: string
  isSaved?: boolean
  extents?: CadWindow
  layers: CadDrawingScanLayerSummary[]
  entityStats: {
    byType: Record<string, number>
    byLayer: Record<string, number>
    total: number
  }
}

export interface CadCompositeRegionExtractResult {
  window: CadWindow
  entities: CadEntitySnapshot[]
  count: number
  texts: CadEntitySnapshot[]
  dimensions: CadEntitySnapshot[]
  screenshot?: CadCompositeScreenshotResult
}

export interface CadCompositeBatchReadItem {
  handle: string
  entity: CadEntitySnapshot | null
  nearby?: CadEntityCollectionSnapshot
}

export interface CadCompositeBatchReadError {
  handle: string
  error: string
}

export interface CadCompositeBatchReadResult {
  items: CadCompositeBatchReadItem[]
  errors: CadCompositeBatchReadError[]
}

export interface CadSpatialQueryResult {
  count: number
  entities: CadEntitySnapshot[]
}

export interface CadSessionDiff {
  activeDocument?: CadDocumentSnapshot | null
  space?: CadDocumentSnapshot['space']
  selectionHandles?: string[]
  recentEntityRefs?: CadEntityRef[]
  viewSummary?: string
  captureHint?: CadCaptureHint | null
  updatedAt: string
}
