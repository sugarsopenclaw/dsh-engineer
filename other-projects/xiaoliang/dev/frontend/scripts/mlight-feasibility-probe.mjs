import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import electron from 'electron'

import { createProbeDxf } from './probe/mlight-fixture.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const probeRoot = path.join(projectRoot, 'build', '.mlight-probe')
const workspaceRoot = path.join(probeRoot, 'workspace')
const outputDir = path.join(probeRoot, 'out')
const bundlePath = path.join(probeRoot, 'probe-main.cjs')
const cadDataRoot = path.join(projectRoot, 'build', '.cad-data')

function log(message) {
  process.stdout.write(`[mlight-probe] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[mlight-probe] ${message}\n`)
  process.exit(1)
}

function readArg(name) {
  const prefix = `--${name}=`
  const match = process.argv.slice(2).find((argument) => argument.startsWith(prefix))
  return match?.slice(prefix.length)
}

function requirePrerequisites() {
  const required = [
    path.join(projectRoot, 'dist', 'mlight-runtime.html'),
    path.join(projectRoot, 'dist-electron', 'runtime', 'cad', 'mlight', 'preload.js'),
    path.join(cadDataRoot, 'fonts', 'fonts.json'),
  ]
  const missing = required.filter((candidate) => !fs.existsSync(candidate))
  if (missing.length > 0) {
    fail(
      'missing build outputs; run `npm run build` and `npm run sync:cad-data` first:\n  '
      + missing.map((candidate) => path.relative(projectRoot, candidate)).join('\n  '),
    )
  }
}

function prepareWorkspace() {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  fs.mkdirSync(workspaceRoot, { recursive: true })

  const explicitDrawing = readArg('drawing')
  if (explicitDrawing) {
    const source = path.resolve(explicitDrawing)
    if (!fs.existsSync(source)) fail(`drawing not found: ${source}`)
    const fileName = path.basename(source)
    fs.copyFileSync(source, path.join(workspaceRoot, fileName))
    log(`using supplied drawing ${fileName} (${(fs.statSync(source).size / 1024).toFixed(1)} KiB)`)
    return fileName
  }

  const fileName = 'probe-plan.dxf'
  fs.writeFileSync(path.join(workspaceRoot, fileName), createProbeDxf(), 'utf8')
  log(`using generated fixture ${fileName}; pass --drawing=<path> to probe a real drawing`)
  return fileName
}

async function bundleProbe() {
  await build({
    entryPoints: [path.join(scriptDir, 'probe', 'mlight-probe-main.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    sourcemap: 'inline',
    external: ['electron'],
    logLevel: 'warning',
  })
}

async function main() {
  requirePrerequisites()
  const drawing = prepareWorkspace()
  await bundleProbe()

  const result = spawnSync(
    electron,
    [
      bundlePath,
      `--project-root=${workspaceRoot}`,
      `--drawing=${drawing}`,
      `--output-dir=${outputDir}`,
      `--cad-data-root=${cadDataRoot}`,
    ],
    { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } },
  )
  if (result.status !== 0) fail(`probe exited with code ${result.status}`)
  log(`artifacts written to ${path.relative(projectRoot, outputDir)}`)
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)))
