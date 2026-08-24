import {
  AcApDocManager,
  AcApI18n,
  AcApOpenViewMode,
  AcEdOpenMode,
  eventBus,
} from '@mlightcad/cad-simple-viewer'
import { registerLazyHtmlPlugin } from '@mlightcad/cad-html-plugin/register'
import { registerLazyPdfPlugin } from '@mlightcad/cad-pdf-plugin/register'
import { registerSimpleUiPlugin } from '@mlightcad/cad-simple-ui-plugin/register'
import { registerLazySvgPlugin } from '@mlightcad/cad-svg-plugin/register'
import htmlViewerRuntimeUrl from '@mlightcad/cad-html-plugin/viewer-runtime?url'

import {
  CAD_PREVIEW_RUNTIME_CHANNEL,
  isCadPreviewOpenRequest,
  type CadPreviewOpenRequest,
  type CadPreviewRuntimeMessage,
} from '../shared/cad-preview-runtime'
import './runtime.css'

const root = document.getElementById('cad-preview-root')
if (!root) throw new Error('CAD preview root is missing.')
const host = root

const assetRoot = new URL('./assets/', window.location.href)

function post(message: CadPreviewRuntimeMessage): void {
  window.parent.postMessage(message, '*')
}

/**
 * Every font the drawing asked for that the self-hosted corpus could not answer.
 * Surfaced to the panel so a drawing rendering with substituted glyphs says so
 * instead of quietly looking wrong.
 *
 * Handlers are annotated by hand because upstream keeps `mitt` as a dev-only
 * dependency, which leaves `eventBus` untyped once it is bundled.
 */
const fontsNotFound = new Set<string>()
eventBus.on('fonts-not-found', ({ fonts }: { fonts: string[] }) => {
  for (const font of fonts) fontsNotFound.add(String(font))
})
eventBus.on('fonts-not-loaded', ({ fonts }: { fonts: { fontName: string }[] }) => {
  for (const font of fonts) fontsNotFound.add(String(font.fontName))
})

let manager: AcApDocManager | undefined
let pluginsReady: Promise<void> | undefined

/**
 * The viewer is a singleton keyed to a `baseUrl`, and the loopback capability
 * origin only exists once the main process has started the asset server. So the
 * instance is built on the first open rather than at module load.
 */
async function ensureViewer(request: CadPreviewOpenRequest): Promise<AcApDocManager> {
  if (manager) {
    await pluginsReady
    return manager
  }
  const baseUrl = request.cadDataBaseUrl.endsWith('/')
    ? request.cadDataBaseUrl
    : `${request.cadDataBaseUrl}/`
  AcApI18n.setCurrentLocale(request.locale)
  // Only seeds the chrome until a drawing opens: model space is conventionally
  // dark and each drawing's own COLORTHEME takes over from here.
  host.dataset.mlUiTheme = request.theme

  const created = AcApDocManager.createInstance({
    container: host,
    autoResize: true,
    baseUrl,
    useMainThreadDraw: false,
    preloadDefaultFonts: false,
    builtinOpenFileDialog: false,
    webworkerFileUrls: {
      dwgParser: new URL('libredwg-parser-worker.js', assetRoot),
      mtextRender: new URL('mtext-renderer-worker.js', assetRoot),
    },
  })
  if (!created) throw new Error('CAD viewer could not be created.')
  manager = created

  pluginsReady = registerPlugins(created)
  await pluginsReady
  return created
}

async function registerPlugins(instance: AcApDocManager): Promise<void> {
  const { pluginManager } = instance
  // Export formats stay out of the entry chunk; the plugin manager fetches each
  // bundle the first time its trigger command runs from the toolbar.
  registerLazySvgPlugin(pluginManager)
  registerLazyPdfPlugin(pluginManager)
  registerLazyHtmlPlugin(pluginManager, {
    viewerRuntimeUrl: new URL(htmlViewerRuntimeUrl, window.location.href).toString(),
  })
  await registerSimpleUiPlugin(pluginManager, {
    host,
    toolbar: { enabled: true, placement: 'top', items: 'default', collapsible: true },
    dockPanel: { enabled: true, defaultSide: 'left', defaultWidth: 260 },
  })
}

function reportProgress(requestId: number): () => void {
  const onProgress = (args: { percent?: number; stage?: string }) => {
    const percent = typeof args.percent === 'number' && Number.isFinite(args.percent)
      ? Math.max(0, Math.min(100, Math.round(args.percent)))
      : null
    post({
      channel: CAD_PREVIEW_RUNTIME_CHANNEL,
      type: 'progress',
      requestId,
      percentage: percent,
      stage: String(args.stage ?? '').slice(0, 64),
    })
  }
  eventBus.on('open-file-progress', onProgress)
  return () => eventBus.off('open-file-progress', onProgress)
}

async function open(request: CadPreviewOpenRequest): Promise<void> {
  const instance = await ensureViewer(request)
  fontsNotFound.clear()
  const stopProgress = reportProgress(request.requestId)
  const startedAt = performance.now()
  try {
    const response = await fetch(request.sourceUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Drawing source returned HTTP ${response.status}.`)
    const opened = await instance.openDocument(request.fileName, await response.arrayBuffer(), {
      // Review keeps markup and measurement available while the drawing's own
      // entities stay immutable, so a preview can never edit the user's file.
      mode: AcEdOpenMode.Review,
      // Frame the drawing the way AutoCAD does on open (layout limits, then the
      // `*ACTIVE` VPORT). Zoom-extents instead fits stray far-flung markers along
      // with the sheets, which shrinks the sheets to a speck in a narrow panel.
      openViewMode: AcApOpenViewMode.Saved,
      // Publish semantics rather than editor semantics: no-plot layers such as
      // Defpoints carry stray markers that otherwise stretch zoom-extents until
      // the sheets themselves are a speck. Analysis keeps them; a preview does not.
      drawNoPlotLayers: false,
      progressiveRendering: true,
    })
    if (!opened) throw new Error('The drawing could not be opened.')
  } finally {
    stopProgress()
  }

  const database = instance.curDocument.database
  post({
    channel: CAD_PREVIEW_RUNTIME_CHANNEL,
    type: 'result',
    requestId: request.requestId,
    ok: true,
    document: {
      fileName: request.fileName,
      entityCount: database.tables.blockTable.modelSpace.newIterator().toArray().length,
      layerCount: database.tables.layerTable.newIterator().toArray().length,
      parseDurationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      fontsNotFound: [...fontsNotFound].slice(0, 50),
    },
  })
}

let pending: Promise<void> = Promise.resolve()

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !isCadPreviewOpenRequest(event.data)) return
  const request = event.data
  // Opens are serialized: the viewer holds one active document, so overlapping
  // requests would race each other's parse into the same instance.
  pending = pending.then(() => open(request)).catch((error: unknown) => {
    post({
      channel: CAD_PREVIEW_RUNTIME_CHANNEL,
      type: 'result',
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'The drawing could not be opened.',
    })
  })
})

post({ channel: CAD_PREVIEW_RUNTIME_CHANNEL, type: 'ready' })
