import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import electron from 'electron'

import { createProbeDxf } from './probe/mlight-fixture.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const probeRoot = path.join(projectRoot, 'build', '.mlight-write-probe')
const workspaceRoot = path.join(probeRoot, 'workspace')
const outputDir = path.join(probeRoot, 'out')
const bundlePath = path.join(probeRoot, 'write-probe-main.cjs')
const cadDataRoot = path.join(projectRoot, 'build', '.cad-data')

function log(message) {
  process.stdout.write(`[mlight-write-probe] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[mlight-write-probe] ${message}\n`)
  process.exit(1)
}

function readArg(name) {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

function requirePrerequisites() {
  const missing = [
    path.join(projectRoot, 'dist', 'mlight-runtime.html'),
    path.join(projectRoot, 'dist-electron', 'runtime', 'cad', 'mlight', 'preload.js'),
    path.join(cadDataRoot, 'fonts', 'fonts.json'),
  ].filter((candidate) => !fs.existsSync(candidate))
  if (missing.length > 0) {
    fail(
      'missing build outputs; run `npm run build` and `npm run sync:cad-data` first:\n  '
      + missing.map((candidate) => path.relative(projectRoot, candidate)).join('\n  '),
    )
  }
}

function prepareWorkspace() {
  fs.rmSync(probeRoot, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  fs.mkdirSync(workspaceRoot, { recursive: true })

  const explicitDrawing = readArg('drawing')
  if (explicitDrawing) {
    const source = path.resolve(explicitDrawing)
    if (!fs.existsSync(source)) fail(`drawing not found: ${source}`)
    const fileName = path.basename(source)
    fs.copyFileSync(source, path.join(workspaceRoot, fileName))
    log(`drafting onto supplied drawing ${fileName} (${(fs.statSync(source).size / 1024).toFixed(1)} KiB)`)
    return fileName
  }

  const fileName = 'probe-plan.dxf'
  fs.writeFileSync(path.join(workspaceRoot, fileName), createProbeDxf(), 'utf8')
  log(`drafting onto generated fixture ${fileName}; pass --drawing=<path> to use a real drawing`)
  return fileName
}

async function main() {
  requirePrerequisites()
  const drawing = prepareWorkspace()
  await build({
    entryPoints: [path.join(scriptDir, 'probe', 'mlight-write-probe-main.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    sourcemap: 'inline',
    external: ['electron'],
    logLevel: 'warning',
  })

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
  if (result.status === 2) fail('one or more write checks failed; see the report for details')
  if (result.status !== 0) fail(`probe exited with code ${result.status}`)
  log(`artifacts written to ${path.relative(projectRoot, outputDir)}`)
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)))
