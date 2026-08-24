import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'

import { MLightCadAssetServer } from '../../electron/runtime/cad/mlight/mlight-asset-server'

interface ProbeArgs {
  drawingPath: string
  outputDir: string
  cadDataRoot: string
  distDir: string
  sandbox: boolean
  holdMs: number
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

function parseArgs(): ProbeArgs {
  const drawingPath = readArg('drawing')
  const outputDir = readArg('output-dir')
  const cadDataRoot = readArg('cad-data-root')
  const distDir = readArg('dist-dir')
  if (!drawingPath || !outputDir || !cadDataRoot || !distDir) {
    throw new Error('cad-preview probe requires --drawing, --output-dir, --cad-data-root and --dist-dir.')
  }
  return {
    drawingPath: path.resolve(drawingPath),
    outputDir: path.resolve(outputDir),
    cadDataRoot: path.resolve(cadDataRoot),
    distDir: path.resolve(distDir),
    sandbox: readArg('sandbox') !== '0',
    holdMs: Number(readArg('hold-ms') ?? 1_500),
  }
}

/**
 * Mirrors what the React panel will render: a sibling document of the runtime
 * inside `dist/`, so the iframe resolves through the same origin relationship
 * production gets from `loadFile`.
 */
function writeHostPage(distDir: string, sandbox: boolean): string {
  const hostPath = path.join(distDir, 'cad-preview-probe-host.html')
  const sandboxAttribute = sandbox ? ' sandbox="allow-scripts"' : ''
  fs.writeFileSync(hostPath, `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>cad preview probe host</title></head>
  <body style="margin:0;overflow:hidden">
    <iframe
      id="frame"
      src="./cad-preview-runtime.html"
      title="cad preview"${sandboxAttribute}
      referrerpolicy="no-referrer"
      style="display:block;width:100vw;height:100vh;border:0"
    ></iframe>
    <script>
      const CHANNEL = 'xiaoliang:cad-preview-runtime'
      const spec = JSON.parse(decodeURIComponent(new URLSearchParams(location.search).get('spec')))
      const frame = document.getElementById('frame')
      const emit = (event) => console.log('@@probe@@' + JSON.stringify(event))
      window.addEventListener('message', (event) => {
        if (event.source !== frame.contentWindow) return
        const data = event.data
        if (!data || data.channel !== CHANNEL) return
        if (data.type === 'ready') {
          emit({ type: 'ready' })
          frame.contentWindow.postMessage({ ...spec, channel: CHANNEL, type: 'open', requestId: 1 }, '*')
          return
        }
        emit(data)
      })
      setTimeout(() => emit({ type: 'timeout' }), 120000)
    </script>
  </body>
</html>
`, 'utf8')
  return hostPath
}

async function main(): Promise<void> {
  const args = parseArgs()
  fs.mkdirSync(args.outputDir, { recursive: true })
  await app.whenReady()

  const assets = new MLightCadAssetServer(args.cadDataRoot)
  await assets.start()
  const extension = path.extname(args.drawingPath).toLowerCase() === '.dwg' ? '.dwg' : '.dxf'
  const grant = assets.grantSource({
    extension,
    fileName: path.basename(args.drawingPath),
    size: fs.statSync(args.drawingPath).size,
    sourcePath: args.drawingPath,
  })

  const hostPath = writeHostPage(args.distDir, args.sandbox)
  const window = new BrowserWindow({
    width: 1_400,
    height: 900,
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  const messages: unknown[] = []
  const consoleLines: string[] = []
  let settle: ((value: Record<string, unknown>) => void) | undefined
  const settled = new Promise<Record<string, unknown>>((resolve) => {
    settle = resolve
  })

  window.webContents.on('console-message', (_event, level, message) => {
    if (!message.startsWith('@@probe@@')) {
      consoleLines.push(`[${level}] ${message}`.slice(0, 2_000))
      return
    }
    const payload = JSON.parse(message.slice('@@probe@@'.length)) as Record<string, unknown>
    messages.push(payload)
    if (payload.type === 'result' || payload.type === 'timeout') settle?.(payload)
  })

  const spec = encodeURIComponent(JSON.stringify({
    fileName: path.basename(args.drawingPath),
    sourceUrl: grant.url,
    cadDataBaseUrl: assets.cadDataBaseUrl,
    locale: 'zh',
    theme: 'light',
  }))
  await window.loadFile(hostPath, { query: { spec } })

  const outcome = await settled
  await new Promise((resolve) => setTimeout(resolve, args.holdMs))

  const image = await window.webContents.capturePage()
  const screenshotName = `preview-${args.sandbox ? 'sandboxed' : 'same-origin'}.png`
  fs.writeFileSync(path.join(args.outputDir, screenshotName), image.toPNG())

  const report = {
    sandbox: args.sandbox,
    drawing: path.basename(args.drawingPath),
    drawingBytes: fs.statSync(args.drawingPath).size,
    outcome,
    messages,
    console: consoleLines.slice(0, 60),
    screenshot: screenshotName,
  }
  fs.writeFileSync(
    path.join(args.outputDir, `report-${args.sandbox ? 'sandboxed' : 'same-origin'}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  assets.revokeSource(grant.capability)
  await assets.close()
  window.destroy()
  // The host page lives in `dist/` so it shares the runtime's origin; leaving it
  // behind would ship a probe harness inside a packaged build.
  fs.rmSync(hostPath, { force: true })
  app.exit(outcome.type === 'result' && outcome.ok === true ? 0 : 1)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  app.exit(1)
})
