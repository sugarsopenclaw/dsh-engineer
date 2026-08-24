import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import electron from 'electron'

import { createProbeDxf } from './probe/mlight-fixture.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const probeRoot = path.join(projectRoot, 'build', '.cad-preview-probe')
const workspaceRoot = path.join(probeRoot, 'workspace')
const outputDir = path.join(probeRoot, 'out')
const bundlePath = path.join(probeRoot, 'probe-main.cjs')
const distDir = path.join(projectRoot, 'dist')
const cadDataRoot = path.join(projectRoot, 'build', '.cad-data')

function log(message) {
  process.stdout.write(`[cad-preview-probe] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[cad-preview-probe] ${message}\n`)
  process.exit(1)
}

function readArg(name) {
  const prefix = `--${name}=`
  const match = process.argv.slice(2).find((argument) => argument.startsWith(prefix))
  return match?.slice(prefix.length)
}

function requirePrerequisites() {
  const required = [
    path.join(distDir, 'cad-preview-runtime.html'),
    path.join(cadDataRoot, 'fonts', 'fonts.json'),
  ]
  const missing = required.filter((candidate) => !fs.existsSync(candidate))
  if (missing.length > 0) {
    fail(
      'missing build outputs; run `npm run build:renderer` and `npm run sync:cad-data` first:\n  '
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
    const target = path.join(workspaceRoot, path.basename(source))
    fs.copyFileSync(source, target)
    log(`using supplied drawing ${path.basename(source)} (${(fs.statSync(source).size / 1024).toFixed(1)} KiB)`)
    return target
  }

  const target = path.join(workspaceRoot, 'probe-plan.dxf')
  fs.writeFileSync(target, createProbeDxf(), 'utf8')
  log('using generated DXF fixture; pass --drawing=<path> to probe a real drawing')
  return target
}

async function bundleProbe() {
  await build({
    entryPoints: [path.join(scriptDir, 'probe', 'cad-preview-probe-main.ts')],
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
  const drawingPath = prepareWorkspace()
  await bundleProbe()

  // Both isolation models are probed: the sandbox attribute buys defence in depth
  // but strips the frame's origin, which is exactly what worker construction needs.
  const modes = readArg('sandbox') === undefined ? ['1', '0'] : [readArg('sandbox')]
  let failures = 0
  for (const sandbox of modes) {
    log(`running with sandbox=${sandbox}`)
    const result = spawnSync(
      electron,
      [
        bundlePath,
        `--drawing=${drawingPath}`,
        `--output-dir=${outputDir}`,
        `--cad-data-root=${cadDataRoot}`,
        `--dist-dir=${distDir}`,
        `--sandbox=${sandbox}`,
      ],
      { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } },
    )
    if (result.status !== 0) {
      failures += 1
      log(`sandbox=${sandbox} did not render the drawing (exit ${result.status})`)
    }
  }
  log(`artifacts written to ${path.relative(projectRoot, outputDir)}`)
  if (failures === modes.length) fail('no isolation mode rendered the drawing')
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)))
