import sampleCadSession from './fixtures/sample-cad-session.json'
import type { CadRuntimeService } from '../contracts/cad-runtime-service'
import type {
  CadAnnotationReadResult,
  CadCaptureHint,
  CadCompositeBatchReadResult,
  CadCompositeRegionExtractResult,
  CadDocumentSnapshot,
  CadEntityCollectionSnapshot,
  CadEntitySnapshot,
  CadGeometryAreaResult,
  CadGeometryBoundingBoxResult,
  CadGeometryDistanceResult,
  CadGeometryLengthResult,
  CadDrawingScanResult,
  CadSelectionSnapshot,
  CadSessionDiff,
  CadSpatialQueryResult,
  CadTextSearchResult,
  CadTextReadResult,
  CadPoint,
  CadWindow,
} from '../contracts/cad-dto'

const fixtureSession = sampleCadSession as CadSessionDiff
const fixtureDocument = sampleCadSession.activeDocument as CadDocumentSnapshot
const fixtureCaptureHint = sampleCadSession.captureHint as CadCaptureHint

const fixtureSelection = {
  docName: 'sample-foundation.dwg',
  count: 2,
  handles: ['1A2B', '1A2C'],
  entities: sampleCadSession.recentEntityRefs,
  summary: {
    total: 2,
    polylines: 1,
    texts: 1,
  },
} satisfies CadSelectionSnapshot

const fixtureEntityCollection = {
  docName: 'sample-foundation.dwg',
  entities: [
    {
      handle: '1A2B',
      objectName: 'AcDbPolyline',
      layer: '基础轮廓',
      summary: 'AcDbPolyline @基础轮廓 1A2B',
      data: {
        area: 24.5,
      },
    },
    {
      handle: '1A2C',
      objectName: 'AcDbText',
      layer: '基础标注',
      summary: 'AcDbText @基础标注 1A2C',
      data: {
        text: '独立基础 J-1',
      },
    },
  ],
  summary: {
    total: 2,
  },
  texts: ['独立基础 J-1'],
} satisfies CadEntityCollectionSnapshot

const fixtureTextResult = {
  docName: 'sample-foundation.dwg',
  texts: ['独立基础 J-1'],
  textCount: 1,
  totalObjects: 2,
} satisfies CadTextReadResult

const fixtureAnnotationTextResult = {
  docName: 'sample-foundation.dwg',
  items: fixtureEntityCollection.entities.filter((entity) => entity.objectName === 'AcDbText'),
  count: 1,
} satisfies CadAnnotationReadResult

const fixtureAnnotationDimensionResult = {
  docName: 'sample-foundation.dwg',
  items: [],
  count: 0,
} satisfies CadAnnotationReadResult

const fixtureAnnotationTableResult = {
  docName: 'sample-foundation.dwg',
  items: [],
  count: 0,
} satisfies CadAnnotationReadResult

const fixtureTextSearchResult = {
  docName: 'sample-foundation.dwg',
  pattern: '基础',
  regex: false,
  matches: [
    {
      handle: '1A2C',
      layer: '基础标注',
      content: '独立基础 J-1',
      entity: fixtureEntityCollection.entities[1],
    },
  ],
  count: 1,
} satisfies CadTextSearchResult

const fixtureSpatialQueryResult = {
  count: 1,
  entities: [fixtureEntityCollection.entities[0]],
} satisfies CadSpatialQueryResult

const fixtureGeometryDistanceResult = {
  distance: 5,
} satisfies CadGeometryDistanceResult

const fixtureGeometryAreaResult = {
  handle: '1A2B',
  area: 24.5,
} satisfies CadGeometryAreaResult

const fixtureGeometryLengthResult = {
  handle: '1A2B',
  length: 19.2,
} satisfies CadGeometryLengthResult

const fixtureGeometryBoundingBoxResult = {
  handles: ['1A2B'],
  min: { x: 0, y: 0 },
  max: { x: 10, y: 8 },
} satisfies CadGeometryBoundingBoxResult

const fixtureDrawingScanResult = {
  docName: 'sample-foundation.dwg',
  docPath: 'C:/cad/sample-foundation.dwg',
  isSaved: true,
  extents: {
    min: { x: 0, y: 0 },
    max: { x: 100, y: 100 },
  },
  layers: [{ name: '基础轮廓', isOn: true, isFrozen: false, entityCount: 1 }],
  entityStats: {
    byType: { polyline: 1, text: 1 },
    byLayer: { 基础轮廓: 1, 基础标注: 1 },
    total: 2,
  },
} satisfies CadDrawingScanResult

const fixtureRegionExtractResult = {
  window: {
    min: { x: 0, y: 0 },
    max: { x: 20, y: 20 },
  },
  entities: fixtureEntityCollection.entities,
  count: fixtureEntityCollection.entities.length,
  texts: fixtureEntityCollection.entities.filter((entity) => entity.objectName === 'AcDbText'),
  dimensions: [],
  screenshot: {
    imageBase64: 'fixture',
    mimeType: 'image/png',
  },
} satisfies CadCompositeRegionExtractResult

const fixtureBatchReadResult = {
  items: [
    {
      handle: '1A2B',
      entity: fixtureEntityCollection.entities[0],
      nearby: fixtureEntityCollection,
    },
  ],
  errors: [],
} satisfies CadCompositeBatchReadResult

export function createFakeCadRuntimeService(): CadRuntimeService {
  return {
    session: {
      connect: async () => ({
        connected: true,
        docName: 'sample-foundation.dwg',
        version: '2025',
      }),
      status: async () => ({
        connected: true,
        docName: 'sample-foundation.dwg',
      }),
      getDiffSnapshot: () => fixtureSession,
      reset: () => undefined,
    },
    document: {
      getActive: async () => fixtureDocument,
      list: async () => [{
        name: fixtureDocument.name,
        path: fixtureDocument.path,
        active: true,
      }],
      open: async () => fixtureDocument,
      switch: async () => fixtureDocument,
      plotLayoutToPdf: async (_layout: string | undefined, outputPath: string) => ({
        ok: true,
        path: outputPath,
      }),
    },
    selection: {
      readCurrent: async () => fixtureSelection,
      selectWindow: async (_window: CadWindow) => fixtureSelection,
      selectByHandle: async (handle: string) => ({
        ...fixtureSelection,
        count: 1,
        handles: [handle],
        entities: fixtureSelection.entities.filter((entity) => entity.handle === handle),
      }),
      clear: async () => ({
        ...fixtureSelection,
        count: 0,
        handles: [],
        entities: [],
      }),
      nearby: async (_point: CadPoint, _radius: number) => fixtureSpatialQueryResult,
      nearest: async (_point: CadPoint) => fixtureSpatialQueryResult,
    },
    view: {
      getCurrent: async () => ({
        center: { x: 10, y: 10 },
        viewSize: 20,
        screenSize: { width: 1600, height: 1100 },
        window: { min: { x: -4.5, y: 0 }, max: { x: 24.5, y: 20 } },
        docName: 'sample-foundation.dwg',
      }),
      zoomWindow: async (_window: CadWindow) => undefined,
      zoomExtents: async () => undefined,
      zoomCenter: async () => undefined,
      pan: async () => undefined,
      regen: async () => undefined,
      ensureModelSpace: async () => ({ ok: true, activeLayout: 'Model', warnings: [] }),
    },
    entities: {
      extractSelection: async () => fixtureEntityCollection,
      extractWindow: async (_window: CadWindow) => fixtureEntityCollection,
      getByHandle: async (handle: string) =>
        fixtureEntityCollection.entities.find((entity) => entity.handle === handle) ??
        ({
          handle,
          objectName: 'AcDbEntity',
          summary: handle,
          data: {},
        } satisfies CadEntitySnapshot),
      readText: async () => fixtureTextResult,
      readByFilter: async (
        _filter: Record<string, unknown>,
        _options?: {
          onProgress?: (progress: { scanned: number; total: number }) => void
          timeoutMs?: number
          progressInterval?: number
          signal?: AbortSignal
          terminateOnAbort?: boolean
        },
      ) => fixtureEntityCollection,
      readReadableIndex: async (
        _options?: {
          onProgress?: (progress: { scanned: number; total: number }) => void
          timeoutMs?: number
          progressInterval?: number
          signal?: AbortSignal
          terminateOnAbort?: boolean
        },
      ) => fixtureEntityCollection,
      readByPolygon: async (_points: CadPoint[]) => fixtureEntityCollection,
    },
    annotations: {
      readAllText: async () => fixtureAnnotationTextResult,
      readAllDimensions: async () => fixtureAnnotationDimensionResult,
      readAllTables: async () => fixtureAnnotationTableResult,
      findText: async (pattern: string, options?: { regex?: boolean }) => ({
        ...fixtureTextSearchResult,
        pattern,
        regex: Boolean(options?.regex),
      }),
      findTextPlus: async (pattern: string, options?: { regex?: boolean; caseSensitive?: boolean; normalized?: boolean }) => ({
        docName: 'sample-foundation.dwg',
        pattern,
        regex: Boolean(options?.regex),
        caseSensitive: Boolean(options?.caseSensitive),
        normalized: options?.normalized !== false,
        scanned: 3,
        sourceCounts: { text: 1, dimension: 1, table_cell: 1 },
        matches: fixtureTextSearchResult.matches.map((match, index) => ({
          ...match,
          objectName: match.entity?.objectName,
          source: index === 0 ? 'text' : 'dimension',
          bbox: { min: { x: index * 10, y: index * 10 }, max: { x: index * 10 + 2, y: index * 10 + 1 } },
          point: { x: index * 10 + 1, y: index * 10 + 0.5 },
          score: 5 - index,
        })),
        count: fixtureTextSearchResult.matches.length,
      }),
    },
    geometry: {
      distancePointPoint: async () => fixtureGeometryDistanceResult,
      areaByHandle: async (handle: string) => ({ ...fixtureGeometryAreaResult, handle }),
      lengthByHandle: async (handle: string) => ({ ...fixtureGeometryLengthResult, handle }),
      boundingBoxByHandles: async (handles: string[]) => ({ ...fixtureGeometryBoundingBoxResult, handles }),
    },
    composite: {
      scanDrawing: async () => fixtureDrawingScanResult,
      regionExtract: async (window: CadWindow) => ({ ...fixtureRegionExtractResult, window }),
      batchRead: async () => fixtureBatchReadResult,
    },
    capture: {
      getHint: async () => fixtureCaptureHint,
      captureCadWindow: async () => ({
        success: true,
        sourceId: 'window:autocad',
        sourceName: 'sample-foundation.dwg - AutoCAD',
        thumbnailDataUrl: 'data:image/png;base64,fixture',
        docName: 'sample-foundation.dwg',
        imageHash: 'fixture-hash',
        screenshotMetrics: {
          width: 1600,
          height: 1100,
          meanBrightness: 245,
          brightnessVariance: 900,
          blackRatio: 0.01,
          whiteRatio: 0.7,
          nearWhiteRatio: 0.8,
          nearBlackRatio: 0.02,
          byteLength: 7,
        },
        capturedAt: '2026-04-17T10:00:00.000Z',
      }),
      captureRegion: async () => ({
        success: true,
        sourceId: 'window:autocad-region',
        sourceName: 'sample-foundation.dwg - CAD 区域',
        thumbnailDataUrl: 'data:image/png;base64,fixture',
        docName: 'sample-foundation.dwg',
        imageHash: 'fixture-region-hash',
        screenshotMetrics: {
          width: 1600,
          height: 1100,
          meanBrightness: 245,
          brightnessVariance: 900,
          blackRatio: 0.01,
          whiteRatio: 0.7,
          nearWhiteRatio: 0.8,
          nearBlackRatio: 0.02,
          inkRatio: 0.05,
          byteLength: 7,
        },
        capturedAt: '2026-04-17T10:00:00.000Z',
      }),
      plotRegion: async () => ({
        success: true,
        sourceId: 'autocad-plot',
        sourceName: 'sample-foundation.dwg - AutoCAD 出图区域',
        captureMethod: 'autocad-plot',
        thumbnailDataUrl: 'data:image/png;base64,fixture',
        docName: 'sample-foundation.dwg',
        imageHash: 'fixture-plot-hash',
        screenshotMetrics: {
          width: 1600,
          height: 1100,
          meanBrightness: 245,
          brightnessVariance: 900,
          blackRatio: 0.01,
          whiteRatio: 0.7,
          nearWhiteRatio: 0.8,
          nearBlackRatio: 0.02,
          inkRatio: 0.08,
          byteLength: 7,
        },
        capturedAt: '2026-04-17T10:00:00.000Z',
      }),
    },
    collections: {
      listLayers: async () => [
        { name: '基础轮廓', color: 1, isOn: true, isFrozen: false, isLocked: false },
      ],
      listLayouts: async () => [{ name: 'Model', modelType: true, tabOrder: 0 }],
      listBlocks: async () => [{ name: '*Model_Space', isLayout: true, isXRef: false, itemCount: 0 }],
    },
    variables: {
      get: async (name: string) => ({ name, value: 1 }),
      set: async () => {
        throw new Error('Not implemented')
      },
    },
    commands: {
      send: async () => {
        throw new Error('Not implemented')
      },
    },
    editing: {
      updateEntity: async () => {
        throw new Error('Not implemented')
      },
    },
    events: {
      subscribe: async () => {
        throw new Error('Not implemented')
      },
    },
  }
}
