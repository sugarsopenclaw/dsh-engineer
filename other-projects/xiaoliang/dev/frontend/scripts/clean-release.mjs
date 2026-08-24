import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const releaseDir = path.join(projectRoot, 'release')
const legacyBuildDir = path.join(projectRoot, 'build')
const preservedLegacyEntries = new Set(['.cad-worker'])

function log(message) {
  process.stdout.write(`[clean-release] ${message}\n`)
}

function removeTarget(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return
  }
  fs.rmSync(targetPath, { recursive: true, force: true })
  log(`removed ${path.relative(projectRoot, targetPath)}`)
}

function shouldPreserveLegacyEntry(entry) {
  return preservedLegacyEntries.has(entry) || entry.toLowerCase().endsWith('.log')
}

removeTarget(releaseDir)

if (fs.existsSync(legacyBuildDir)) {
  for (const entry of fs.readdirSync(legacyBuildDir)) {
    if (shouldPreserveLegacyEntry(entry)) {
      continue
    }
    removeTarget(path.join(legacyBuildDir, entry))
  }
}
