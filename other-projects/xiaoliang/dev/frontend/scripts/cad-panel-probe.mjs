import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import electron from 'electron'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const probeRoot = path.join(projectRoot, 'build', '.cad-panel-probe')
const workspaceRoot = path.join(probeRoot, 'workspace')
const outputDir = path.join(probeRoot, 'out')
const mainBundle = path.join(probeRoot, 'probe-main.cjs')
const entryBundle = path.join(probeRoot, 'probe-entry.js')
const distDir = path.join(projectRoot, 'dist')
const cadDataRoot = path.join(projectRoot, 'build', '.cad-data')

function log(message) {
  process.stdout.write(`[cad-panel-probe] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[cad-panel-probe] ${message}\n`)
  process.exit(1)
}

function readArg(name) {
  const prefix = `--${name}=`
  const match = process.argv.slice(2).find((argument) => argument.startsWith(prefix))
  return match?.slice(prefix.length)
}

const drawingArg = readArg('drawing')
if (!drawingArg) fail('usage: node scripts/cad-panel-probe.mjs --drawing=<path to .dwg|.dxf>')
const drawingSource = path.resolve(drawingArg)
if (!fs.existsSync(drawingSource)) fail(`drawing not found: ${drawingSource}`)

for (const required of [
  path.join(distDir, 'cad-preview-runtime.html'),
  path.join(cadDataRoot, 'fonts', 'fonts.json'),
]) {
  if (!fs.existsSync(required)) {
    fail(`missing ${path.relative(projectRoot, required)}; run \`npm run build:renderer\` and \`npm run sync:cad-data\` first`)
  }
}

fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })
fs.mkdirSync(workspaceRoot, { recursive: true })
const drawingName = path.basename(drawingSource)
fs.copyFileSync(drawingSource, path.join(workspaceRoot, drawingName))
log(`using ${drawingName} (${(fs.statSync(drawingSource).size / 1024 / 1024).toFixed(2)} MiB)`)

await build({
  entryPoints: [path.join(scriptDir, 'probe', 'cad-panel-probe-main.ts')],
  outfile: mainBundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
})

await build({
  entryPoints: [path.join(scriptDir, 'probe', 'cad-panel-probe-entry.tsx')],
  outfile: entryBundle,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': path.join(projectRoot, 'src') },
})

const result = spawnSync(
  electron,
  [
    mainBundle,
    `--project-root=${workspaceRoot}`,
    `--drawing=${drawingName}`,
    `--out=${outputDir}`,
    `--cad-data=${cadDataRoot}`,
    `--dist=${distDir}`,
    `--bundle=${entryBundle}`,
  ],
  { stdio: 'inherit' },
)

log(`report: ${path.relative(projectRoot, path.join(outputDir, 'panel-report.json'))}`)
process.exit(result.status ?? 1)
