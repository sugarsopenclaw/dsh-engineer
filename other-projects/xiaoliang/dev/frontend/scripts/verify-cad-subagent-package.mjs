import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')

const requiredFiles = [
  'dist-electron/runtime/agent/subagents/definitions/cad-analyst.md',
  'dist-electron/runtime/agent/subagents/definitions/cad-drafter.md',
  'dist-electron/runtime/agent/subagents/definitions/blender-modeler.md',
  'dist-electron/runtime/cad/mlight/preload.js',
  'dist/mlight-runtime.html',
  'dist/cad-preview-runtime.html',
  'dist/assets/libredwg-parser-worker.js',
  'dist/assets/mtext-renderer-worker.js',
  'build/.cad-data/manifest.json',
  'build/.cad-data/fonts/fonts.json',
  'build/.cad-data/fonts/gbcbig.shx',
  'build/.cad-data/templates/acadiso.dxf',
  'electron/runtime/cad/drivers/autocad-http/python/THIRD_PARTY_NOTICES.md',
  'electron/runtime/cad/drivers/autocad-http/python/requirements.txt',
  'electron/runtime/cad/drivers/autocad-http/python/packaged-bin/xiaoliang_cad_bridge.exe',
  'electron/runtime/cad/drivers/autocad-com/python/packaged-bin/cad_worker.exe',
  'build/.uv-runtime/uv.exe',
  'build/.uv-runtime/uvx.exe',
]

const missingFiles = requiredFiles.filter((relativePath) => {
  const absolutePath = path.join(projectRoot, relativePath)
  return !fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0
})

const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
)
const extraResourceSources = new Set(
  (packageJson.build?.extraResources ?? [])
    .map((entry) => entry?.from)
    .filter((entry) => typeof entry === 'string'),
)
const requiredResourceSources = [
  'electron/runtime/cad/drivers/autocad-com/python',
  'electron/runtime/cad/drivers/autocad-http/python',
  'build/.uv-runtime',
  'build/.cad-data',
]
const missingResources = requiredResourceSources.filter(
  (source) => !extraResourceSources.has(source),
)

const packagedBridgePath = path.join(
  projectRoot,
  'electron/runtime/cad/drivers/autocad-http/python/packaged-bin/xiaoliang_cad_bridge.exe',
)
const bridgeSelfCheckErrors = []
if (fs.existsSync(packagedBridgePath) && fs.statSync(packagedBridgePath).size > 0) {
  const selfCheck = spawnSync(packagedBridgePath, ['--self-check'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (selfCheck.error || selfCheck.status !== 0) {
    bridgeSelfCheckErrors.push(
      `CAD HTTP bridge self-check failed: ${selfCheck.error?.message || selfCheck.stderr || `exit ${selfCheck.status}`}`,
    )
  } else {
    try {
      const report = JSON.parse(String(selfCheck.stdout || '').trim())
      if (report?.ok !== true) bridgeSelfCheckErrors.push('CAD HTTP bridge self-check returned ok=false')
    } catch {
      bridgeSelfCheckErrors.push('CAD HTTP bridge self-check returned invalid JSON')
    }
  }
}

if (missingFiles.length > 0 || missingResources.length > 0 || bridgeSelfCheckErrors.length > 0) {
  const details = [
    ...missingFiles.map((file) => `missing file: ${file}`),
    ...missingResources.map((source) => `missing extraResource: ${source}`),
    ...bridgeSelfCheckErrors,
  ]
  throw new Error(`CAD subagent package is incomplete:\n${details.join('\n')}`)
}

console.log(`[cad-subagent-package] verified ${requiredFiles.length} files and ${requiredResourceSources.length} resource roots`)
