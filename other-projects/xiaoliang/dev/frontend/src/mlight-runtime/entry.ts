import type {
  MLightCadRuntimeRequest,
  MLightCadRuntimeResult,
} from '../shared/mlight-cad-runtime'
import { createMLightCadArtifacts } from './extract'
import { AcApDocManager, AcApOpenViewMode, AcEdOpenMode, eventBus } from './mlight-simple-viewer'
import {
  measureDrawing,
  runDocumentInfo,
  type DrawingMeasurement,
  runEntityPreview,
  runExportDxf,
  runLayers,
  runMutate,
  runRender,
} from './operations'
import './runtime.css'

const root = document.getElementById('mlight-runtime-root')
if (!root) throw new Error('MLightCAD runtime root is missing.')
if (!window.mlightCadRuntime) throw new Error('MLightCAD runtime preload bridge is missing.')

const assetRoot = new URL('./assets/', window.location.href)
const cadDataBaseUrl = new URLSearchParams(window.location.search).get('cadDataBaseUrl')
if (!cadDataBaseUrl) throw new Error('MLightCAD runtime was launched without a cad-data base URL.')

const createdManager = AcApDocManager.createInstance({
  container: root,
  width: 1,
  height: 1,
  autoResize: false,
  baseUrl: cadDataBaseUrl.endsWith('/') ? cadDataBaseUrl : `${cadDataBaseUrl}/`,
  useMainThreadDraw: true,
  preloadDefaultFonts: false,
  builtinOpenFileDialog: false,
  webworkerFileUrls: {
    dwgParser: new URL('libredwg-parser-worker.js', assetRoot),
    mtextRender: new URL('mtext-renderer-worker.js', assetRoot),
  },
})
if (!createdManager) throw new Error('MLightCAD document manager could not be created.')
const manager = createdManager

const fontsNotFound = new Set<string>()
eventBus.on('fonts-not-found', (payload: unknown) => {
  const fonts = (payload as { fonts?: unknown })?.fonts
  if (Array.isArray(fonts)) for (const font of fonts) fontsNotFound.add(String(font))
})

interface LoadedDocument {
  fileName: string
  parseDurationMs: number
  measurement?: DrawingMeasurement
}

let loaded: LoadedDocument | undefined
let defaultFontsLoaded = false

async function openDocument(spec: NonNullable<MLightCadRuntimeRequest['open']>): Promise<void> {
  if (spec.loadFonts && !defaultFontsLoaded) {
    // Glyph outlines have to be resident before parse; loading them afterwards
    // leaves already-laid-out text without shapes.
    await manager.loadDefaultFonts()
    defaultFontsLoaded = true
  }
  loaded = undefined
  const parseStarted = performance.now()
  const response = await fetch(spec.sourceUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`MLightCAD source returned HTTP ${response.status}.`)
  const opened = await manager.openDocument(spec.fileName, await response.arrayBuffer(), {
    mode: spec.writable ? AcEdOpenMode.Write : AcEdOpenMode.Read,
    openViewMode: AcApOpenViewMode.Saved,
    drawNoPlotLayers: true,
    progressiveRendering: false,
  })
  if (!opened) throw new Error('MLightCAD could not open the drawing.')
  loaded = {
    fileName: spec.fileName,
    parseDurationMs: Math.round((performance.now() - parseStarted) * 10) / 10,
  }
}

function currentMeasurement(document: LoadedDocument): DrawingMeasurement {
  document.measurement ??= measureDrawing(manager.curDocument.database)
  return document.measurement
}

const unregister = window.mlightCadRuntime.register(
  async (request: MLightCadRuntimeRequest): Promise<MLightCadRuntimeResult> => {
    if (request.open) await openDocument(request.open)
    const document = loaded
    if (!document) throw new Error('MLightCAD runtime has no open drawing.')
    const database = manager.curDocument.database
    switch (request.operation.kind) {
      case 'extract':
        return createMLightCadArtifacts(
          database,
          document.fileName,
          request.operation.filters,
          document.parseDurationMs,
        )
      case 'document_info':
        return runDocumentInfo(manager, document.fileName, [...fontsNotFound], currentMeasurement(document))
      case 'layers':
        return runLayers(database)
      case 'render':
        return await runRender(manager, request.operation, currentMeasurement(document))
      case 'entity_preview':
        return runEntityPreview(database, request.operation)
      case 'export_dxf':
        return runExportDxf(database)
      case 'mutate': {
        const result = runMutate(database, request.operation)
        // The drawing just grew, so the cached extents would frame a later render off
        // the pre-edit bounds and clip whatever was added outside them.
        document.measurement = undefined
        return result
      }
    }
  },
)

window.addEventListener('beforeunload', () => {
  unregister()
  void manager.destroy()
})
