import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const outputDir = path.join(projectRoot, 'build', '.pi-tools')

function log(message) {
  process.stdout.write(`[pi-tools] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[pi-tools] ${message}\n`)
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

  // Pi 自己的托管 bin 目录(开发者跑过 Pi 时已有下载好的二进制)。
  const piBinDir = process.env.PI_CODING_AGENT_DIR
    ? path.join(process.env.PI_CODING_AGENT_DIR, 'bin')
    : path.join(os.homedir(), '.pi', 'agent', 'bin')
  for (const commandName of commandNames) {
    const candidate = path.join(piBinDir, commandName)
    if (fs.existsSync(candidate)) {
      return candidate
    }
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
    log('skip: pi tool packaging is only required for Windows builds')
    return
  }

  // Pi 的 grep/find 工具依赖 rg/fd;缺失时 SDK 会在最终用户机器上从 GitHub
  // 下载,国内网络大概率失败,所以打包时必须预置。
  const rgPath = resolveExecutable(process.env.XIAOLIANG_RG_PATH, ['rg.exe'])
  if (!rgPath) {
    fail(
      'rg.exe not found. Install ripgrep (winget install BurntSushi.ripgrep.MSVC / choco install ripgrep) '
      + 'or set XIAOLIANG_RG_PATH before packaging.',
    )
  }

  const fdPath = resolveExecutable(process.env.XIAOLIANG_FD_PATH, ['fd.exe'])
  if (!fdPath) {
    fail(
      'fd.exe not found. Install fd (winget install sharkdp.fd / choco install fd) '
      + 'or set XIAOLIANG_FD_PATH before packaging.',
    )
  }

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  copyExecutable(rgPath, 'rg.exe')
  copyExecutable(fdPath, 'fd.exe')
}

main()
