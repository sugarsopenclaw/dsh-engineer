import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const outputDir = path.join(projectRoot, 'build', '.uv-runtime')

function log(message) {
  process.stdout.write(`[uv-runtime] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[uv-runtime] ${message}\n`)
  process.exit(1)
}

function resolveExecutable(explicitPath, commandNames) {
  if (typeof explicitPath === 'string' && explicitPath.trim()) {
    const candidate = explicitPath.trim()
    if (!fs.existsSync(candidate)) {
      fail(`configured executable not found: ${candidate}`)
    }
    return candidate
  }

  const pathValue = process.env.PATH || ''
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const commandName of commandNames) {
      const candidate = path.join(directory, commandName)
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function copyExecutable(sourcePath, targetFileName) {
  const targetPath = path.join(outputDir, targetFileName)
  fs.copyFileSync(sourcePath, targetPath)
  log(`copied ${path.basename(sourcePath)} -> ${path.relative(projectRoot, targetPath)}`)
}

function main() {
  if (process.platform !== 'win32') {
    log('skip: uv runtime packaging is only required for Windows builds')
    return
  }

  const uvPath = resolveExecutable(process.env.XIAOLIANG_UV_PATH, ['uv.exe', 'uv'])
  if (!uvPath) {
    fail('uv.exe not found. Install uv or set XIAOLIANG_UV_PATH before packaging.')
  }

  const uvxPath = resolveExecutable(process.env.XIAOLIANG_UVX_PATH, ['uvx.exe', 'uvx'])

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  copyExecutable(uvPath, 'uv.exe')
  if (uvxPath) {
    copyExecutable(uvxPath, 'uvx.exe')
  } else {
    log('uvx.exe not found; packaged app will fall back to uv.exe tool run')
  }
}

main()