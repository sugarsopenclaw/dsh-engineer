import type {
  CadAnnotationReadResult,
  CadCaptureHint,
  CadPlotFitMode,
  CadCaptureResult,
  CadPlotProfile,
  CadPlotVariant,
  CadBlockSummary,
  CadCompositeBatchReadResult,
  CadCompositeRegionExtractResult,
  CadConnectionStatus,
  CadCurrentViewState,
  CadDocumentListItem,
  CadDocumentSnapshot,
  CadDrawingScanResult,
  CadEntityCollectionSnapshot,
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
  CadSessionDiff,
  CadTextSearchResult,
  CadTextPlusSearchResult,
  CadTextReadResult,
  CadVariableSnapshot,
  CadWindow,
} from './cad-dto'
import type { CadRpcProgress } from './cad-protocol'

export interface CadRuntimeService {
  session: {
    connect(): Promise<CadConnectionStatus>
    status(): Promise<CadConnectionStatus>
    getDiffSnapshot(): CadSessionDiff | null
    reset(): void
  }
  document: {
    getActive(): Promise<CadDocumentSnapshot>
    list(): Promise<CadDocumentListItem[]>
    open(path: string): Promise<CadDocumentSnapshot>
    switch(name: string): Promise<CadDocumentSnapshot>
    plotLayoutToPdf(layout: string | undefined, outputPath: string): Promise<{ ok: boolean; path: string }>
  }
  selection: {
    readCurrent(): Promise<CadSelectionSnapshot>
    selectWindow(window: CadWindow): Promise<CadSelectionSnapshot>
    selectByHandle(handle: string): Promise<CadSelectionSnapshot>
    clear(): Promise<CadSelectionSnapshot>
    nearby(point: CadPoint, radius: number, options?: { layers?: string[]; types?: string[] }): Promise<CadSpatialQueryResult>
    nearest(point: CadPoint, options?: { types?: string[]; count?: number }): Promise<CadSpatialQueryResult>
  }
  view: {
    getCurrent(): Promise<CadCurrentViewState>
    zoomWindow(window: CadWindow): Promise<void>
    zoomExtents(): Promise<void>
    zoomCenter(center: CadPoint, magnify?: number): Promise<void>
    pan(offset: CadPoint): Promise<void>
    regen(): Promise<void>
    ensureModelSpace(): Promise<{ ok: boolean; activeLayout?: string; warnings: string[] }>
  }
  entities: {
    extractSelection(): Promise<CadEntityCollectionSnapshot>
    extractWindow(window: CadWindow): Promise<CadEntityCollectionSnapshot>
    getByHandle(handle: string): Promise<CadEntitySnapshot>
    readText(): Promise<CadTextReadResult>
    readByFilter(
      filter: Record<string, unknown>,
      options?: {
        onProgress?: (progress: CadRpcProgress) => void
        timeoutMs?: number
        progressInterval?: number
        signal?: AbortSignal
        terminateOnAbort?: boolean
      },
    ): Promise<CadEntityCollectionSnapshot>
    readReadableIndex(
      options?: {
        onProgress?: (progress: CadRpcProgress) => void
        timeoutMs?: number
        progressInterval?: number
        signal?: AbortSignal
        terminateOnAbort?: boolean
      },
    ): Promise<CadEntityCollectionSnapshot>
    readByPolygon(points: CadPoint[]): Promise<CadEntityCollectionSnapshot>
  }
  annotations: {
    readAllText(options?: { layers?: string[]; clean?: boolean }): Promise<CadAnnotationReadResult>
    readAllDimensions(options?: { layers?: string[] }): Promise<CadAnnotationReadResult>
    readAllTables(options?: { layers?: string[] }): Promise<CadAnnotationReadResult>
    findText(
      pattern: string,
      options?: { regex?: boolean; limit?: number; maxEntitiesScanned?: number },
    ): Promise<CadTextSearchResult>
    findTextPlus(
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
    ): Promise<CadTextPlusSearchResult>
  }
  geometry: {
    distancePointPoint(p1: CadPoint, p2: CadPoint): Promise<CadGeometryDistanceResult>
    areaByHandle(handle: string): Promise<CadGeometryAreaResult>
    lengthByHandle(handle: string): Promise<CadGeometryLengthResult>
    boundingBoxByHandles(handles: string[]): Promise<CadGeometryBoundingBoxResult>
  }
  composite: {
    scanDrawing(options?: { maxEntities?: number }): Promise<CadDrawingScanResult>
    regionExtract(
      window: CadWindow,
      options?: {
        layers?: string[]
        types?: string[]
        width?: number
        height?: number
      },
    ): Promise<CadCompositeRegionExtractResult>
    batchRead(
      handles: string[],
      options?: { includeNearby?: boolean },
    ): Promise<CadCompositeBatchReadResult>
  }
  capture: {
    getHint(): Promise<CadCaptureHint>
    captureCadWindow(options?: { thumbnailWidth?: number; thumbnailHeight?: number }): Promise<CadCaptureResult>
    captureRegion(window: CadWindow, options?: { thumbnailWidth?: number; thumbnailHeight?: number }): Promise<CadCaptureResult>
    plotRegion(
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
    ): Promise<CadCaptureResult>
  }
  collections: {
    listLayers(): Promise<CadLayerSummary[]>
    listLayouts(): Promise<CadLayoutSummary[]>
    listBlocks(): Promise<CadBlockSummary[]>
  }
  variables: {
    get(name: string): Promise<CadVariableSnapshot>
    set(name: string, value: unknown): Promise<never>
  }
  commands: {
    send(command: string): Promise<never>
  }
  editing: {
    updateEntity(handle: string, patch: Record<string, unknown>): Promise<never>
  }
  events: {
    subscribe(eventName: string): Promise<never>
  }
}
