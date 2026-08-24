import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'

import { CadPreviewService } from '../../electron/runtime/cad/mlight/cad-preview-service'

interface ProbeArgs {
  projectRoot: string
  drawingRelativePath: string
  outputDir: string
  cadDataRoot: string
  distDir: string
  bundlePath: string
  holdMs: number
}

function parseArgs(): ProbeArgs {
  const read = (name: string) => {
    const prefix = `--${name}=`
    const match = process.argv.find((argument) => argument.startsWith(prefix))
    return match?.slice(prefix.length)
  }
  const require = (name: string) => {
    const value = read(name)
    if (!value) throw new Error(`missing --${name}`)
    return value
  }
  return {
    projectRoot: path.resolve(require('project-root')),
    drawingRelativePath: require('drawing'),
    outputDir: path.resolve(require('out')),
    cadDataRoot: path.resolve(require('cad-data')),
    distDir: path.resolve(require('dist')),
    bundlePath: path.resolve(require('bundle')),
    holdMs: Number(read('hold-ms') ?? 2_000),
  }
}

/**
 * The harness has to live inside `dist/` so the component's relative runtime path
 * resolves exactly as it does when Electron loads `dist/index.html` in production.
 */
function writeHarness(args: ProbeArgs): { hostPath: string; scriptPath: string } {
  const scriptPath = path.join(args.distDir, 'cad-panel-probe-entry.js')
  fs.copyFileSync(args.bundlePath, scriptPath)
  // Without the app stylesheet the component's Tailwind sizing is absent and the
  // iframe collapses to its 300x150 intrinsic box, which would hide real layout bugs.
  const stylesheet = fs.readdirSync(path.join(args.distDir, 'assets'))
    .find((name) => /^index-.*\.css$/u.test(name))
  if (!stylesheet) throw new Error('dist/assets is missing the app stylesheet')
  const hostPath = path.join(args.distDir, 'cad-panel-probe-host.html')
  fs.writeFileSync(hostPath, `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>cad panel probe</title>
    <link rel="stylesheet" href="./assets/${stylesheet}" />
    <style>html,body{height:100%;margin:0;overflow:hidden}</style>
  </head>
  <body>
    <!-- Mirrors the panel's flex chain: a definite height is what makes h-full resolve. -->
    <div style="display:flex;flex-direction:column;height:100vh">
      <div id="root" class="min-h-0 flex-1 overflow-hidden"></div>
    </div>
    <script src="./cad-panel-probe-entry.js"></script>
    <script>setTimeout(() => console.log('@@probe@@' + JSON.stringify({ type: 'timeout' })), 150000)</script>
  </body>
</html>
`, 'utf8')
  return { hostPath, scriptPath }
}

async function main(): Promise<void> {
  const args = parseArgs()
  fs.mkdirSync(args.outputDir, { recursive: true })
  await app.whenReady()

  // The service is the same one `ProjectFileService` calls for a `cad` preview; the
  // repository lookup in between is covered by tests/project-tools.test.cjs.
  const previewService = new CadPreviewService(args.cadDataRoot)
  const grant = await previewService.grant({
    projectRoot: args.projectRoot,
    relativePath: args.drawingRelativePath,
  })

  const stat = fs.statSync(path.join(args.projectRoot, args.drawingRelativePath))
  const spec = {
    projectId: 'probe',
    path: args.drawingRelativePath,
    name: path.basename(args.drawingRelativePath),
    extension: path.extname(args.drawingRelativePath).toLowerCase(),
    kind: 'cad',
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    mode: 'cad',
    sourceUrl: grant.sourceUrl,
    cadDataBaseUrl: grant.cadDataBaseUrl,
  }

  const { hostPath, scriptPath } = writeHarness(args)
  const window = new BrowserWindow({
    width: 520,
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
  const startedAt = Date.now()

  window.webContents.on('console-message', (_event, level, message) => {
    if (!message.startsWith('@@probe@@')) {
      consoleLines.push(`[${level}] ${message}`.slice(0, 1_000))
      return
    }
    const payload = JSON.parse(message.slice('@@probe@@'.length)) as Record<string, unknown>
    messages.push({ ...payload, atMs: Date.now() - startedAt })
    if (payload.type === 'result' || payload.type === 'timeout') settle?.(payload)
  })

  await window.loadFile(hostPath, {
    query: { spec: encodeURIComponent(JSON.stringify(spec)) },
  })

  // Proves the panel shows geometry while conversion is still running rather than
  // parking the user behind a spinner for the whole open.
  const midFlight = setTimeout(() => {
    void window.webContents.capturePage().then((frame) => {
      fs.writeFileSync(path.join(args.outputDir, 'panel-midflight.png'), frame.toPNG())
    })
  }, 6_000)

  const outcome = await settled
  clearTimeout(midFlight)
  await new Promise((resolve) => setTimeout(resolve, args.holdMs))
  const image = await window.webContents.capturePage()
  fs.writeFileSync(path.join(args.outputDir, 'panel-preview.png'), image.toPNG())
  fs.writeFileSync(
    path.join(args.outputDir, 'panel-report.json'),
    `${JSON.stringify({
      drawing: args.drawingRelativePath,
      drawingBytes: stat.size,
      sourceUrl: grant.sourceUrl.replace(/\/source\/[^/]+\//u, '/source/<capability>/'),
      outcome,
      messages,
      console: consoleLines.slice(0, 60),
    }, null, 2)}\n`,
    'utf8',
  )

  fs.rmSync(hostPath, { force: true })
  fs.rmSync(scriptPath, { force: true })
  await previewService.dispose()
  window.destroy()
  app.exit(outcome.type === 'result' && outcome.ok === true ? 0 : 1)
}

void main().catch((error) => {
  process.stderr.write(`[cad-panel-probe] ${error instanceof Error ? error.stack : String(error)}\n`)
  app.exit(1)
})
