import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const outDir = path.join(projectRoot, 'dist-electron')

if (path.dirname(outDir) !== projectRoot || path.basename(outDir) !== 'dist-electron') {
  throw new Error(`Refusing to clean unexpected Electron output directory: ${outDir}`)
}

try {
  fs.rmSync(outDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })
} catch (error) {
  throw new Error(
    `Unable to prepare Electron development output at ${outDir}. `
      + 'Close every running Xiaoliang/Electron development instance and retry.',
    { cause: error },
  )
}

process.stdout.write('[prepare-electron-dev] removed stale dist-electron output\n')
