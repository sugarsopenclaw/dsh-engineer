import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const releaseDir = path.join(projectRoot, 'release')
const publicDir = path.join(releaseDir, 'public')

function log(message) {
  process.stdout.write(`[prepare-public-release] ${message}\n`)
}

if (!fs.existsSync(releaseDir)) {
  throw new Error(`release directory not found: ${releaseDir}`)
}

const installers = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
  .map((entry) => path.join(releaseDir, entry.name))
  .sort((left, right) => {
    const rightTime = fs.statSync(right).mtimeMs
    const leftTime = fs.statSync(left).mtimeMs
    if (rightTime !== leftTime) {
      return rightTime - leftTime
    }
    return path.basename(left).localeCompare(path.basename(right))
  })

if (installers.length === 0) {
  throw new Error(`no installer exe found in ${releaseDir}`)
}

fs.rmSync(publicDir, { recursive: true, force: true })
fs.mkdirSync(publicDir, { recursive: true })

const installerPath = installers[0]
const targetPath = path.join(publicDir, path.basename(installerPath))
fs.copyFileSync(installerPath, targetPath)

log(`copied ${path.basename(installerPath)} to ${path.relative(projectRoot, publicDir)}`)